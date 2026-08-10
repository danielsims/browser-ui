import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { BrowserSessionAccess } from "@browser-ui/core";

import type { AgentBrowserConnectionStatus } from "./use-agent-browser-stream";

export interface BrowserSheetProps {
  access?: BrowserSessionAccess;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  dismissOnBackdropPress?: boolean;
  displayUrl?: string;
  heightRatio?: number;
  onRequestClose: () => void;
  status?: AgentBrowserConnectionStatus;
  title?: string;
  visible: boolean;
}

const closedBackdropOpacity = 0;
const openBackdropOpacity = 1;

function statusDotStyle(status: AgentBrowserConnectionStatus | undefined) {
  if (status === "connected") return styles.statusConnected;
  if (status === "error") return styles.statusError;
  return styles.statusPending;
}

/** A host-controlled, dependency-free native browser bottom sheet. */
export function BrowserSheet({
  access,
  children,
  contentStyle,
  dismissOnBackdropPress = true,
  displayUrl = "Secure browser session",
  heightRatio = 0.88,
  onRequestClose,
  status,
  title = "Browser",
  visible,
}: BrowserSheetProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const sheetHeight = Math.min(
    760,
    Math.max(320, windowHeight * Math.min(0.96, Math.max(0.5, heightRatio))),
  );
  const sheetWidth = Math.min(760, windowWidth);
  const [mounted, setMounted] = useState(visible);
  const [translateY] = useState(() => new Animated.Value(sheetHeight));
  const [backdropOpacity] = useState(
    () => new Animated.Value(closedBackdropOpacity),
  );
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const closingRef = useRef(false);
  const sheetHeightRef = useRef(sheetHeight);
  const visibleRef = useRef(visible);
  const onRequestCloseRef = useRef(onRequestClose);
  useEffect(() => {
    visibleRef.current = visible;
    sheetHeightRef.current = sheetHeight;
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose, sheetHeight, visible]);

  const stopAnimation = () => {
    animationRef.current?.stop();
    animationRef.current = null;
  };

  const animateOpen = () => {
    stopAnimation();
    closingRef.current = false;
    animationRef.current = Animated.parallel([
      Animated.timing(translateY, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        duration: 220,
        easing: Easing.out(Easing.quad),
        toValue: openBackdropOpacity,
        useNativeDriver: true,
      }),
    ]);
    animationRef.current.start(() => {
      animationRef.current = null;
    });
  };

  const animateClosed = (onComplete?: () => void) => {
    stopAnimation();
    animationRef.current = Animated.parallel([
      Animated.timing(translateY, {
        duration: 240,
        easing: Easing.in(Easing.cubic),
        toValue: sheetHeight,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        duration: 180,
        easing: Easing.in(Easing.quad),
        toValue: closedBackdropOpacity,
        useNativeDriver: true,
      }),
    ]);
    animationRef.current.start(({ finished }) => {
      animationRef.current = null;
      if (finished) onComplete?.();
    });
  };

  const dismiss = () => {
    if (closingRef.current || !visibleRef.current) return;
    closingRef.current = true;
    animateClosed(() => {
      onRequestCloseRef.current();
      requestAnimationFrame(() => {
        if (visibleRef.current) {
          closingRef.current = false;
          animateOpen();
        }
      });
    });
  };
  const responderCallbacksRef = useRef({ animateOpen, dismiss, stopAnimation });
  useEffect(() => {
    responderCallbacksRef.current = { animateOpen, dismiss, stopAnimation };
  });
  const [panResponder, setPanResponder] = useState<ReturnType<
    typeof PanResponder.create
  > | null>(null);
  useEffect(() => {
    const frameRequest = requestAnimationFrame(() => {
      setPanResponder(
        PanResponder.create({
          onMoveShouldSetPanResponder: (_, gesture) =>
            gesture.dy > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
          onPanResponderGrant: () =>
            responderCallbacksRef.current.stopAnimation(),
          onPanResponderMove: (_, gesture) => {
            const distance = Math.max(0, gesture.dy);
            translateY.setValue(distance);
            backdropOpacity.setValue(
              Math.max(0, 1 - distance / sheetHeightRef.current),
            );
          },
          onPanResponderRelease: (_, gesture) => {
            const shouldDismiss =
              gesture.dy > sheetHeightRef.current * 0.2 || gesture.vy > 1.1;
            if (shouldDismiss) {
              responderCallbacksRef.current.dismiss();
              return;
            }
            responderCallbacksRef.current.animateOpen();
          },
          onPanResponderTerminate: () =>
            responderCallbacksRef.current.animateOpen(),
        }),
      );
    });
    return () => cancelAnimationFrame(frameRequest);
  }, [backdropOpacity, translateY]);

  useEffect(() => {
    let frameRequest: number | null = null;
    if (visible) {
      frameRequest = requestAnimationFrame(() => {
        setMounted(true);
        translateY.setValue(sheetHeight);
        backdropOpacity.setValue(closedBackdropOpacity);
        animateOpen();
      });
    } else if (mounted) {
      if (closingRef.current) {
        closingRef.current = false;
        frameRequest = requestAnimationFrame(() => setMounted(false));
      } else {
        animateClosed(() => {
          if (!visibleRef.current) setMounted(false);
        });
      }
    }
    return () => {
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    };
  }, [visible]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      animationRef.current = null;
    },
    [],
  );

  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      onRequestClose={dismiss}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View accessibilityViewIsModal style={styles.modal}>
        <Animated.View
          pointerEvents={dismissOnBackdropPress ? "auto" : "none"}
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            accessibilityLabel="Close browser"
            accessibilityRole="button"
            onPress={dismiss}
            style={styles.backdropPressable}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              transform: [{ translateY }],
              width: sheetWidth,
            },
          ]}
        >
          <SafeAreaView style={styles.safeArea}>
            <View {...(panResponder?.panHandlers ?? {})} style={styles.chrome}>
              <View style={styles.handle} />
              <View style={styles.toolbar}>
                <View style={styles.titleBlock}>
                  <Text numberOfLines={1} style={styles.title}>
                    {title}
                  </Text>
                  <View style={styles.addressRow}>
                    <View style={[styles.statusDot, statusDotStyle(status)]} />
                    <Text style={styles.secureLabel}>WSS</Text>
                    <Text numberOfLines={1} style={styles.address}>
                      {displayUrl}
                    </Text>
                  </View>
                  {access?.controller ? (
                    <Text numberOfLines={1} style={styles.controlLabel}>
                      {access.controller.id === access.viewer.id
                        ? "You have control"
                        : `${access.controller.displayName} has control`}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  accessibilityLabel="Close browser"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={dismiss}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed ? styles.closeButtonPressed : null,
                  ]}
                >
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>
            </View>
            <View style={[styles.content, contentStyle]}>
              {mounted ? children : null}
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 8, 13, 0.54)",
  },
  backdropPressable: {
    flex: 1,
  },
  sheet: {
    alignSelf: "center",
    backgroundColor: "#11151c",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 760,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { height: -8, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
  },
  safeArea: {
    flex: 1,
  },
  chrome: {
    backgroundColor: "#151a22",
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "#515967",
    borderRadius: 2,
    height: 4,
    marginBottom: 10,
    marginTop: 8,
    width: 38,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: "#f5f7fa",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  addressRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  statusDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusConnected: {
    backgroundColor: "#54d69b",
  },
  statusError: {
    backgroundColor: "#ff6b6b",
  },
  statusPending: {
    backgroundColor: "#f3b95f",
  },
  secureLabel: {
    color: "#6fcb9f",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  address: {
    color: "#8993a3",
    flex: 1,
    fontSize: 11,
  },
  controlLabel: {
    color: "#8993a3",
    fontSize: 10,
  },
  closeButton: {
    backgroundColor: "#252c37",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  closeButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
  closeText: {
    color: "#f2f4f7",
    fontSize: 12,
    fontWeight: "700",
  },
  content: {
    backgroundColor: "#090b0f",
    flex: 1,
  },
});
