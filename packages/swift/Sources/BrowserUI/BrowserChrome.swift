import SwiftUI

/// Native browser-ui framed chrome. Measurements and colors mirror the React
/// `.bui-browser-frame--framed` and `.bui-toolbar` contract.
public struct BrowserFrame<Toolbar: View, Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    private let toolbar: Toolbar
    private let content: Content
    private let showsToolbar: Bool

    public init(
        @ViewBuilder toolbar: () -> Toolbar,
        @ViewBuilder content: () -> Content
    ) {
        self.toolbar = toolbar()
        self.content = content()
        self.showsToolbar = true
    }

    public init(
        @ViewBuilder content: () -> Content
    ) where Toolbar == EmptyView {
        self.toolbar = EmptyView()
        self.content = content()
        self.showsToolbar = false
    }

    public var body: some View {
        VStack(spacing: showsToolbar ? 6 : 0) {
            if showsToolbar {
                toolbar
                    .frame(maxWidth: .infinity)
                    .frame(height: 39)
                    .padding(.horizontal, 8)
                    .background(toolbarBackground)
            }
            content
                .background(surfaceBackground)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .padding(.horizontal, 6)
        .padding(.top, showsToolbar ? 0 : 6)
        .padding(.bottom, 6)
        .background(frameBackground)
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(frameBorder, lineWidth: 1)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(.white.opacity(colorScheme == .dark ? 0.06 : 0.8))
                .frame(height: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 30, y: 22)
    }

    private var frameBackground: Color {
        colorScheme == .dark
            ? Color(red: 35 / 255, green: 35 / 255, blue: 34 / 255).opacity(0.90)
            : Color(red: 232 / 255, green: 232 / 255, blue: 230 / 255).opacity(0.86)
    }

    private var frameBorder: Color {
        colorScheme == .dark ? .white.opacity(0.15) : .black.opacity(0.14)
    }

    private var toolbarBackground: Color {
        colorScheme == .dark
            ? Color(red: 27 / 255, green: 27 / 255, blue: 26 / 255).opacity(0.88)
            : Color(red: 245 / 255, green: 245 / 255, blue: 243 / 255).opacity(0.82)
    }

    private var surfaceBackground: Color {
        colorScheme == .dark ? Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255) : .white
    }
}

/// Exact browser-ui address-field treatment for hosts providing their own
/// navigation controls.
public struct BrowserAddressField<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(Color(red: 75 / 255, green: 176 / 255, blue: 106 / 255))
                .frame(width: 6, height: 6)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity)
        .frame(height: 28)
        .background(
            colorScheme == .dark ? .white.opacity(0.075) : .white.opacity(0.82),
            in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(
                    colorScheme == .dark ? .white.opacity(0.10) : .black.opacity(0.08),
                    lineWidth: 1)
        }
    }
}

public struct BrowserToolbarButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color(red: 119 / 255, green: 119 / 255, blue: 119 / 255))
            .frame(width: 28, height: 28)
            .background(
                configuration.isPressed ? .black.opacity(0.055) : .clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
