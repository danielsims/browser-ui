import AVFoundation
import CoreGraphics
import Foundation
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Where to open a live view of a browser session, as React's
/// `resolveConnection` returns it. A host resolves one per connection, so it
/// can spend a one-time ticket each time.
public struct BrowserStreamConnection: Sendable {
    public let url: URL
    public let protocols: [String]

    public init(url: URL, protocols: [String] = []) {
        self.url = url
        self.protocols = protocols
    }
}

/// The native viewer for a relay stream, matching React's
/// `AgentBrowserViewport`: the screen as H.264 and sound as Opus, with page
/// URL and agent activity, in; touch and keyboard input out. The stream only
/// runs while a `BrowserStreamView` shows it and the app is in front. A
/// dropped connection ends the view rather than retrying; the session is the
/// agent's to reopen.
@MainActor
@Observable
public final class BrowserStreamDriver: BrowserDriver {
    public enum TouchPhase: String, Sendable {
        case start = "touchStart"
        case move = "touchMove"
        case end = "touchEnd"
        case cancel = "touchCancel"
    }

    public let descriptor: BrowserDriverDescriptor
    public private(set) var scope: String?
    public private(set) var lifecycleSessionId: String?
    public private(set) var phase: BrowserDriverPhase = .idle
    public var isEngaged: Bool { phase == .connected }
    /// The session is over for this viewer: ended by its owner, finished, or
    /// no longer reachable.
    public private(set) var ended = false
    /// A frame has been shown since the stream (re)started.
    public private(set) var showing = false
    public private(set) var url: String?
    /// The page's size, which the screen is drawn and input mapped in.
    public private(set) var viewport = CGSize(width: 1280, height: 800)
    /// Where the agent is acting, from the source's activity messages. It
    /// starts parked out of sight in the middle, and hides rather than goes,
    /// so every move glides from where it was, as React's viewer does.
    public private(set) var agentCursor: BrowserAgentCursorState? = BrowserAgentCursorState(x: 0.5, y: 0.5, visible: false)
    /// What the agent is doing right now, such as "Clicking", while it does it.
    public private(set) var activityLabel: String?
    /// The session offers sound.
    public private(set) var soundAvailable = false
    /// The viewer is playing the session's sound.
    public private(set) var sound = false

    @ObservationIgnored private let sessionId: String
    @ObservationIgnored private let resolveConnection: @MainActor () async throws -> BrowserStreamConnection
    @ObservationIgnored private let endSessionAction: (@MainActor () async throws -> Void)?
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var receiving: Task<Void, Never>?
    @ObservationIgnored private var cursorIdle: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var layers: [ObjectIdentifier: AVSampleBufferDisplayLayer] = [:]
    @ObservationIgnored private var foreground = true
    @ObservationIgnored private var streaming = false
    @ObservationIgnored private var audio: RelayAudioPlayer?
    @ObservationIgnored private lazy var video = RelayVideoDecoder(
        output: { [weak self] image, frame in self?.show(image, frame: frame) },
        failed: { [weak self] in self?.restartVideo() })

