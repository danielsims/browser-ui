import SwiftUI

/// Native implementation of browser-ui's operating shader and status pill.
public struct BrowserOperatingOverlay: View {
    public let label: String
    public let variant: BrowserOperatingShaderVariant
    public let direction: BrowserOperatingShaderDirection
    public let speed: BrowserOperatingShaderSpeed
    public let takeControlLabel: String
    private let onTakeControl: (() -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startedAt = Date()

    public init(
        label: String = "Agent is operating this browser",
        variant: BrowserOperatingShaderVariant = .subtle,
        direction: BrowserOperatingShaderDirection? = nil,
        speed: BrowserOperatingShaderSpeed? = nil,
        takeControlLabel: String = "Take control",
        onTakeControl: (() -> Void)? = nil
    ) {
        self.label = label
        self.variant = variant
        self.direction = direction ?? variant.defaults.direction
        self.speed = speed ?? variant.defaults.speed
        self.takeControlLabel = takeControlLabel
        self.onTakeControl = onTakeControl
    }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 60, paused: reduceMotion)) { timeline in
            // browser-ui starts u_time at zero when the overlay mounts. Using
            // the absolute reference date loses sub-second precision when it
            // is converted to the shader's float and visibly flattens motion.
            let elapsed = reduceMotion ? 5.0 : timeline.date.timeIntervalSince(startedAt)
            GeometryReader { proxy in
                ZStack(alignment: .bottom) {
                    Rectangle()
                        // A fully transparent source can be culled before a
                        // colorEffect runs. The shader replaces these pixels,
                        // so use an opaque raster source just as the WebGL
                        // canvas supplies a real fragment for every pixel.
                        .fill(.white)
                        .colorEffect(operatingShader(size: proxy.size, time: elapsed))
                        .opacity(0.9)
                        .allowsHitTesting(false)
                    operatingPill(time: elapsed)
                        .padding(.horizontal, 18)
                        .padding(.bottom, 18 + proxy.safeAreaInsets.bottom)
                }
            }
        }
    }

    private func operatingShader(size: CGSize, time: TimeInterval) -> Shader {
        let resolution: Shader.Argument = .float2(size)
        let elapsed: Shader.Argument = .float(Float(time))
        let direction: Shader.Argument = .float2(direction.vector)
        let speed: Shader.Argument = .float(1 / speed.durationSeconds)
        return switch variant {
        case .subtle:
            ShaderLibrary.bundle(.module).browserOperatingShader(resolution, elapsed)
        case .prism:
            ShaderLibrary.bundle(.module).browserOperatingPrismShader(
                resolution, elapsed, direction, speed)
        case .pulse:
            ShaderLibrary.bundle(.module).browserOperatingPulseShader(
                resolution, elapsed, direction, speed)
        case .tide:
            ShaderLibrary.bundle(.module).browserOperatingTideShader(
                resolution, elapsed, direction, speed)
        }
    }

    @ViewBuilder
    private func operatingPill(time: TimeInterval) -> some View {
        if let onTakeControl {
            Button(action: onTakeControl) {
                operatingPillContent(time: time, showsTakeControl: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(takeControlLabel)
            .accessibilityHint("Stops the agent and leaves the browser open for you")
        } else {
            operatingPillContent(time: time, showsTakeControl: false)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(label)
        }
    }

    private func operatingPillContent(
        time: TimeInterval,
        showsTakeControl: Bool
    ) -> some View {
        let shimmer = reduceMotion ? 0.5 : time.truncatingRemainder(dividingBy: 2) / 2
        return HStack(spacing: 9) {
            Text(label)
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(LinearGradient(
                    colors: [.white.opacity(0.58), .white, .white.opacity(0.58)],
                    startPoint: UnitPoint(x: -3 + shimmer * 6, y: 0.5),
                    endPoint: UnitPoint(x: -1 + shimmer * 6, y: 0.5)))
            if showsTakeControl {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white.opacity(0.72))
                    .accessibilityHidden(true)
            }
        }
            .font(.system(size: 12, weight: .medium))
            .tracking(-0.144)
            .padding(.horizontal, 13)
            .frame(height: 36)
            .background(.black.opacity(0.92), in: Capsule())
            .overlay {
                Capsule()
                    .stroke(.white.opacity(0.14), lineWidth: 1)
                    .overlay(alignment: .top) {
                        Capsule()
                            .trim(from: 0.08, to: 0.42)
                            .stroke(.white.opacity(0.10), lineWidth: 1)
                    }
            }
            .shadow(color: .black.opacity(0.34), radius: 30, y: 10)
            .shadow(color: .black.opacity(0.22), radius: 8, y: 2)
    }
}
