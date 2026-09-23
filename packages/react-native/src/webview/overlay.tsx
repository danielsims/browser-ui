import { useCallback, useEffect, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import type { WebViewBrowserCursor } from "./driver";
import type { OperatingShaderConfig } from "./shader";
import { ShaderLayer } from "./shader";

export interface OperatingOverlayProps {
  label: string;
  operating: boolean;
  shader?: OperatingShaderConfig;
}

/**
 * The native action pill and operating wash, kept for consumers that render an
 * agent surface outside a `WebView` (for example the JPEG stream). When a
 * shader config is supplied the canonical Browser UI GLSL runs on an `expo-gl`
 * surface. If `expo-gl` is missing or the shader cannot start, the `Animated`
 * approximation, the green/pink wash plus a slow diagonal sweep, takes over
 * so stream-only consumers still see an operating state.
 *
 * `<WebViewBrowser>` does not use this: a native `WKWebView` composes above its
 * RN siblings on iOS, so it injects the overlay into the page instead. Compose
 * this directly only when the surface is not a `WebView`.
 */
export function OperatingOverlay({
  label,
  operating,
  shader,
}: OperatingOverlayProps) {
  const scheme = useColorScheme();
  const { width } = useWindowDimensions();
  const [sweep] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const [shaderFailed, setShaderFailed] = useState(false);
  const onShaderUnavailable = useCallback(() => setShaderFailed(true), []);

  useEffect(() => {
    if (!operating) return;
    sweep.setValue(0);
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 4200,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => {
      sweepLoop.stop();
      pulseLoop.stop();
    };
  }, [operating, pulse, sweep]);

  if (!operating) return null;

  const band = Math.max(width * 0.8, 220);
  const forward = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-band, width + band],
  });
  const backward = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [width + band, -band],
  });
  const tint = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0.95],
  });

  return (
    <View accessibilityElementsHidden pointerEvents="none" style={styles.fill}>
      {shader !== undefined && !shaderFailed ? (
        <ShaderLayer config={shader} onUnavailable={onShaderUnavailable} />
      ) : (
        <>
          <View
            style={[
              styles.scrim,
              scheme === "dark" ? styles.scrimDark : styles.scrimLight,
            ]}
          />
          <Animated.View
            style={[
              styles.band,
              styles.bandGreen,
              { transform: [{ translateX: forward }, { rotate: "-18deg" }] },
            ]}
          />
          <Animated.View
            style={[
              styles.band,
              styles.bandPink,
              { transform: [{ translateX: backward }, { rotate: "14deg" }] },
            ]}
          />
          <Animated.View style={[styles.tintPulse, { opacity: tint }]} />
          <Animated.View style={[styles.topLine, { opacity: tint }]} />
        </>
      )}
      <View style={styles.pillRow}>
        <View
          style={[
            styles.pill,
            scheme === "dark" ? styles.pillDark : styles.pillLight,
          ]}
        >
          <Animated.View
            style={[
              styles.pillDot,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.4, 1],
                }),
              },
            ]}
          />
          <Text numberOfLines={1} style={styles.pillText}>
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}

export interface AgentCursorProps {
  cursor: WebViewBrowserCursor | null;
  height: number;
  pulse: number;
  width: number;
}

/**
 * The native agent cursor: a small dot with a glow that springs to the point
 * the driver reported and pulses on each click. `pulse` is a monotonic counter
 * so repeated clicks on the same element still animate. Kept for surfaces that
 * are not a `WebView`; inside one, the overlay's in-page cursor is used.
 */
export function AgentCursor({
  cursor,
  height,
  pulse,
  width,
}: AgentCursorProps) {
  const [position] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const [scale] = useState(() => new Animated.Value(1));
  const [glow] = useState(() => new Animated.Value(0.4));
  const [bob] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));
  const ready = cursor !== null && width > 0 && height > 0;

  useEffect(() => {
    if (!cursor || width <= 0 || height <= 0) return;
    Animated.spring(position, {
      toValue: { x: cursor.x * width, y: cursor.y * height },
      damping: 18,
      stiffness: 220,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  }, [cursor, width, height, position]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: ready ? 1 : 0,
      duration: ready ? 140 : 220,
      useNativeDriver: true,
    }).start();
  }, [opacity, ready]);

  useEffect(() => {
    if (pulse === 0) return;
    scale.setValue(1);
    glow.setValue(0.4);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 0.78,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          damping: 12,
          stiffness: 220,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 0.9,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 260,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [glow, pulse, scale]);

  useEffect(() => {
    if (!cursor?.typing) {
      bob.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -2,
          duration: 320,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 320,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, cursor?.typing]);

  if (!cursor) return null;

  return (
    <View accessibilityElementsHidden pointerEvents="none" style={styles.fill}>
      <Animated.View
        style={[
          styles.cursor,
          {
            opacity,
            transform: [
              { translateX: position.x },
              { translateY: Animated.add(position.y, bob) },
              { scale },
            ],
          },
        ]}
      >
        <Animated.View style={[styles.cursorGlow, { opacity: glow }]} />
        <View style={styles.cursorDot} />
        {cursor.label ? (
          <View style={styles.cursorLabel}>
            <Text numberOfLines={1} style={styles.cursorLabelText}>
              {cursor.label}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const CURSOR = 22;
const GLOW = 46;

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  scrimLight: {
    backgroundColor: "rgba(6, 8, 12, 0.18)",
  },
  scrimDark: {
    backgroundColor: "rgba(6, 8, 12, 0.26)",
  },
  band: {
    bottom: -120,
    position: "absolute",
    top: -120,
    width: 240,
  },
  bandGreen: {
    backgroundColor: "rgba(110, 255, 157, 0.18)",
  },
  bandPink: {
    backgroundColor: "rgba(247, 92, 205, 0.14)",
  },
  tintPulse: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(110, 255, 157, 0.09)",
  },
  topLine: {
    backgroundColor: "rgba(110, 255, 157, 0.85)",
    height: 2,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  pillRow: {
    alignItems: "center",
    bottom: 14,
    left: 0,
    position: "absolute",
    right: 0,
  },
  pill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    maxWidth: "86%",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  pillDark: {
    backgroundColor: "rgba(8, 8, 10, 0.9)",
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  pillLight: {
    backgroundColor: "rgba(20, 22, 28, 0.92)",
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  pillDot: {
    backgroundColor: "#6eff9d",
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  pillText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: -0.1,
    maxWidth: 260,
  },
  cursor: {
    height: CURSOR,
    marginLeft: -CURSOR / 2,
    marginTop: -CURSOR / 2,
    position: "absolute",
    width: CURSOR,
  },
  cursorGlow: {
    backgroundColor: "#2f6bff",
    borderRadius: GLOW / 2,
    height: GLOW,
    left: (CURSOR - GLOW) / 2,
    position: "absolute",
    top: (CURSOR - GLOW) / 2,
    width: GLOW,
  },
  cursorDot: {
    backgroundColor: "#2f6bff",
    borderColor: "#ffffff",
    borderRadius: CURSOR / 2,
    borderWidth: 2,
    elevation: 4,
    height: CURSOR,
    shadowColor: "#000000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    width: CURSOR,
  },
  cursorLabel: {
    backgroundColor: "rgba(8, 8, 8, 0.88)",
    borderRadius: 6,
    left: CURSOR + 4,
    maxWidth: 180,
    paddingHorizontal: 7,
    paddingVertical: 4,
    position: "absolute",
    top: CURSOR / 2,
  },
  cursorLabelText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "600",
  },
});