    public init(
        id: String,
        sessionId: String,
        resolveConnection: @escaping @MainActor () async throws -> BrowserStreamConnection,
        endSession: (@MainActor () async throws -> Void)? = nil
    ) throws {
        descriptor = try BrowserDriverDescriptor(
            id: id,
            kind: .agentBrowser,
            capabilities: [.remoteFrameStream, .pointerInput, .keyboardInput, .scroll, .viewport])
        self.sessionId = sessionId
        self.resolveConnection = resolveConnection
        endSessionAction = endSession
        #if os(iOS)
        let center = NotificationCenter.default
        center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.setForeground(false) }
        }
        center.addObserver(
            forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.setForeground(true) }
        }
        #endif
    }

    /// Whether the host can end the session from this viewer.
    public var canEndSession: Bool { endSessionAction != nil }

    public func begin(scope: String) {
        self.scope = scope
        lifecycleSessionId = sessionId
        Task { await connect() }
    }

    public func connect() async {
        disconnect()
        ended = false
        phase = .connecting
        do {
            let connection = try await resolveConnection()
            let task = URLSession.shared.webSocketTask(
                with: connection.url,
                protocols: connection.protocols)
            task.maximumMessageSize = 8 * 1024 * 1024
            self.task = task
            task.resume()
            receiving = Task { [weak self] in await self?.receive(from: task) }
        } catch {
            finish()
        }
    }

    public func disconnect() {
        receiving?.cancel()
        receiving = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        started = false
        streaming = false
        showing = false
        video.reset()
    }

    public func end() {
        Task { try? await endSession() }
    }

    /// Ends the session at its source. Throws when the host refuses, such as
    /// for a viewer who isn't the session's owner.
    public func endSession() async throws {
        try await endSessionAction?()
        finish()
    }

    private func finish() {
        disconnect()
        ended = true
        phase = .idle
    }

    private func receive(from task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            guard let message = try? await task.receive() else {
                if self.task === task { finish() }
                return
            }
            switch message {
            case .data(let data):
                receive(media: data)
            case .string(let text):
                receive(text: text)
            @unknown default:
                break
            }
        }
    }

    private func receive(media data: Data) {
        guard let type = data.first else { return }
        if type == RelayStream.audio {
            audio?.play(data.dropFirst())
        } else if type == RelayStream.video, streaming {
            video.decode(data)
        }
    }

    private func receive(text: String) {
        guard let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = value["type"] as? String
        else { return }
        switch type {
        case "hello":
            guard let width = value["w"] as? Double, let height = value["h"] as? Double,
                  width > 0, height > 0
            else { return }
            viewport = CGSize(width: width, height: height)
            soundAvailable = value["audio"] as? Bool ?? false
            started = true
            streaming = false
            updateStreaming()
            if sound { sendCommand("au,1") }
        case "url":
            url = value["url"] as? String
        case "activity":
            if let activity = try? JSONDecoder().decode(BrowserAgentActivity.self, from: data) {
                show(activity)
            }
        default:
            break
        }
    }

    // MARK: Media

    /// A decoded frame: shown in every view of this stream, then acknowledged,
    /// which paces the stream to this viewer.
    private func show(_ image: CVImageBuffer, frame: UInt32) {
        for layer in layers.values {
            if let sample = relayDisplaySample(image) {
                layer.sampleBufferRenderer.enqueue(sample)
            }
        }
        sendCommand("a,\(frame)")
        if !showing { showing = true }
        phase = .connected
    }

    private func restartVideo() {
        video.reset()
        if streaming { sendCommand("kf") }
    }

    func attach(_ layer: AVSampleBufferDisplayLayer) {
        layers[ObjectIdentifier(layer)] = layer
        updateStreaming()
    }

    func detach(_ layer: AVSampleBufferDisplayLayer) {
        layers[ObjectIdentifier(layer)] = nil
        updateStreaming()
    }

    private func setForeground(_ value: Bool) {
        foreground = value
        updateStreaming()
    }

    /// The stream runs while a view shows it and the app is in front;
    /// nothing is captured or sent otherwise.
    private func updateStreaming() {
        let wanted = started && foreground && !layers.isEmpty
        guard wanted != streaming else { return }
        streaming = wanted
        if !wanted { video.reset() }
        sendCommand(wanted ? "v,1" : "v,0")
    }

    /// Plays or mutes the session's sound. Turning it on starts audio
    /// playback in this app (on iOS, alongside other audio).
    public func setSound(_ on: Bool) {
        guard on != sound else { return }
        if on {
            guard let player = RelayAudioPlayer() else { return }
            audio = player
        } else {
            audio?.stop()
            audio = nil
        }
        sound = on
        if started { sendCommand(on ? "au,1" : "au,0") }
    }

    /// The cursor appears where the agent acts and fades once it's idle, as
    /// React's viewer does.
    private func show(_ activity: BrowserAgentActivity) {
        if let cursor = activity.agentCursor { agentCursor = cursor }
        activityLabel = activity.phase == .started ? activity.label : nil
        cursorIdle?.cancel()
        guard activity.phase == .completed else { return }
        cursorIdle = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.agentCursor?.visible = false
        }
    }

    // MARK: Input. Sources accept it only from viewers allowed to control.

    /// A finger on the page at a point in page CSS pixels, at the moment it
    /// moved. Sources replay it as touch with the same timing, so the page
    /// taps, scrolls and flings natively.
    public func touch(_ phase: TouchPhase, at point: CGPoint, time: Date = Date()) {
        send([
            "type": "input_touch", "eventType": phase.rawValue, "x": point.x, "y": point.y,
            "timestamp": time.timeIntervalSince1970 * 1000,
        ])
    }

    public func type(_ text: String) {
        for character in text {
            let key = String(character)
            send([
                "type": "input_keyboard", "eventType": "char", "key": key, "code": "",
                "text": key, "windowsVirtualKeyCode": 0, "modifiers": 0,
            ])
        }
    }

    public func press(key: String, code: Int) {
        for event in ["keyDown", "keyUp"] {
            send([
                "type": "input_keyboard", "eventType": event, "key": key, "code": key,
                "windowsVirtualKeyCode": code, "modifiers": 0,
            ])
        }
    }

    private func send(_ message: [String: Any]) {
        guard phase == .connected,
              let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8)
        else { return }
        sendCommand(text)
    }

    private func sendCommand(_ text: String) {
        task?.send(.string(text)) { _ in }
    }
}

/// The page as it streams, with the agent's cursor over it. Until the first
/// frame it shows the host's loading view, as React's `loadingFallback`.
/// Interactive views pass touches through to the page.
public struct BrowserStreamView<Loading: View>: View {
    private let driver: BrowserStreamDriver
    private let interactive: Bool
    private let loading: Loading
    @State private var touching = false

    public init(
        driver: BrowserStreamDriver,
        interactive: Bool = false,
        @ViewBuilder loading: () -> Loading
    ) {
        self.driver = driver
        self.interactive = interactive
        self.loading = loading()
    }

