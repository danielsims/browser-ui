import {
  AgentBrowserView,
  BrowserSheet,
  type AgentBrowserConnectionStatus,
  type BrowserSessionAccess,
} from "@browser-ui/react-native";
import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

interface StreamConfiguration {
  displayHost: string;
  issue: string | null;
  url: string | null;
}

function streamConfiguration(rawUrl: string | undefined): StreamConfiguration {
  if (!rawUrl) {
    return {
      displayHost: "No gateway configured",
      issue:
        "Set EXPO_PUBLIC_BROWSER_STREAM_URL to an authenticated, reachable wss:// gateway.",
      url: null,
    };
  }
  try {
    const parsed = new URL(rawUrl);
    const loopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1";
    if (parsed.protocol !== "wss:") {
      return {
        displayHost: parsed.host,
        issue: "The native demo requires a TLS-protected wss:// stream URL.",
        url: null,
      };
    }
    if (loopback) {
      return {
        displayHost: parsed.host,
        issue:
          "Loopback points at this device, not your development machine. Use a routable gateway hostname.",
        url: null,
      };
    }
    return { displayHost: parsed.host, issue: null, url: parsed.toString() };
  } catch {
    return {
      displayHost: "Invalid gateway URL",
      issue: "EXPO_PUBLIC_BROWSER_STREAM_URL is not a valid URL.",
      url: null,
    };
  }
}

function displayPageUrl(value: string | null, fallback: string): string {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return fallback;
  }
}

function statusLabel(status: AgentBrowserConnectionStatus): string {
  if (status === "idle") return "Idle";
  if (status === "connecting") return "Connecting";
  if (status === "reconnecting") return "Reconnecting";
  if (status === "connected") return "Live";
  if (status === "paused") return "Paused";
  return "Unavailable";
}

const configuration = streamConfiguration(
  process.env.EXPO_PUBLIC_BROWSER_STREAM_URL,
);
const demoViewer = { id: "demo-user", displayName: "You", kind: "user" } as const;

