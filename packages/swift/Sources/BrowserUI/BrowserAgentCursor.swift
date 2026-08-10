import SwiftUI

/// Transport-neutral cursor for visualizing recorded or live agent actions.
public struct BrowserAgentCursor: View {
    public let state: BrowserAgentCursorState
    public let containedViewport: CGSize?

    public init(
        state: BrowserAgentCursorState,
        containedViewport: CGSize? = nil
    ) {
        self.state = state
        self.containedViewport = containedViewport
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 60, paused: !state.typing)) { timeline in
            GeometryReader { proxy in
                let rect = containedViewportRect(
                    container: proxy.size,
                    viewport: containedViewport)
                let size = CGFloat(state.size)
                let typingOffset = state.typing
                    ? -0.5 - 0.5 * sin(timeline.date.timeIntervalSinceReferenceDate * .pi * 2 / 0.7)
                    : 0
                cursorGlyph(typingOffset: typingOffset)
                    // CSS positions the cursor's top-left at x/y then applies
                    // translate3d(-2px,-2px,0). SwiftUI `position` uses the
                    // center, so account for half the glyph size explicitly.
                    .position(
                        x: rect.minX + CGFloat(state.x) * rect.width + size / 2 - 2,
                        y: rect.minY + CGFloat(state.y) * rect.height + size / 2 - 2)
                    .opacity(state.visible ? 1 : 0)
                    .animation(
                        .timingCurve(0.22, 1, 0.36, 1, duration: 0.68),
                        value: state.x)
                    .animation(
                        .timingCurve(0.22, 1, 0.36, 1, duration: 0.68),
                        value: state.y)
                    .animation(.easeOut(duration: 0.18), value: state.visible)
            }
        }
        // The cursor is an overlay coordinate space, not content with an
        // intrinsic size. A text label previously gave some hosts an accidental
        // layout size; pointer-only cursors must still occupy the full surface.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func cursorGlyph(typingOffset: CGFloat) -> some View {
        let background = Color(browserUIHex: state.backgroundColor)
        let fill: Color = state.variant == .dark ? .black : .white
        let outline: Color = state.variant == .dark ? .white : .black
        let size = CGFloat(state.size)
        let glowOffset = size <= 32 ? -0.03 : size <= 64 ? -0.02 : 0
        return ZStack(alignment: .topLeading) {
            Circle()
                .fill(RadialGradient(
                    gradient: Gradient(stops: [
                        .init(color: background.opacity(0.95), location: 0),
                        .init(color: background.opacity(0.55), location: 0.43),
                        .init(color: .clear, location: 0.74),
                    ]),
                    center: .center,
                    startRadius: 0,
                    endRadius: size * 0.675))
                .frame(width: size * 1.35, height: size * 1.35)
                .opacity(0.5)
                .blur(radius: size * 0.16)
                .position(
                    x: size / 2 + size * glowOffset,
                    y: size / 2)

            ZStack {
                CursorArrow()
                    .fill(outline)
                    .overlay {
                        CursorArrow().stroke(
                            outline,
                            style: StrokeStyle(
                                lineWidth: 4,
                                lineCap: .round,
                                lineJoin: .round))
                    }
                CursorArrow().fill(fill)
            }
            .frame(width: size, height: size)
            .shadow(
                color: .black.opacity(0.2),
                radius: size * 0.04,
                y: size * 0.05)
            .scaleEffect(
                state.pressed ? 0.82 : 1,
                anchor: UnitPoint(x: 0.12, y: 0.10))
            .offset(y: typingOffset)
            .animation(
                .timingCurve(0.2, 0.8, 0.2, 1, duration: 0.12),
                value: state.pressed)

            if let label = state.label, !label.isEmpty {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 7)
                    .frame(height: 18)
                    .background(
                        Color(red: 8 / 255, green: 8 / 255, blue: 8 / 255).opacity(0.88),
                        in: RoundedRectangle(cornerRadius: 6))
                    .shadow(color: .black.opacity(0.2), radius: 14, y: 4)
                    .offset(x: size + 2, y: 20)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        // Match the React cursor's absolute-positioning box. The optional
        // label overflows this box and therefore cannot shift the pointer tip.
        .frame(width: size, height: size, alignment: .topLeading)
    }
}

private struct CursorArrow: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24
        let sy = rect.height / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x * sx, y: y * sy)
        }
        var path = Path()
        path.move(to: point(6.05, 3.02))
        path.addCurve(to: point(5.20, 3.40), control1: point(5.72, 2.70), control2: point(5.20, 2.94))
        path.addLine(to: point(5.20, 20.48))
        path.addCurve(to: point(6.38, 20.96), control1: point(5.20, 21.12), control2: point(5.96, 21.38))
        path.addLine(to: point(11.06, 16.28))
        path.addCurve(to: point(11.57, 16.06), control1: point(11.20, 16.14), control2: point(11.38, 16.06))
        path.addLine(to: point(18.50, 16.06))
        path.addCurve(to: point(18.97, 14.84), control1: point(19.14, 16.06), control2: point(19.43, 15.29))
        path.closeSubpath()
        return path
    }
}

private extension Color {
    init(browserUIHex raw: String) {
        let value = raw.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let number = UInt64(value, radix: 16) else {
            self = Color(red: 0.18, green: 0.42, blue: 1)
            return
        }
        self = Color(
            red: Double((number >> 16) & 0xff) / 255,
            green: Double((number >> 8) & 0xff) / 255,
            blue: Double(number & 0xff) / 255)
    }
}
