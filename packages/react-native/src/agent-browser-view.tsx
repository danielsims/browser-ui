import {
  mapContainedPointToViewport,
  canSendBrowserInput,
  type BrowserAgentCursorState,
  type BrowserSessionAccess,
  type BrowserViewportSize,
} from "@browser-ui/core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ImageErrorEventData,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import {
  useAgentBrowserStream,
  type AgentBrowserConnectionStatus,
  type AgentBrowserReconnectOptions,
} from "./use-agent-browser-stream";

type PointerDownHandler = NonNullable<ViewProps["onPointerDown"]>;
type PointerMoveHandler = NonNullable<ViewProps["onPointerMove"]>;
type PointerUpHandler = NonNullable<ViewProps["onPointerUp"]>;

export interface AgentBrowserViewProps
  extends Omit<
    ViewProps,
    | "children"
    | "onLayout"
    | "onPointerCancel"
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "onResponderGrant"
    | "onResponderMove"
    | "onResponderRelease"
    | "onResponderTerminate"
    | "onStartShouldSetResponder"
  > {
  agentCursor?: BrowserAgentCursorState;
  /** Host-projected access state. The gateway must enforce the same lease. */
  access?: BrowserSessionAccess;
  enabled?: boolean;
  interactive?: boolean;
  onError?: (error: Error) => void;
  onFrameError?: (event: NativeSyntheticEvent<ImageErrorEventData>) => void;
  onStatusChange?: (
    status: AgentBrowserConnectionStatus,
    error: Error | null,
  ) => void;
  onUrlChange?: (url: string) => void;
  overlay?: ReactNode;
  placeholder?: ReactNode;
  protocols?: string | string[];
  reconnect?: AgentBrowserReconnectOptions;
  streamUrl?: string | null;
  style?: StyleProp<ViewStyle>;
  unavailableLabel?: string;
}

interface TouchGesture {
  lastPoint: BrowserPoint;
  moved: boolean;
  startLocationX: number;
  startLocationY: number;
}

interface ActivePointer {
  button: "left" | "middle" | "right";
  clickCount: number;
  modifiers: number;
  point: BrowserPoint;
}

interface BrowserPoint {
  x: number;
  y: number;
}

interface WheelInput extends BrowserPoint {
  deltaX: number;
  deltaY: number;
  modifiers: number;
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event !== null && typeof event === "object"
    ? (event as Record<string, unknown>)
    : {};
}

