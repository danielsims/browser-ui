import SwiftUI

/// Package-owned presentation control matching
/// `BrowserPictureInPictureTrigger` from `@browser-ui/react`.
public struct BrowserPictureInPictureButton: View {
    private let active: Bool
    private let action: @MainActor () -> Void

    public init(
        active: Bool,
        action: @escaping @MainActor () -> Void
    ) {
        self.active = active
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            BrowserPictureInPictureIcon()
                .stroke(
                    Color.white,
                    style: StrokeStyle(lineWidth: 1.3, lineCap: .round, lineJoin: .round))
                .frame(width: 14, height: 14)
                .frame(width: 30, height: 30)
                .background(
                    Color(white: 12.0 / 255.0).opacity(0.72),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(.white.opacity(0.16), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.2), radius: 8, y: 5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            active ? "Return browser to conversation" : "Keep browser above composer")
    }
}

private struct BrowserPictureInPictureIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let scaleX = rect.width / 16
        let scaleY = rect.height / 16

        var path = Path()
        path.addRoundedRect(
            in: CGRect(x: 2 * scaleX, y: 3 * scaleY, width: 12 * scaleX, height: 10 * scaleY),
            cornerSize: CGSize(width: 1.5 * scaleX, height: 1.5 * scaleY))
        path.addRoundedRect(
            in: CGRect(x: 8 * scaleX, y: 7 * scaleY, width: 4 * scaleX, height: 3.5 * scaleY),
            cornerSize: CGSize(width: 0.5 * scaleX, height: 0.5 * scaleY))
        return path
    }
}

/// Package-owned terminal lifecycle action. Dismissing a presentation must use
/// a separate control and must not call this action implicitly.
public struct BrowserEndSessionButton: View {
    private let label: String
    private let action: @MainActor () async -> Void
    @State private var ending = false

    public init(
        label: String = "End browsing session",
        action: @escaping @MainActor () async -> Void
    ) {
        self.label = label
        self.action = action
    }

    public var body: some View {
        Button {
            guard !ending else { return }
            ending = true
            Task { @MainActor in
                await action()
                ending = false
            }
        } label: {
            Group {
                if ending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "stop.circle")
                        .font(.system(size: 15, weight: .semibold))
                }
            }
            .frame(width: 36, height: 36)
            .foregroundStyle(.white)
            .background(.black.opacity(0.58), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(ending)
        .accessibilityLabel(ending ? "Ending browsing session" : label)
    }
}

/// Compact terminal artifact for a transcript after the live viewer is gone.
public struct BrowserSessionEndedView: View {
    private let label: String
    private let endedAt: Date?

    public init(
        label: String = "Browsing session ended",
        endedAt: Date? = nil
    ) {
        self.label = label
        self.endedAt = endedAt
    }

    public var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 20, height: 20)
                .background(.quaternary, in: Circle())
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if let endedAt {
                Text(endedAt, style: .time)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 42)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }
}

/// Compact, resumable browser artifact modeled after Buzz and Chief. This is
/// deliberately distinct from `BrowserSessionEndedView`: release transfers
/// control and collapses presentation without terminating the session.
public struct BrowserSessionReleasedView: View {
    private let label: String
    private let detail: String?
    private let action: @MainActor () -> Void

    public init(
        label: String = "Browsing session complete",
        detail: String? = nil,
        action: @escaping @MainActor () -> Void
    ) {
        self.label = label
        self.detail = detail
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "rectangle.on.rectangle")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(.quaternary.opacity(0.7), in: RoundedRectangle(
                        cornerRadius: 8,
                        style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                HStack(spacing: 4) {
                    Text("View session")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.quaternary.opacity(0.38), in: RoundedRectangle(
                cornerRadius: 13,
                style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(.quaternary, lineWidth: 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label), View session")
    }
}