export default function App() {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [inlineStatus, setInlineStatus] =
    useState<AgentBrowserConnectionStatus>("idle");
  const [sheetStatus, setSheetStatus] =
    useState<AgentBrowserConnectionStatus>("idle");
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const streamAvailable = configuration.url !== null;
  const access: BrowserSessionAccess = {
    owner: demoViewer,
    viewer: demoViewer,
    visibility: "owner-only",
    capabilities: ["observe", "control", "manage", "terminate"],
    controller: interactive ? demoViewer : undefined,
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#111820" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.masthead}>
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrowRule} />
            <Text style={styles.eyebrow}>BROWSER UI / NATIVE</Text>
          </View>
          <Text style={styles.heading}>A browser surface, not a second browser.</Text>
          <Text style={styles.intro}>
            Live JPEG frames from a reachable agent-browser gateway, with
            control kept deliberately separate.
          </Text>
        </View>

        {configuration.issue ? (
          <View style={styles.unavailableCard}>
            <Text style={styles.unavailableKicker}>STREAM UNAVAILABLE</Text>
            <Text style={styles.unavailableTitle}>{configuration.displayHost}</Text>
            <Text style={styles.unavailableText}>{configuration.issue}</Text>
            <View style={styles.codePill}>
              <Text selectable style={styles.codeText}>
                EXPO_PUBLIC_BROWSER_STREAM_URL
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionNumber}>01</Text>
            <Text style={styles.sectionTitle}>Inline surface</Text>
          </View>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.statusDot,
                inlineStatus === "connected"
                  ? styles.statusDotLive
                  : styles.statusDotWaiting,
              ]}
            />
            <Text style={styles.statusText}>{statusLabel(inlineStatus)}</Text>
          </View>
        </View>

        <View style={styles.browserFrame}>
          <View style={styles.browserTopBar}>
            <View style={styles.trafficLights}>
              <View style={[styles.trafficLight, styles.trafficRed]} />
              <View style={[styles.trafficLight, styles.trafficAmber]} />
              <View style={[styles.trafficLight, styles.trafficGreen]} />
            </View>
            <Text numberOfLines={1} style={styles.hostText}>
              {displayPageUrl(pageUrl, configuration.displayHost)}
            </Text>
          </View>
          <AgentBrowserView
            access={access}
            enabled={streamAvailable && !sheetVisible}
            interactive={interactive}
            onStatusChange={setInlineStatus}
            onUrlChange={setPageUrl}
            streamUrl={configuration.url}
            style={styles.inlineBrowser}
          />
        </View>

        <View style={styles.controlPanel}>
          <View style={styles.controlCopy}>
            <Text style={styles.controlTitle}>Input mode</Text>
            <Text style={styles.controlDescription}>
              Control must correspond to an exclusive server-side lease.
            </Text>
          </View>
          <View style={styles.segmentedControl}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInteractive(false)}
              style={[
                styles.segment,
                !interactive ? styles.segmentSelected : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  !interactive ? styles.segmentTextSelected : null,
                ]}
              >
                View
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!streamAvailable}
              onPress={() => setInteractive(true)}
              style={[
                styles.segment,
                interactive ? styles.segmentSelected : null,
                !streamAvailable ? styles.disabled : null,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  interactive ? styles.segmentTextSelected : null,
                ]}
              >
                Control
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.sheetCallout}>
          <View style={styles.sheetCopy}>
            <Text style={styles.sectionNumber}>02</Text>
            <Text style={styles.sectionTitle}>Native sheet</Text>
            <Text style={styles.sheetDescription}>
              Modal browser chrome, safe-area aware, draggable, and owned by the
              host app.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!streamAvailable}
            onPress={() => setSheetVisible(true)}
            style={({ pressed }) => [
              styles.openButton,
              pressed ? styles.openButtonPressed : null,
              !streamAvailable ? styles.openButtonDisabled : null,
            ]}
          >
            <Text style={styles.openButtonText}>Open sheet</Text>
            <Text style={styles.openButtonArrow}>/</Text>
          </Pressable>
        </View>

        <Text style={styles.footerNote}>
          Public Expo configuration is not a vault. Use a short-lived gateway
          ticket, never a durable bearer credential.
        </Text>
      </ScrollView>

      <BrowserSheet
        access={access}
        displayUrl={displayPageUrl(pageUrl, configuration.displayHost)}
        onRequestClose={() => setSheetVisible(false)}
        status={sheetStatus}
        title="Agent browser"
        visible={sheetVisible}
      >
        <AgentBrowserView
          access={access}
          interactive={interactive}
          onStatusChange={setSheetStatus}
          onUrlChange={setPageUrl}
          streamUrl={configuration.url}
          style={styles.sheetBrowser}
        />
      </BrowserSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#111820",
    flex: 1,
  },
  scrollContent: {
    gap: 24,
    paddingBottom: 44,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  masthead: {
    gap: 12,
    paddingHorizontal: 4,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  eyebrowRule: {
    backgroundColor: "#f39a72",
    height: 2,
    width: 26,
  },
  eyebrow: {
    color: "#f39a72",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  heading: {
    color: "#f5f1e8",
    fontFamily: "serif",
    fontSize: 36,
    fontWeight: "600",
    letterSpacing: -1.1,
    lineHeight: 40,
    maxWidth: 520,
  },
  intro: {
    color: "#9ca8b2",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 580,
  },
  unavailableCard: {
    backgroundColor: "#2a1c1a",
    borderColor: "#6f3b31",
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 18,
  },
  unavailableKicker: {
    color: "#f39a72",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  unavailableTitle: {
    color: "#fff4ec",
    fontSize: 18,
    fontWeight: "700",
  },
  unavailableText: {
    color: "#d3aaa0",
    fontSize: 13,
    lineHeight: 19,
  },
  codePill: {
    alignSelf: "flex-start",
    backgroundColor: "#160f0e",
    borderRadius: 4,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  codeText: {
    color: "#e4c2b8",
    fontFamily: "monospace",
    fontSize: 10,
  },
  sectionHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  sectionNumber: {
    color: "#687683",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
  sectionTitle: {
    color: "#eef2f3",
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginTop: 3,
  },
  statusBadge: {
    alignItems: "center",
    backgroundColor: "#19232d",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusDotLive: {
    backgroundColor: "#56d49d",
  },
  statusDotWaiting: {
    backgroundColor: "#dba65e",
  },
  statusText: {
    color: "#b7c0c7",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  browserFrame: {
    backgroundColor: "#080b0e",
    borderColor: "#36424d",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  browserTopBar: {
    alignItems: "center",
    backgroundColor: "#1a232c",
    borderBottomColor: "#303b45",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    height: 38,
    paddingHorizontal: 12,
  },
  trafficLights: {
    flexDirection: "row",
    gap: 5,
  },
  trafficLight: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  trafficRed: {
    backgroundColor: "#e36f66",
  },
  trafficAmber: {
    backgroundColor: "#d9a85d",
  },
  trafficGreen: {
    backgroundColor: "#5ab68b",
  },
  hostText: {
    color: "#82909c",
    flex: 1,
    fontFamily: "monospace",
    fontSize: 10,
    textAlign: "center",
  },
  inlineBrowser: {
    aspectRatio: 16 / 10,
    width: "100%",
  },
  controlPanel: {
    alignItems: "center",
    backgroundColor: "#18212a",
    borderLeftColor: "#f39a72",
    borderLeftWidth: 3,
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    padding: 14,
  },
  controlCopy: {
    flex: 1,
    gap: 3,
  },
  controlTitle: {
    color: "#f1f3f2",
    fontSize: 13,
    fontWeight: "700",
  },
  controlDescription: {
    color: "#8b98a3",
    fontSize: 11,
    lineHeight: 16,
  },
  segmentedControl: {
    backgroundColor: "#0e141a",
    borderRadius: 8,
    flexDirection: "row",
    padding: 3,
  },
  segment: {
    borderRadius: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  segmentSelected: {
    backgroundColor: "#f1ede3",
  },
  segmentText: {
    color: "#788692",
    fontSize: 11,
    fontWeight: "700",
  },
  segmentTextSelected: {
    color: "#16202a",
  },
  disabled: {
    opacity: 0.4,
  },
  sheetCallout: {
    alignItems: "flex-end",
    backgroundColor: "#d9e0db",
    borderRadius: 4,
    flexDirection: "row",
    gap: 18,
    justifyContent: "space-between",
    padding: 18,
  },
  sheetCopy: {
    flex: 1,
  },
  sheetDescription: {
    color: "#536168",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
  },
  openButton: {
    alignItems: "center",
    backgroundColor: "#15212a",
    borderRadius: 999,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  openButtonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.97 }],
  },
  openButtonDisabled: {
    opacity: 0.35,
  },
  openButtonText: {
    color: "#f8f4ea",
    fontSize: 12,
    fontWeight: "800",
  },
  openButtonArrow: {
    color: "#f39a72",
    fontSize: 16,
    fontWeight: "300",
    transform: [{ rotate: "-45deg" }],
  },
  footerNote: {
    color: "#6f7e89",
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  sheetBrowser: {
    flex: 1,
  },
});
