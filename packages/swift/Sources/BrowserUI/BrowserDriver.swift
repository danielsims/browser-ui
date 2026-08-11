import Foundation

public let browserDriverContractVersion = 1

public enum BrowserDriverKind: String, Codable, CaseIterable, Sendable {
    case agentBrowser = "agent-browser"
    case webKit = "webkit"
}

public enum BrowserDriverCapability: String, Codable, CaseIterable, Sendable {
    case navigation
    case history
    case semanticSnapshot = "semantic-snapshot"
    case screenshot
    case elementClick = "element-click"
    case textInput = "text-input"
    case keyboardInput = "keyboard-input"
    case scriptEvaluation = "script-evaluation"
    case viewport
    case nativeSurface = "native-surface"
    case remoteFrameStream = "remote-frame-stream"
    case pointerInput = "pointer-input"
    case wait
    case scroll
    case hover
    case dragAndDrop = "drag-and-drop"
    case selection
    case tabs
    case dialogs
    case downloads
    case uploads
    case cookies
    case storage
    case networkInspection = "network-inspection"
    case console
    case pdf
    case recording
}

public enum BrowserDriverContractError: LocalizedError, Equatable {
    case invalidDescriptor
    case unsupportedCapability(BrowserDriverCapability)

    public var errorDescription: String? {
        switch self {
        case .invalidDescriptor:
            return "The browser driver descriptor is invalid."
        case .unsupportedCapability(let capability):
            return "The browser driver does not support \(capability.rawValue)."
        }
    }
}

public struct BrowserDriverDescriptor: Codable, Equatable, Sendable {
    public let version: Int
    public let id: String
    public let kind: BrowserDriverKind
    public let capabilities: [BrowserDriverCapability]

    public init(
        id: String,
        kind: BrowserDriverKind,
        capabilities: [BrowserDriverCapability]
    ) throws {
        guard id.count <= 160,
              id.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil,
              Set(capabilities).count == capabilities.count else {
            throw BrowserDriverContractError.invalidDescriptor
        }
        self.version = browserDriverContractVersion
        self.id = id
        self.kind = kind
        self.capabilities = capabilities
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard try container.decode(Int.self, forKey: .version) == browserDriverContractVersion else {
            throw BrowserDriverContractError.invalidDescriptor
        }
        try self.init(
            id: container.decode(String.self, forKey: .id),
            kind: container.decode(BrowserDriverKind.self, forKey: .kind),
            capabilities: container.decode([BrowserDriverCapability].self, forKey: .capabilities))
    }

    public func supports(_ capability: BrowserDriverCapability) -> Bool {
        capabilities.contains(capability)
    }
}

public enum BrowserDriverPhase: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case failed(String)
}

public enum BrowserDriverScrollDirection: String, Codable, CaseIterable, Sendable {
    case up
    case down
    case left
    case right
}

public enum BrowserDriverWaitCondition: Equatable, Sendable {
    case duration(milliseconds: Int)
    case text(String)
    case urlContains(String)
    case load
    case javaScript(String)
}

/// Minimal lifecycle shared by local and remote browser implementations.
/// Presentation layers inspect `descriptor` instead of assuming behavior from
/// a concrete driver type.
@MainActor
public protocol BrowserDriver: AnyObject {
    var descriptor: BrowserDriverDescriptor { get }
    var scope: String? { get }
    var lifecycleSessionId: String? { get }
    var phase: BrowserDriverPhase { get }
    var isEngaged: Bool { get }

    func begin(scope: String)
    func disconnect()
    func end()
}

/// Agent-facing semantic operations implemented by the native WebKit driver
/// and available to other drivers when their capability set permits them.
@MainActor
public protocol BrowserSemanticAutomationDriver: BrowserDriver {
    func navigate(_ target: String) async throws -> String
    func snapshot() async throws -> String
    func captureScreenshot() async throws -> String
    func evaluate(_ javascript: String) async throws -> String
    func click(target: String) async throws -> String
    func type(target: String, text: String) async throws -> String
    func press(key: String, target: String?) async throws -> String
    func goBack() async throws -> String
    func goForward() async throws -> String
    func reload() async throws -> String
    func scroll(
        direction: BrowserDriverScrollDirection,
        amount: Double
    ) async throws -> String
    func select(target: String, values: [String]) async throws -> String
    func setChecked(target: String, checked: Bool) async throws -> String
    func wait(for condition: BrowserDriverWaitCondition) async throws -> String
}
