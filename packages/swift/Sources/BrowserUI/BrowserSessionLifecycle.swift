import Foundation

public let browserSessionLifecycleVersion = 1

public enum BrowserSessionEndReason: String, Codable, CaseIterable, Sendable {
    case completed
    case userEnded = "user-ended"
    case replaced
    case unavailable
}

public enum BrowserSessionLifecycleError: LocalizedError, Equatable {
    case invalidIdentifier(String)
    case invalidVersion(Int)
    case invalidStatus(String)
    case invalidTimestamp(String)

    public var errorDescription: String? {
        switch self {
        case .invalidIdentifier(let field):
            return "Browser session \(field) is invalid."
        case .invalidVersion(let version):
            return "Unsupported browser session lifecycle version \(version)."
        case .invalidStatus(let status):
            return "Browser session end receipt has invalid status \(status)."
        case .invalidTimestamp(let timestamp):
            return "Browser session end receipt has invalid timestamp \(timestamp)."
        }
    }
}

/// Portable intent for terminating a browser session rather than hiding it.
public struct BrowserSessionEndRequest: Codable, Equatable, Sendable {
    public let version: Int
    public let sessionId: String
    public let clientInstanceId: String
    public let reason: BrowserSessionEndReason

    public init(
        sessionId: String,
        clientInstanceId: String,
        reason: BrowserSessionEndReason = .userEnded
    ) throws {
        try Self.validateIdentifier(sessionId, field: "sessionId")
        try Self.validateIdentifier(clientInstanceId, field: "clientInstanceId")
        self.version = browserSessionLifecycleVersion
        self.sessionId = sessionId
        self.clientInstanceId = clientInstanceId
        self.reason = reason
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version == browserSessionLifecycleVersion else {
            throw BrowserSessionLifecycleError.invalidVersion(version)
        }
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let clientInstanceId = try container.decode(String.self, forKey: .clientInstanceId)
        try Self.validateIdentifier(sessionId, field: "sessionId")
        try Self.validateIdentifier(clientInstanceId, field: "clientInstanceId")
        self.version = version
        self.sessionId = sessionId
        self.clientInstanceId = clientInstanceId
        self.reason = try container.decode(BrowserSessionEndReason.self, forKey: .reason)
    }

    private static func validateIdentifier(_ value: String, field: String) throws {
        let valid = value.count <= 160 && value.range(
            of: #"^[A-Za-z0-9_-]+$"#,
            options: .regularExpression) != nil
        guard valid else { throw BrowserSessionLifecycleError.invalidIdentifier(field) }
    }
}

/// Authoritative acknowledgement that a browser session is terminal.
public struct BrowserSessionEndReceipt: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case version
        case sessionId
        case status
        case reason
        case endedAt
    }

    public let version: Int
    public let sessionId: String
    public let status: String
    public let reason: BrowserSessionEndReason
    public let endedAt: Date

    public init(
        sessionId: String,
        reason: BrowserSessionEndReason,
        endedAt: Date = Date()
    ) throws {
        let request = try BrowserSessionEndRequest(
            sessionId: sessionId,
            clientInstanceId: "receipt",
            reason: reason)
        self.version = request.version
        self.sessionId = request.sessionId
        self.status = "ended"
        self.reason = reason
        self.endedAt = endedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version == browserSessionLifecycleVersion else {
            throw BrowserSessionLifecycleError.invalidVersion(version)
        }
        let status = try container.decode(String.self, forKey: .status)
        guard status == "ended" else {
            throw BrowserSessionLifecycleError.invalidStatus(status)
        }
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        _ = try BrowserSessionEndRequest(
            sessionId: sessionId,
            clientInstanceId: "receipt")
        self.version = version
        self.sessionId = sessionId
        self.status = status
        self.reason = try container.decode(BrowserSessionEndReason.self, forKey: .reason)
        let timestamp = try container.decode(String.self, forKey: .endedAt)
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        guard let endedAt = fractional.date(from: timestamp) ?? standard.date(from: timestamp) else {
            throw BrowserSessionLifecycleError.invalidTimestamp(timestamp)
        }
        self.endedAt = endedAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(status, forKey: .status)
        try container.encode(reason, forKey: .reason)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try container.encode(formatter.string(from: endedAt), forKey: .endedAt)
    }
}