function eventPoint(event: { nativeEvent: unknown }): BrowserPoint | null {
  const nativeEvent = eventRecord(event.nativeEvent);
  const x =
    typeof nativeEvent.locationX === "number"
      ? nativeEvent.locationX
      : nativeEvent.offsetX;
  const y =
    typeof nativeEvent.locationY === "number"
      ? nativeEvent.locationY
      : nativeEvent.offsetY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function pointerType(event: { nativeEvent: unknown }): string | null {
  const value = eventRecord(event.nativeEvent).pointerType;
  return typeof value === "string" ? value : null;
}

function eventModifiers(event: { nativeEvent: unknown }): number {
  const nativeEvent = eventRecord(event.nativeEvent);
  return (
    (nativeEvent.altKey ? 1 : 0) |
    (nativeEvent.ctrlKey ? 2 : 0) |
    (nativeEvent.metaKey ? 4 : 0) |
    (nativeEvent.shiftKey ? 8 : 0)
  );
}

function mouseButton(event: { nativeEvent: unknown }): ActivePointer["button"] {
  const button = eventRecord(event.nativeEvent).button;
  return button === 1 ? "middle" : button === 2 ? "right" : "left";
}

function cursorPosition(
  cursor: BrowserAgentCursorState | undefined,
  container: BrowserViewportSize,
  viewport: BrowserViewportSize | null,
): BrowserPoint | null {
  if (!cursor || !viewport) return null;
  const record = cursor as unknown as Record<string, unknown>;
  if (record.visible === false || typeof record.x !== "number" || typeof record.y !== "number") {
    return null;
  }
  const scale = Math.min(
    container.width / viewport.width,
    container.height / viewport.height,
  );
  const renderedWidth = viewport.width * scale;
  const renderedHeight = viewport.height * scale;
  const x = Math.max(0, Math.min(1, record.x));
  const y = Math.max(0, Math.min(1, record.y));
  return {
    x: (container.width - renderedWidth) / 2 + x * renderedWidth,
    y: (container.height - renderedHeight) / 2 + y * renderedHeight,
  };
}

/** A contained JPEG stream surface. Input is disabled unless explicitly enabled. */
export function AgentBrowserView({
  accessibilityLabel = "Remote browser",
  access,
  agentCursor,
  enabled = true,
  interactive = false,
  onError,
  onFrameError,
  onStatusChange,
  onUrlChange,
  overlay,
  placeholder,
  protocols,
  reconnect,
  streamUrl,
  style,
  unavailableLabel = "Browser stream unavailable",
  ...viewProps
}: AgentBrowserViewProps) {
  const inputEnabled = interactive && (!access || canSendBrowserInput(access));
  const [containerSize, setContainerSize] =
    useState<BrowserViewportSize | null>(null);
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const pendingWheelRef = useRef<WheelInput | null>(null);
  const wheelRequestRef = useRef<number | null>(null);
  const stream = useAgentBrowserStream({
    enabled,
    onError,
    onStatusChange,
    onUrlChange,
    protocols,
    reconnect,
    streamUrl,
  });

  const mapPoint = useCallback(
    (point: BrowserPoint) => {
      if (!containerSize || !stream.viewportSize) return null;
      return mapContainedPointToViewport(
        point,
        containerSize,
        stream.viewportSize,
      );
    },
    [containerSize, stream.viewportSize],
  );

  const queueWheel = useCallback(
    (next: WheelInput) => {
      const pending = pendingWheelRef.current;
      pendingWheelRef.current = {
        ...next,
        deltaX: (pending?.deltaX ?? 0) + next.deltaX,
        deltaY: (pending?.deltaY ?? 0) + next.deltaY,
      };
      if (wheelRequestRef.current !== null) return;
      wheelRequestRef.current = requestAnimationFrame(() => {
        wheelRequestRef.current = null;
        const wheel = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (wheel) {
          stream.send({
            type: "input_mouse",
            eventType: "mouseWheel",
            ...wheel,
          });
        }
      });
    },
    [stream.send],
  );

  const releasePointer = useCallback(() => {
    const active = activePointerRef.current;
    activePointerRef.current = null;
    if (!active) return;
    stream.send({
      type: "input_mouse",
      eventType: "mouseReleased",
      ...active.point,
      button: active.button,
      clickCount: active.clickCount,
      modifiers: active.modifiers,
    });
  }, [stream.send]);

  useEffect(() => {
    if (inputEnabled) return;
    touchGestureRef.current = null;
    releasePointer();
  }, [inputEnabled, releasePointer]);

  useEffect(
    () => () => {
      if (wheelRequestRef.current !== null) {
        cancelAnimationFrame(wheelRequestRef.current);
      }
      wheelRequestRef.current = null;
      pendingWheelRef.current = null;
      releasePointer();
    },
    [releasePointer],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setContainerSize({ width, height });
  };

  const onResponderGrant = (event: GestureResponderEvent) => {
    if (!inputEnabled) return;
    const location = eventPoint(event);
    if (!location) return;
    const point = mapPoint(location);
    if (!point) return;
    releasePointer();
    touchGestureRef.current = {
      lastPoint: point,
      moved: false,
      startLocationX: location.x,
      startLocationY: location.y,
    };
  };

  const onResponderMove = (event: GestureResponderEvent) => {
    const gesture = touchGestureRef.current;
    const location = eventPoint(event);
    if (!gesture || !location) return;
    const point = mapPoint(location);
    if (!point) return;
    if (
      !gesture.moved &&
      Math.hypot(
        location.x - gesture.startLocationX,
        location.y - gesture.startLocationY,
      ) >= 6
    ) {
      gesture.moved = true;
    }
    if (gesture.moved) {
      queueWheel({
        deltaX: gesture.lastPoint.x - point.x,
        deltaY: gesture.lastPoint.y - point.y,
        modifiers: 0,
        ...point,
      });
    }
    gesture.lastPoint = point;
  };

  const finishTouch = (cancelled: boolean) => {
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!gesture || gesture.moved || cancelled) return;
    const input = {
      ...gesture.lastPoint,
      button: "left",
      clickCount: 1,
      modifiers: 0,
    };
    stream.send({ type: "input_mouse", eventType: "mouseMoved", ...input });
    stream.send({ type: "input_mouse", eventType: "mousePressed", ...input });
    stream.send({ type: "input_mouse", eventType: "mouseReleased", ...input });
  };

  const onPointerDown: PointerDownHandler = (event) => {
    if (!inputEnabled || pointerType(event) === "touch") return;
    const location = eventPoint(event);
    if (!location) return;
    const point = mapPoint(location);
    if (!point) return;
    releasePointer();
    const button = mouseButton(event);
    const input = {
      ...point,
      button,
      clickCount: 1,
      modifiers: eventModifiers(event),
    };
    stream.send({ type: "input_mouse", eventType: "mouseMoved", ...input });
    if (stream.send({ type: "input_mouse", eventType: "mousePressed", ...input })) {
      activePointerRef.current = {
        button,
        clickCount: 1,
        modifiers: input.modifiers,
        point,
      };
    }
  };

  const onPointerMove: PointerMoveHandler = (event) => {
    if (!inputEnabled || pointerType(event) === "touch") return;
    const location = eventPoint(event);
    if (!location) return;
    const point = mapPoint(location);
    if (!point) return;
    if (activePointerRef.current) activePointerRef.current.point = point;
    stream.send({
      type: "input_mouse",
      eventType: "mouseMoved",
      ...point,
      button: activePointerRef.current?.button ?? "none",
      clickCount: activePointerRef.current?.clickCount ?? 0,
      modifiers: eventModifiers(event),
    });
  };

  const onPointerUp: PointerUpHandler = (event) => {
    if (pointerType(event) === "touch") return;
    const location = eventPoint(event);
    const point = location ? mapPoint(location) : null;
    if (point && activePointerRef.current) {
      activePointerRef.current.point = point;
    }
    releasePointer();
  };

  const renderedCursor = containerSize
    ? cursorPosition(agentCursor, containerSize, stream.viewportSize)
    : null;
  const showDefaultPlaceholder = !stream.frame && placeholder === undefined;
  const isWaiting =
    stream.connectionStatus === "connecting" ||
    stream.connectionStatus === "reconnecting";

  return (
    <View
      {...viewProps}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      onLayout={onLayout}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onResponderGrant={onResponderGrant}
      onResponderMove={onResponderMove}
      onResponderRelease={() => finishTouch(false)}
      onResponderTerminate={() => finishTouch(true)}
      onStartShouldSetResponder={(event) => {
        const type = pointerType(event);
        return inputEnabled && (type === null || type === "touch");
      }}
      style={[styles.root, style]}
    >
      {stream.frame ? (
        <Image
          accessibilityIgnoresInvertColors
          fadeDuration={0}
          onError={onFrameError}
          resizeMode="contain"
          source={{ cache: "reload", uri: stream.frame.uri }}
          style={styles.image}
        />
      ) : null}
      {showDefaultPlaceholder ? (
        <View pointerEvents="none" style={styles.placeholder}>
          {isWaiting ? <ActivityIndicator color="#a7b0bf" /> : null}
          <Text style={styles.placeholderText}>
            {!streamUrl
              ? unavailableLabel
              : stream.connectionStatus === "paused"
                ? "Stream paused while the app is inactive"
                : stream.connectionStatus === "error"
                  ? "Could not reach browser stream"
                  : "Waiting for browser frame"}
          </Text>
        </View>
      ) : null}
      {!stream.frame && placeholder !== undefined ? placeholder : null}
      {renderedCursor ? (
        <View
          pointerEvents="none"
          style={[
            styles.agentCursor,
            {
              transform: [
                { translateX: renderedCursor.x - 7 },
                { translateY: renderedCursor.y - 7 },
                { scale: (agentCursor as { pressed?: boolean }).pressed ? 0.82 : 1 },
              ],
            },
          ]}
        />
      ) : null}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#090b0f",
    overflow: "hidden",
    position: "relative",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  placeholderText: {
    color: "#a7b0bf",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  agentCursor: {
    backgroundColor: "#2979ff",
    borderColor: "#ffffff",
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    left: 0,
    position: "absolute",
    top: 0,
    width: 14,
  },
});
