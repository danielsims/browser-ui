import AVFoundation
import CoreMedia
import VideoToolbox

/// The relay stream's binary messages, as `@browser-ui/core`'s relay-stream:
/// video (`0x01`) is a 16-byte header and an Annex-B H.264 access unit; sound
/// (`0x02`) is one 10 ms Opus packet, 48 kHz stereo.
enum RelayStream {
    static let video: UInt8 = 0x01
    static let audio: UInt8 = 0x02
    static let videoHeaderBytes = 16
    static let sampleRate = 48_000.0
    static let opusFrames: UInt32 = 480
}

/// Hardware-decodes the relay's video. Each decoded frame is handed to
/// `output` on the main actor with the frame number to acknowledge.
@MainActor
final class RelayVideoDecoder {
    private var format: CMVideoFormatDescription?
    private var session: VTDecompressionSession?
    private var parameterSets: [Data] = []
    private var waitingForKey = true
    private let output: @MainActor (CVImageBuffer, UInt32) -> Void
    private let failed: @MainActor () -> Void

    init(
        output: @escaping @MainActor (CVImageBuffer, UInt32) -> Void,
        failed: @escaping @MainActor () -> Void
    ) {
        self.output = output
        self.failed = failed
    }

    func reset() {
        if let session { VTDecompressionSessionInvalidate(session) }
        session = nil
        format = nil
        parameterSets = []
        waitingForKey = true
    }

    /// One video message, header included.
    func decode(_ message: Data) {
        guard message.count > RelayStream.videoHeaderBytes else { return }
        let bytes = [UInt8](message)
        let key = bytes[1] & 1 == 1
        let frame = UInt32(bytes[2]) << 24 | UInt32(bytes[3]) << 16 | UInt32(bytes[4]) << 8 | UInt32(bytes[5])
        if waitingForKey && !key { return }
        var sets: [Data] = []
        var picture = Data()
        for unit in Self.nalUnits(bytes, from: RelayStream.videoHeaderBytes) {
            switch unit.first.map({ $0 & 0x1f }) {
            case 7, 8: sets.append(Data(unit))
            case 9, nil: break
            default:
                // AVCC: each unit after its big-endian length.
                var length = UInt32(unit.count).bigEndian
                picture.append(Data(bytes: &length, count: 4))
                picture.append(contentsOf: unit)
            }
        }
        if !sets.isEmpty && sets != parameterSets {
            guard openSession(with: sets) else { return fail() }
        }
        guard let session, let format, !picture.isEmpty else { return }
        waitingForKey = false
        guard let sample = Self.sample(picture, format: format) else { return fail() }
        let output = output
        let status = VTDecompressionSessionDecodeFrame(
            session, sampleBuffer: sample, flags: [._EnableAsynchronousDecompression],
            infoFlagsOut: nil
        ) { [weak self] status, _, image, _, _ in
            guard status == noErr, let image else {
                Task { @MainActor in self?.fail() }
                return
            }
            nonisolated(unsafe) let decoded = image
            Task { @MainActor in output(decoded, frame) }
        }
        if status != noErr { fail() }
    }

    private func fail() {
        reset()
        let failed = failed
        Task { @MainActor in failed() }
    }

    private func openSession(with sets: [Data]) -> Bool {
        reset()
        var description: CMFormatDescription?
        let status = sets.withUnsafeParameterSetPointers { pointers, sizes in
            CMVideoFormatDescriptionCreateFromH264ParameterSets(
                allocator: nil, parameterSetCount: sets.count, parameterSetPointers: pointers,
                parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &description)
        }
        guard status == noErr, let description else { return false }
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferIOSurfacePropertiesKey: [String: Any](),
        ]
        var session: VTDecompressionSession?
        guard VTDecompressionSessionCreate(
            allocator: nil, formatDescription: description, decoderSpecification: nil,
            imageBufferAttributes: attributes as CFDictionary, outputCallback: nil,
            decompressionSessionOut: &session) == noErr, let session
        else { return false }
        VTSessionSetProperty(session, key: kVTDecompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        self.session = session
        format = description
        parameterSets = sets
        return true
    }

    private static func sample(_ picture: Data, format: CMVideoFormatDescription) -> CMSampleBuffer? {
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(
            allocator: nil, memoryBlock: nil, blockLength: picture.count, blockAllocator: nil,
            customBlockSource: nil, offsetToData: 0, dataLength: picture.count, flags: 0,
            blockBufferOut: &block) == noErr, let block
        else { return nil }
        let copied = picture.withUnsafeBytes { raw in
            CMBlockBufferReplaceDataBytes(
                with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0,
                dataLength: picture.count)
        }
        guard copied == noErr else { return nil }
        var sample: CMSampleBuffer?
        var size = picture.count
        guard CMSampleBufferCreateReady(
            allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: 1,
            sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1,
            sampleSizeArray: &size, sampleBufferOut: &sample) == noErr
        else { return nil }
        return sample
    }

