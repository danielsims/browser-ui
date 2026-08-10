import CoreGraphics
import SwiftUI
import XCTest
@testable import BrowserUI

final class BrowserUITests: XCTestCase {
    private struct LifecycleFixture: Decodable {
        let version: Int
        let endReasons: [String]
        let releaseOutcomes: [String]
        let viewportModes: [String]
        let validRequests: [JSONValue]
        let invalidRequests: [JSONValue]
        let receipt: JSONValue
        let validReleaseRequests: [JSONValue]
        let invalidReleaseRequests: [JSONValue]
        let releaseReceipt: JSONValue
    }

    private struct DriverFixture: Decodable {
        let version: Int
        let kinds: [String]
        let capabilities: [String]
        let descriptors: [JSONValue]
        let invalidDescriptors: [JSONValue]
    }

    private enum JSONValue: Decodable {
        case object([String: JSONValue])
        case array([JSONValue])
        case string(String)
        case number(Double)
        case bool(Bool)
        case null

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
            else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
            else if let value = try? container.decode(String.self) { self = .string(value) }
            else if let value = try? container.decode(Double.self) { self = .number(value) }
            else if let value = try? container.decode(Bool.self) { self = .bool(value) }
            else if container.decodeNil() { self = .null }
            else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "JSON") }
        }

        var data: Data {
            let object: Any = switch self {
            case .object(let value): value.mapValues(\.foundation)
            case .array(let value): value.map(\.foundation)
            case .string(let value): value
            case .number(let value): value
            case .bool(let value): value
            case .null: NSNull()
            }
            return try! JSONSerialization.data(withJSONObject: object)
        }

        private var foundation: Any {
            switch self {
            case .object(let value): return value.mapValues(\.foundation)
            case .array(let value): return value.map(\.foundation)
            case .string(let value): return value
            case .number(let value): return value
            case .bool(let value): return value
            case .null: return NSNull()
            }
        }
    }

    func testContainedViewportIsLetterboxed() {
        let rect = containedViewportRect(
            container: CGSize(width: 1600, height: 900),
            viewport: CGSize(width: 1440, height: 900))
        XCTAssertEqual(rect, CGRect(x: 80, y: 0, width: 1440, height: 900))
    }

    func testDisplayModesMatchReactPackage() {
        XCTAssertEqual(
            BrowserDisplayMode.allCases.map(\.rawValue),
            ["inline", "picture-in-picture", "fullscreen"])
    }

    func testDriverCapabilitiesMatchSharedFixture() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("core/test/fixtures/browser-drivers.json")
        let fixture = try JSONDecoder().decode(
            DriverFixture.self,
            from: Data(contentsOf: fixtureURL))

        XCTAssertEqual(fixture.version, browserDriverContractVersion)
        XCTAssertEqual(fixture.kinds, BrowserDriverKind.allCases.map(\.rawValue))
        XCTAssertEqual(
            fixture.capabilities,
            BrowserDriverCapability.allCases.map(\.rawValue))
        let decoder = JSONDecoder()
        for descriptor in fixture.descriptors {
            XCTAssertNoThrow(
                try decoder.decode(BrowserDriverDescriptor.self, from: descriptor.data))
        }
        for descriptor in fixture.invalidDescriptors {
            XCTAssertThrowsError(
                try decoder.decode(BrowserDriverDescriptor.self, from: descriptor.data))
        }
    }

    func testCursorCoordinatesClampToProtocolRange() {
        let cursor = BrowserAgentCursorState(x: -2, y: 4)
        XCTAssertEqual(cursor.x, 0)
        XCTAssertEqual(cursor.y, 1)
    }

    @MainActor
    func testCursorRendersWithoutLabel() throws {
        let renderer = ImageRenderer(content:
            BrowserAgentCursor(state: BrowserAgentCursorState(x: 0.5, y: 0.5))
                .frame(width: 160, height: 100))
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = try XCTUnwrap(CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let visiblePixelCount = stride(from: 3, to: pixels.count, by: 4)
            .reduce(into: 0) { count, index in
                if pixels[index] > 0 { count += 1 }
            }
        XCTAssertGreaterThan(visiblePixelCount, 100)
    }

    func testActivityUsesBrowserUICodingKeys() throws {
        let activity = BrowserAgentActivity(
            id: "a1",
            action: "click",
            label: "Clicking Buy",
            phase: .started,
            timestamp: 1_234,
            agentCursor: BrowserAgentCursorState(x: 0.4, y: 0.6))
        let object = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(activity)) as? [String: Any]
        XCTAssertNotNil(object?["agentCursor"])
        XCTAssertEqual(object?["timestamp"] as? Double, 1_234)
    }

    @MainActor
    func testOperatingShaderConfigurationMatchesSharedPackage() {
        XCTAssertEqual(BrowserOperatingShaderVariant.allCases, [.subtle, .prism, .pulse, .tide])
        XCTAssertEqual(BrowserOperatingShaderVariant.pulse.defaults.direction, .leftToRight)
        XCTAssertEqual(BrowserOperatingShaderVariant.pulse.defaults.speed, .fast)
        XCTAssertEqual(BrowserOperatingShaderVariant.tide.defaults.direction, .topLeftToBottomRight)
        XCTAssertEqual(BrowserOperatingShaderDirection.leftToRight.rawValue, "left-to-right")
        XCTAssertEqual(BrowserOperatingShaderSpeed.slow.durationSeconds, 15)
        XCTAssertEqual(BrowserOperatingShaderSpeed.fast.durationSeconds, 7)

        let overlay = BrowserOperatingOverlay(
            label: "Testing",
            variant: .tide,
            direction: .rightToLeft,
            speed: .slow,
            takeControlLabel: "Stop agent",
            onTakeControl: {})
        XCTAssertEqual(overlay.variant, .tide)
        XCTAssertEqual(overlay.direction, .rightToLeft)
        XCTAssertEqual(overlay.speed, .slow)
        XCTAssertEqual(overlay.takeControlLabel, "Stop agent")
    }

    func testSessionLifecycleMatchesSharedFixture() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("core/test/fixtures/session-lifecycle.json")
        let fixture = try JSONDecoder().decode(
            LifecycleFixture.self,
            from: Data(contentsOf: fixtureURL))
        XCTAssertEqual(fixture.version, browserSessionLifecycleVersion)
        XCTAssertEqual(fixture.endReasons, BrowserSessionEndReason.allCases.map(\.rawValue))
        XCTAssertEqual(
            fixture.releaseOutcomes,
            BrowserSessionReleaseOutcome.allCases.map(\.rawValue))
        XCTAssertEqual(
            fixture.viewportModes,
            BrowserViewportPresentationMode.allCases.map(\.rawValue))

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        for request in fixture.validRequests {
            XCTAssertNoThrow(try decoder.decode(BrowserSessionEndRequest.self, from: request.data))
        }
        for request in fixture.invalidRequests {
            XCTAssertThrowsError(try decoder.decode(BrowserSessionEndRequest.self, from: request.data))
        }
        XCTAssertNoThrow(try decoder.decode(BrowserSessionEndReceipt.self, from: fixture.receipt.data))
        for request in fixture.validReleaseRequests {
            XCTAssertNoThrow(try decoder.decode(
                BrowserSessionReleaseRequest.self,
                from: request.data))
        }
        for request in fixture.invalidReleaseRequests {
            XCTAssertThrowsError(try decoder.decode(
                BrowserSessionReleaseRequest.self,
                from: request.data))
        }
        XCTAssertNoThrow(try decoder.decode(
            BrowserSessionReleaseReceipt.self,
            from: fixture.releaseReceipt.data))
    }

    func testEndReceiptIsTerminalAndRoundTrips() throws {
        let receipt = try BrowserSessionEndReceipt(
            sessionId: "session_one",
            reason: .userEnded,
            endedAt: Date(timeIntervalSince1970: 1_000))
        let data = try JSONEncoder().encode(receipt)
        let decoded = try JSONDecoder().decode(BrowserSessionEndReceipt.self, from: data)
        XCTAssertEqual(decoded.status, "ended")
        XCTAssertEqual(decoded, receipt)
    }

    func testReleaseReceiptPreservesAResumableSessionAndRoundTrips() throws {
        let request = try BrowserSessionReleaseRequest(
            releaseId: "release_one",
            sessionId: "session_one",
            outcome: .completed,
            label: "Configured the product",
            url: "https://example.com/configure",
            title: "Configure")
        let receipt = BrowserSessionReleaseReceipt(
            request: request,
            releasedAt: Date(timeIntervalSince1970: 1_000))
        let data = try JSONEncoder().encode(receipt)
        let decoded = try JSONDecoder().decode(
            BrowserSessionReleaseReceipt.self,
            from: data)
        XCTAssertEqual(decoded.status, "released")
        XCTAssertEqual(decoded.outcome, .completed)
        XCTAssertEqual(decoded, receipt)
    }
}
