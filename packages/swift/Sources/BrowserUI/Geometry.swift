import CoreGraphics

/// Preview preserves the agent's stable canvas; takeover uses viewer bounds.
public enum BrowserViewportPresentationMode: String, Codable, CaseIterable, Sendable {
    case preview
    case takeover
}

/// Equivalent to `mapContainedPointToViewport` geometry in browser-ui core.
public func containedViewportRect(
    container: CGSize,
    viewport: CGSize?
) -> CGRect {
    guard let viewport, viewport.width > 0, viewport.height > 0 else {
        return CGRect(origin: .zero, size: container)
    }
    let scale = min(container.width / viewport.width, container.height / viewport.height)
    let size = CGSize(width: viewport.width * scale, height: viewport.height * scale)
    return CGRect(
        x: (container.width - size.width) / 2,
        y: (container.height - size.height) / 2,
        width: size.width,
        height: size.height)
}
