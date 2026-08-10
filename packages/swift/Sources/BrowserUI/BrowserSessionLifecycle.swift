import Foundation

public let browserSessionLifecycleVersion = 1

public enum BrowserSessionEndReason: String, Codable, CaseIterable, Sendable {
    case completed
    case userEnded = "user-ended"
    case replaced
    case unavailable
}

/// Why an agent released control while preserving a resumable browser.
public enum BrowserSessionReleaseOutcome: String, Codable, CaseIterable, Sendable {
    case completed
    case waiting
}

public enum BrowserSessionLifecycleError: LocalizedError, Equatable {
    case invalidIdentifier(String)
    case invalidVersion(Int)
    case invalidStatus(String)
    case invalidTimestamp(String)
    case invalidURL

    public var errorDescription: String? {
        switch self {
        case .invalidIdentifier(let field):
            return "Browser session \(field) is invalid."
        case .invalidVersion(let version):
            return "Unsupported browser session lifecycle version \(version)."
        case .invalidStatus(let status):
            return "Browser session lifecycle receipt has invalid status \(status)."
        case .invalidTimestamp(let timestamp):
            return "Browser session lifecycle receipt has invalid timestamp \(timestamp)."
        case .invalidURL:
            return "Browser session release URL is invalid."
        }
    }
}

/// Portable intent for relinquishing agent control without terminating the
/// underlying page, history, cookies, or WebKit process.
public struct BrowserSessionReleaseRequest: Codable, Equatable, Sendable {
    public let version: Int
    public let releaseId: String
    public let sessionId: String
    public let outcome: BrowserSessionReleaseOutcome
    public let label: String?
    public let url: String?
    public let title: String?

    public init(
        releaseId: String,
        sessionId: String,
        outcome: BrowserSessionReleaseOutcome,
        label: String? = nil,
        url: String? = nil,
        title: String? = nil
    ) throws {
        try validateBrowserSessionIdentifier(releaseId, field: "releaseId")
        try validateBrowserSessionIdentifier(sessionId, field: "sessionId")
        try validateBrowserSessionURL(url)
        self.version = browserSessionLifecycleVersion
        self.releaseId = releaseId
        self.sessionId = sessionId
        self.outcome = outcome
        self.label = normalizedBrowserSessionText(label, maximumLength: 160)
        self.url = url
        self.title = normalizedBrowserSessionText(title, maximumLength: 256)
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version == browserSessionLifecycleVersion else {
            throw BrowserSessionLifecycleError.invalidVersion(version)
        }
        try self.init(
            releaseId: container.decode(String.self, forKey: .releaseId),
            sessionId: container.decode(String.self, forKey: .sessionId),
            outcome: container.decode(BrowserSessionReleaseOutcome.self, forKey: .outcome),
            label: container.decodeIfPresent(String.self, forKey: .label),
            url: container.decodeIfPresent(String.self, forKey: .url),
            title: container.decodeIfPresent(String.self, forKey: .title))
    }
}

/// Durable acknowledgement that agent control was released but the browser is
/// still resumable by the user or a later turn.
public struct BrowserSessionReleaseReceipt: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case version, releaseId, sessionId, status, outcome, label, url, title, releasedAt
    }

    public let version: Int
    public let releaseId: String
    public let sessionId: String
    public let status: String
    public let outcome: BrowserSessionReleaseOutcome
    public let label: String?
    public let url: String?
    public let title: String?
    public let releasedAt: Date

    public init(request: BrowserSessionReleaseRequest, releasedAt: Date = Date()) {
        version = request.version
        releaseId = request.releaseId
        sessionId = request.sessionId
        status = "released"
        outcome = request.outcome
        label = request.label
        url = request.url
        title = request.title
        self.releasedAt = releasedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version == browserSessionLifecycleVersion else {
            throw BrowserSessionLifecycleError.invalidVersion(version)
        }
        let status = try container.decode(String.self, forKey: .status)
        guard status == "released" else {
            throw BrowserSessionLifecycleError.invalidStatus(status)
        }
        let request = try BrowserSessionReleaseRequest(
            releaseId: container.decode(String.self, forKey: .releaseId),
            sessionId: container.decode(String.self, forKey: .sessionId),
            outcome: container.decode(BrowserSessionReleaseOutcome.self, forKey: .outcome),
            label: container.decodeIfPresent(String.self, forKey: .label),
            url: container.decodeIfPresent(String.self, forKey: .url),
            title: container.decodeIfPresent(String.self, forKey: .title))
        let timestamp = try container.decode(String.self, forKey: .releasedAt)
        guard let releasedAt = parseBrowserSessionTimestamp(timestamp) else {
            throw BrowserSessionLifecycleError.invalidTimestamp(timestamp)
        }
        self.init(request: request, releasedAt: releasedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(releaseId, forKey: .releaseId)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(status, forKey: .status)
        try container.encode(outcome, forKey: .outcome)
        try container.encodeIfPresent(label, forKey: .label)
        try container.encodeIfPresent(url, forKey: .url)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(formatBrowserSessionTimestamp(releasedAt), forKey: .releasedAt)
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
        try validateBrowserSessionIdentifier(sessionId, field: "sessionId")
        try validateBrowserSessionIdentifier(clientInstanceId, field: "clientInstanceId")
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
        try validateBrowserSessionIdentifier(sessionId, field: "sessionId")
        try validateBrowserSessionIdentifier(clientInstanceId, field: "clientInstanceId")
        self.version = version
        self.sessionId = sessionId
        self.clientInstanceId = clientInstanceId
        self.reason = try container.decode(BrowserSessionEndReason.self, forKey: .reason)
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
        guard let endedAt = parseBrowserSessionTimestamp(timestamp) else {
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
        try container.encode(formatBrowserSessionTimestamp(endedAt), forKey: .endedAt)
    }
}

private func validateBrowserSessionIdentifier(_ value: String, field: String) throws {
    let valid = value.count <= 160 && value.range(
        of: #"^[A-Za-z0-9_-]+$"#,
        options: .regularExpression) != nil
    guard valid else { throw BrowserSessionLifecycleError.invalidIdentifier(field) }
}

private func validateBrowserSessionURL(_ value: String?) throws {
    guard let value else { return }
    guard value.count <= 2_048,
          let url = URL(string: value),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.user == nil,
          url.password == nil else {
        throw BrowserSessionLifecycleError.invalidURL
    }
}

private func normalizedBrowserSessionText(
    _ value: String?,
    maximumLength: Int
) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else { return nil }
    return String(trimmed.prefix(maximumLength))
}

private func parseBrowserSessionTimestamp(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let standard = ISO8601DateFormatter()
    return fractional.date(from: value) ?? standard.date(from: value)
}

private func formatBrowserSessionTimestamp(_ value: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: value)
}
