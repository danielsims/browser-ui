import CoreGraphics
import XCTest
@testable import BrowserUI

final class BrowserUITests: XCTestCase {
    func testContainedViewportIsLetterboxed() {
        let rect = containedViewportRect(
            container: CGSize(width: 1600, height: 900),
            viewport: CGSize(width: 1440, height: 900))
        XCTAssertEqual(rect, CGRect(x: 80, y: 0, width: 1440, height: 900))
    }

    func testCursorCoordinatesClampToProtocolRange() {
        let cursor = BrowserAgentCursorState(x: -2, y: 4)
        XCTAssertEqual(cursor.x, 0)
        XCTAssertEqual(cursor.y, 1)
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

    func testOperatingShaderConfigurationMatchesSharedPackage() {
        XCTAssertEqual(BrowserOperatingShaderVariant.allCases, [.subtle, .prism, .pulse, .tide])
        XCTAssertEqual(BrowserOperatingShaderVariant.pulse.defaults.direction, .leftToRight)
        XCTAssertEqual(BrowserOperatingShaderVariant.pulse.defaults.speed, .fast)
        XCTAssertEqual(BrowserOperatingShaderVariant.tide.defaults.direction, .topLeftToBottomRight)
        XCTAssertEqual(BrowserOperatingShaderDirection.leftToRight.rawValue, "left-to-right")
        XCTAssertEqual(BrowserOperatingShaderSpeed.slow.durationSeconds, 15)
        XCTAssertEqual(BrowserOperatingShaderSpeed.fast.durationSeconds, 7)
    }
}