    /// The NAL units of an Annex-B stream, without their start codes.
    static func nalUnits(_ bytes: [UInt8], from start: Int) -> [ArraySlice<UInt8>] {
        var units: [ArraySlice<UInt8>] = []
        var unitStart: Int?
        var index = start
        while index + 2 < bytes.count {
            if bytes[index] == 0, bytes[index + 1] == 0, bytes[index + 2] == 1 {
                if let begin = unitStart {
                    var end = index
                    if end > begin, bytes[end - 1] == 0 { end -= 1 }
                    units.append(bytes[begin..<end])
                }
                index += 3
                unitStart = index
            } else {
                index += 1
            }
        }
        if let begin = unitStart, begin < bytes.count { units.append(bytes[begin...]) }
        return units
    }
}

private extension Array where Element == Data {
    func withUnsafeParameterSetPointers<R>(
        _ body: (UnsafePointer<UnsafePointer<UInt8>>, UnsafePointer<Int>) -> R
    ) -> R {
        let copies = map { data -> UnsafeMutablePointer<UInt8> in
            let pointer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
            data.copyBytes(to: pointer, count: data.count)
            return pointer
        }
        defer { copies.forEach { $0.deallocate() } }
        let pointers = copies.map { UnsafePointer($0) }
        let sizes = map(\.count)
        return pointers.withUnsafeBufferPointer { pointerBuffer in
            sizes.withUnsafeBufferPointer { sizeBuffer in
                body(pointerBuffer.baseAddress!, sizeBuffer.baseAddress!)
            }
        }
    }
}

/// A decoded frame as a sample a display layer shows at once.
func relayDisplaySample(_ image: CVImageBuffer) -> CMSampleBuffer? {
    var format: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(
        allocator: nil, imageBuffer: image, formatDescriptionOut: &format) == noErr, let format
    else { return nil }
    var timing = CMSampleTimingInfo(
        duration: .invalid, presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(
        allocator: nil, imageBuffer: image, formatDescription: format, sampleTiming: &timing,
        sampleBufferOut: &sample) == noErr, let sample
    else { return nil }
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
       CFArrayGetCount(attachments) > 0 {
        let attachment = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
        CFDictionarySetValue(
            attachment,
            Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
            Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    return sample
}

/// Decodes the relay's Opus with AudioToolbox and plays it, keeping at most a
/// quarter second queued so sound never drifts behind the picture.
@MainActor
final class RelayAudioPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let converter: AVAudioConverter
    private let opus: AVAudioFormat
    private let pcm: AVAudioFormat
    private var queued = 0
    private static let maxQueued = 25

    init?() {
        var description = AudioStreamBasicDescription(
            mSampleRate: RelayStream.sampleRate, mFormatID: kAudioFormatOpus, mFormatFlags: 0,
            mBytesPerPacket: 0, mFramesPerPacket: RelayStream.opusFrames, mBytesPerFrame: 0,
            mChannelsPerFrame: 2, mBitsPerChannel: 0, mReserved: 0)
        guard let opus = AVAudioFormat(streamDescription: &description),
              let pcm = AVAudioFormat(standardFormatWithSampleRate: RelayStream.sampleRate, channels: 2),
              let converter = AVAudioConverter(from: opus, to: pcm)
        else { return nil }
        self.opus = opus
        self.pcm = pcm
        self.converter = converter
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: pcm)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        do { try engine.start() } catch { return nil }
        player.play()
    }

    func stop() {
        player.stop()
        engine.stop()
    }

    /// One Opus packet, without the message's type byte.
    func play(_ packet: Data) {
        guard queued < Self.maxQueued, !packet.isEmpty else { return }
        let compressed = AVAudioCompressedBuffer(
            format: opus, packetCapacity: 1, maximumPacketSize: packet.count)
        packet.withUnsafeBytes { raw in
            compressed.data.copyMemory(from: raw.baseAddress!, byteCount: packet.count)
        }
        compressed.byteLength = UInt32(packet.count)
        compressed.packetCount = 1
        compressed.packetDescriptions?.pointee = AudioStreamPacketDescription(
            mStartOffset: 0, mVariableFramesInPacket: 0, mDataByteSize: UInt32(packet.count))
        guard let decoded = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: RelayStream.opusFrames)
        else { return }
        var supplied = false
        let status = converter.convert(to: decoded, error: nil) { _, state in
            if supplied {
                state.pointee = .noDataNow
                return nil
            }
            supplied = true
            state.pointee = .haveData
            return compressed
        }
        guard status != .error, decoded.frameLength > 0 else { return }
        queued += 1
        player.scheduleBuffer(decoded) { [weak self] in
            Task { @MainActor in self?.queued -= 1 }
        }
    }
}
