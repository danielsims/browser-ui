import type { ComponentProps, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type {
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import type {
  WebViewBrowserActivity,
  WebViewBrowserCursor,
  WebViewBrowserDriverOptions,
} from "./driver";
import type { InPageOverlayConfig } from "./overlay-script";
import type { OperatingShaderConfig } from "./shader";
import { WebViewBrowserDriver } from "./driver";
import {
  buildOverlayInstallScript,
  buildOverlayUpdateScript,
  resolveOperatingShader,
} from "./overlay-script";

type WebViewComponentProps = ComponentProps<typeof WebView>;
type LoadRequest = Parameters<
  NonNullable<WebViewComponentProps["onShouldStartLoadWithRequest"]>
>[0];
type WebViewError = Parameters<
  NonNullable<WebViewComponentProps["onError"]>
>[0];

export type WebViewBrowserStatus = "connecting" | "ready" | "error";

export interface WebViewBrowserHandle {
  driver: WebViewBrowserDriver;
  goBack(): void;
  goForward(): void;
  reload(): void;
}

export interface WebViewBrowserProps {
  children?: ReactNode;
  /** Host policy and timeouts for the driver rendered by this view. */
  driverOptions?: WebViewBrowserDriverOptions;
  onReady?: (driver: WebViewBrowserDriver) => void;
  onStatusChange?: (status: WebViewBrowserStatus, error: Error | null) => void;
  onTitleChange?: (title: string) => void;
  onUrlChange?: (url: string) => void;
  operating?: boolean;
  operatingLabel?: string;
  /**
   * Operating shader selection, mirroring the web package. Compiled and drawn
   * in-page on a WebGL canvas inside the WebView so it always paints above the
   * page; variant defaults are applied when a field is omitted.
   */
  operatingShader?: OperatingShaderConfig;
  /** Controlled agent cursor. Defaults to the point reported by the driver. */
  agentCursor?: WebViewBrowserCursor;
  /** Reports driver actions and `null` once the cursor has gone idle. */
  onActivityChange?: (activity: WebViewBrowserActivity | null) => void;
  style?: StyleProp<ViewStyle>;
  /**
   * Forwarded to the underlying `WebView`. Set `"none"` to defer touches while
   * the page is mounted but visually deferred behind a host placeholder.
   */
  pointerEvents?: WebViewComponentProps["pointerEvents"];
  /** URL loaded when the view mounts. Defaults to `about:blank`. */
  url?: string;
  /**
   * Override the WebView user agent. Opt-in because the default native agent is
   * correct for most sites; set a desktop agent only when the mobile DOM offers
   * a materially different control surface.
   */
  userAgent?: string;
}

interface Callbacks {
  onReady: WebViewBrowserProps["onReady"];
  onStatusChange: WebViewBrowserProps["onStatusChange"];
  onTitleChange: WebViewBrowserProps["onTitleChange"];
  onUrlChange: WebViewBrowserProps["onUrlChange"];
  onActivityChange: WebViewBrowserProps["onActivityChange"];
}

/** How long the cursor lingers after the agent's last action. */
const CURSOR_IDLE_MS = 4_000;

const WebViewBrowserContext = createContext<WebViewBrowserDriver | null>(null);

/** The driver for the nearest `<WebViewBrowser>` ancestor. */
export function useWebViewBrowser(): WebViewBrowserDriver {
  const driver = useContext(WebViewBrowserContext);
  if (!driver) {
    throw new Error(
      "useWebViewBrowser must be used inside a <WebViewBrowser>.",
    );
  }
  return driver;
}

/** A live `react-native-webview` that humans can touch and agents can drive. */
export const WebViewBrowser = forwardRef<
  WebViewBrowserHandle,
  WebViewBrowserProps
>(function WebViewBrowser(
  {
    agentCursor,
    children,
    driverOptions,
    onActivityChange,
    onReady,
    onStatusChange,
    onTitleChange,
    onUrlChange,
    operating = false,
    operatingLabel = "Agent is operating this browser",
    operatingShader,
    pointerEvents,
    style,
    url = "about:blank",
    userAgent,
  },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const [driver] = useState(() => new WebViewBrowserDriver());
  const readyRef = useRef(false);
  const [liveCursor, setLiveCursor] = useState<WebViewBrowserCursor | null>(
    null,
  );
  // Bumped after every page load so the in-page overlay is reinstalled on the
  // fresh document; updates then arrive through the effect below.
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef<Callbacks>({
    onReady,
    onStatusChange,
    onTitleChange,
    onUrlChange,
    onActivityChange,
  });
  useEffect(() => {
    callbacksRef.current = {
      onReady,
      onStatusChange,
      onTitleChange,
      onUrlChange,
      onActivityChange,
    };
  }, [onReady, onStatusChange, onTitleChange, onUrlChange, onActivityChange]);

  useEffect(() => {
    driver.configure(driverOptions ?? {});
  }, [driver, driverOptions]);

  useEffect(() => {
    driver.attach(webViewRef.current);
    return () => driver.detach();
  }, [driver]);

  useEffect(() => {
    const unsubscribe = driver.subscribeActivity((activity) => {
      setLiveCursor(activity.cursor);
      callbacksRef.current.onActivityChange?.(activity);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        setLiveCursor(null);
        callbacksRef.current.onActivityChange?.(null);
      }, CURSOR_IDLE_MS);
    });
    return () => {
      unsubscribe();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [driver]);

  // Depend on the shader's primitive fields, not the config object, so an
  // inline `operatingShader={{...}}` does not re-inject on every render.
  const shaderVariant = operatingShader?.variant;
  const shaderDirection = operatingShader?.direction;
  const shaderSpeed = operatingShader?.speed;
  const overlayConfig = useMemo<InPageOverlayConfig>(
    () => ({
      operating,
      label: operatingLabel,
      shader: resolveOperatingShader({
        variant: shaderVariant,
        direction: shaderDirection,
        speed: shaderSpeed,
      }),
      cursor: agentCursor ?? liveCursor,
    }),
    [
      operating,
      operatingLabel,
      shaderVariant,
      shaderDirection,
      shaderSpeed,
      agentCursor,
      liveCursor,
    ],
  );
  const overlayRef = useRef(overlayConfig);
  useEffect(() => {
    overlayRef.current = overlayConfig;
  }, [overlayConfig]);

  // Install the overlay immediately (the page guards against an absent
  // document) and re-assert it on every navigation. Never gate this on a load
  // event: a missed `onLoadEnd` must not mean a missing overlay.
  useEffect(() => {
    try {
      webViewRef.current?.injectJavaScript(
        buildOverlayInstallScript(overlayRef.current),
      );
    } catch (error) {
      console.warn("[browser-ui] overlay install failed", error);
    }
  }, [overlayEpoch]);

  useEffect(() => {
    try {
      webViewRef.current?.injectJavaScript(
        buildOverlayUpdateScript(overlayConfig),
      );
    } catch (error) {
      console.warn("[browser-ui] overlay update failed", error);
    }
  }, [overlayEpoch, overlayConfig]);

  useImperativeHandle(
    ref,
    () => ({
      driver,
      goBack: () => webViewRef.current?.goBack(),
      goForward: () => webViewRef.current?.goForward(),
      reload: () => webViewRef.current?.reload(),
    }),
    [driver],
  );

  const source = useMemo(() => ({ uri: url }), [url]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const data = event.nativeEvent.data;
      // The in-page overlay reports the one-off shader result here so it is
      // visible in device logs as well as the page console.
      if (data.includes('"browserUi":"shader"')) {
        try {
          const message = JSON.parse(data) as {
            detail?: string;
            ok?: boolean;
          };
          const line = `[browser-ui] shader ${message.ok ? "ok" : "err"} ${message.detail ?? ""}`;
          if (message.ok) console.log(line);
          else console.warn(line);
        } catch {
          // Malformed diagnostics are not worth crashing the bridge over.
        }
        return;
      }
      driver.receive(data);
    },
    [driver],
  );

  const onLoadStart = useCallback(() => {
    callbacksRef.current.onStatusChange?.("connecting", null);
  }, []);

  const onLoadEnd = useCallback(() => {
    driver.attach(webViewRef.current);
    callbacksRef.current.onStatusChange?.("ready", null);
    setOverlayEpoch((epoch) => epoch + 1);
    if (!readyRef.current) {
      readyRef.current = true;
      callbacksRef.current.onReady?.(driver);
    }
  }, [driver]);

  const onError = useCallback((event: WebViewError) => {
    callbacksRef.current.onStatusChange?.(
      "error",
      new Error(event.nativeEvent.description),
    );
  }, []);

  const onNavigationStateChange = useCallback(
    (navigation: WebViewNavigation) => {
      if (navigation.url) callbacksRef.current.onUrlChange?.(navigation.url);
      if (navigation.title)
        callbacksRef.current.onTitleChange?.(navigation.title);
    },
    [],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: LoadRequest) => driver.allowsNavigation(request.url),
    [driver],
  );

  return (
    <WebViewBrowserContext.Provider value={driver}>
      <View style={[styles.root, style]}>
        <WebView
          ref={webViewRef}
          allowsInlineMediaPlayback
          // Keep the site's session: cookies and storage must persist across
          // launches so a sign-in survives, and cross-site cookies are needed by
          // many checkout/cart flows.
          domStorageEnabled
          javaScriptEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onError={onError}
          onLoadEnd={onLoadEnd}
          onLoadStart={onLoadStart}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          originWhitelist={["*"]}
          pointerEvents={pointerEvents}
          setSupportMultipleWindows={false}
          source={source}
          style={styles.webview}
          userAgent={userAgent}
        />
        {children}
      </View>
    </WebViewBrowserContext.Provider>
  );
});

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#090b0f",
    overflow: "hidden",
    position: "relative",
  },
  webview: {
    ...StyleSheet.absoluteFillObject,
  },
});
