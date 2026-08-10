import SwiftUI

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
