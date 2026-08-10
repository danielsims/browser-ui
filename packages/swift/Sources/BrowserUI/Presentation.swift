import Foundation

/// Where a browser viewer is presented in its host interface. This mirrors
/// `BrowserDisplayMode` from `@browser-ui/react`; viewport sizing remains a
/// separate concern because inline and picture-in-picture both use preview
/// geometry while fullscreen uses takeover geometry.
public enum BrowserDisplayMode: String, Codable, CaseIterable, Sendable {
    case inline
    case pictureInPicture = "picture-in-picture"
    case fullscreen
}

/// Mirrors `BrowserAgentCursorState` from `@browser-ui/core` so activities can
/// cross a WebSocket or recording boundary without platform-specific fields.
public struct BrowserAgentCursorState: Codable, Equatable, Sendable {
    public enum Variant: String, Codable, Equatable, Sendable {
        case light
        case dark
    }

    public var x: Double
    public var y: Double
    public var label: String?
    public var pressed: Bool
    public var typing: Bool
    public var visible: Bool
    public var variant: Variant
    public var size: Double
    public var backgroundColor: String

    public init(
        x: Double,
        y: Double,
        label: String? = nil,
        pressed: Bool = false,
        typing: Bool = false,
        visible: Bool = true,
        variant: Variant = .dark,
        size: Double = 32,
        backgroundColor: String = "#2f6bff"
    ) {
        self.x = min(max(x, 0), 1)
        self.y = min(max(y, 0), 1)
        self.label = label
        self.pressed = pressed
        self.typing = typing
        self.visible = visible
        self.variant = variant
        self.size = max(size, 1)
        self.backgroundColor = backgroundColor
    }
}

/// Swift representation of browser-ui's v1 activity message.
public struct BrowserAgentActivity: Codable, Equatable, Sendable, Identifiable {
    public enum Phase: String, Codable, Equatable, Sendable {
        case started
        case completed
    }

    public var id: String
    public var action: String
    public var label: String
    public var phase: Phase
    /// Unix timestamp in milliseconds, matching the TypeScript protocol.
    public var timestamp: Double
    public var agentCursor: BrowserAgentCursorState?
    public var success: Bool?
    public var durationMs: Double?

    public init(
        id: String,
        action: String,
        label: String,
        phase: Phase,
        timestamp: Double,
        agentCursor: BrowserAgentCursorState? = nil,
        success: Bool? = nil,
        durationMs: Double? = nil
    ) {
        self.id = id
        self.action = action
        self.label = label
        self.phase = phase
        self.timestamp = timestamp
        self.agentCursor = agentCursor
        self.success = success
        self.durationMs = durationMs
    }
}