    public var body: some View {
        GeometryReader { proxy in
            let page = containedViewportRect(container: proxy.size, viewport: driver.viewport)
            ZStack {
                RelayDisplay(driver: driver)
                    .frame(width: page.width, height: page.height)
                    .position(x: page.midX, y: page.midY)
                if !driver.showing {
                    loading
                }
                if let cursor = driver.agentCursor {
                    BrowserAgentCursor(state: cursor, containedViewport: driver.viewport)
                }
            }
            .contentShape(Rectangle())
            .gesture(touches(on: page), including: interactive ? .all : .subviews)
        }
    }

    private func touches(on page: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if !touching {
                    touching = true
                    driver.touch(.start, at: pagePoint(value.startLocation, on: page), time: value.time)
                }
                driver.touch(.move, at: pagePoint(value.location, on: page), time: value.time)
            }
            .onEnded { value in
                driver.touch(.end, at: pagePoint(value.location, on: page), time: value.time)
                touching = false
            }
    }

    private func pagePoint(_ point: CGPoint, on page: CGRect) -> CGPoint {
        CGPoint(
            x: min(max((point.x - page.minX) / max(page.width, 1), 0), 1) * driver.viewport.width,
            y: min(max((point.y - page.minY) / max(page.height, 1), 0), 1) * driver.viewport.height)
    }
}

/// The stream's video, in a display layer attached to the driver while shown.
private struct RelayDisplay {
    let driver: BrowserStreamDriver

    final class Host: PlatformView {
        let display = AVSampleBufferDisplayLayer()
        weak var driver: BrowserStreamDriver?

        override init(frame: CGRect) {
            super.init(frame: frame)
            display.videoGravity = .resizeAspect
            #if os(iOS)
            layer.addSublayer(display)
            #else
            wantsLayer = true
            layer?.addSublayer(display)
            #endif
        }

        required init?(coder: NSCoder) { nil }

        #if os(iOS)
        override func layoutSubviews() {
            super.layoutSubviews()
            display.frame = bounds
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            window == nil ? driver?.detach(display) : driver?.attach(display)
        }
        #else
        override func layout() {
            super.layout()
            display.frame = bounds
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window == nil ? driver?.detach(display) : driver?.attach(display)
        }
        #endif
    }

    func makeHost() -> Host {
        let host = Host(frame: .zero)
        host.driver = driver
        return host
    }

    @MainActor static func dismantle(_ host: Host) {
        host.driver?.detach(host.display)
    }
}

#if os(iOS)
private typealias PlatformView = UIView

extension RelayDisplay: UIViewRepresentable {
    func makeUIView(context: Context) -> Host { makeHost() }
    func updateUIView(_ host: Host, context: Context) {}
    static func dismantleUIView(_ host: Host, coordinator: ()) { dismantle(host) }
}
#else
private typealias PlatformView = NSView

extension RelayDisplay: NSViewRepresentable {
    func makeNSView(context: Context) -> Host { makeHost() }
    func updateNSView(_ host: Host, context: Context) {}
    static func dismantleNSView(_ host: Host, coordinator: ()) { dismantle(host) }
}
#endif

/// Package-owned sound control, shown when the session offers sound.
public struct BrowserStreamSoundButton: View {
    private let driver: BrowserStreamDriver

    public init(driver: BrowserStreamDriver) {
        self.driver = driver
    }

    public var body: some View {
        if driver.soundAvailable {
            Button {
                driver.setSound(!driver.sound)
            } label: {
                Image(systemName: driver.sound ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .foregroundStyle(.white)
                    .background(.black.opacity(0.58), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(driver.sound ? "Mute" : "Unmute")
        }
    }
}

/// Package-owned keyboard control: shows the system keyboard, and what's
/// typed goes straight to the page, Return and Delete included.
public struct BrowserStreamKeyboardButton: View {
    private let driver: BrowserStreamDriver
    @State private var typed = ""
    @FocusState private var focused: Bool

    public init(driver: BrowserStreamDriver) {
        self.driver = driver
    }

    public var body: some View {
        Button {
            focused.toggle()
        } label: {
            Image(systemName: focused ? "keyboard.chevron.compact.down" : "keyboard")
                .font(.system(size: 15, weight: .medium))
                .frame(width: 36, height: 36)
                .foregroundStyle(.white)
                .background(.black.opacity(0.58), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(focused ? "Hide keyboard" : "Type into the page")
        .background {
            TextField("", text: $typed)
                .focused($focused)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .onSubmit {
                    driver.press(key: "Enter", code: 13)
                    focused = true
                }
                .onChange(of: typed) { old, new in
                    if new.count < old.count {
                        for _ in 0..<(old.count - new.count) {
                            driver.press(key: "Backspace", code: 8)
                        }
                    } else if new.hasPrefix(old) {
                        driver.type(String(new.dropFirst(old.count)))
                    }
                    if new.count > 64 { typed = "" }
                }
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .accessibilityHidden(true)
        }
    }
}
