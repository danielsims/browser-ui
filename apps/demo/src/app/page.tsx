"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Browser,
  BrowserDisplayControls,
  BrowserFullscreenTrigger,
  BrowserOperatingOverlay,
  BrowserPictureInPictureTrigger,
  BrowserRoot,
  BrowserSurface,
  type BrowserAgentCursorState,
  type BrowserDisplayMode,
  type BrowserViewportStatus,
} from "@browser-ui/react";
import { FaGithub } from "react-icons/fa";
import { workflows, type WorkflowId } from "../workflows";

const desktopViewport = { width: 1440, height: 900 } as const;
const enterPictureInPictureAt = .24;
const returnInlineAt = .52;
const workflowTransitionDelayMs = 2_400;
const recordedPlaybackRate = 2.25;

const usageCode = `import { Browser } from "@browser-ui/react";

type AgentBrowserProps = {
  streamUrl: string;
  operating: boolean;
  action?: string;
  onTakeControl: () => void;
};

export function AgentBrowser({
  streamUrl,
  operating,
  action,
  onTakeControl,
}: AgentBrowserProps) {
  return (
    <Browser
      streamUrl={streamUrl}
      viewportSize={{ width: 1440, height: 900 }}
      operating={operating}
      operatingLabel={action}
      showPictureInPicture
      showFullscreen
      onTakeControl={onTakeControl}
    />
  );
}`;

const propGroups = [
  {
    title: "Stream",
    props: [
      ["streamUrl", "string · required", "WebSocket endpoint returned by agent-browser. Frames and user input travel over this connection."],
      ["viewportSize", "{ width, height }", "Remote browser resolution, independent from the rendered component. Keep it fixed to preserve desktop breakpoints in PiP."],
      ["displayAspectRatio", "CSS aspect-ratio", "Shape of the rendered component only. It never changes the remote viewport."],
      ["colorScheme", '"light" | "dark" | "system"', "Controls Browser UI chrome independently from the streamed page. System follows the host device preference."],
      ["onUrlChange", "(url) => void", "Reports navigation messages emitted by the remote browser."],
      ["onViewportResize", "(width, height) => void", "Reports the requested remote viewport dimensions to the session owner."],
      ["onStatusChange", "(status) => void", "Reports connecting, connected, disconnected and error states."],
    ],
  },
  {
    title: "Agent activity",
    props: [
      ["operating", "boolean · false", "Shows the activity shader and pauses direct viewport input while the agent owns the session."],
      ["operatingLabel", "string", "Current action displayed in the compact status control."],
      ["agentCursor", "BrowserAgentCursorState", "Normalized cursor position and pressed or typing state for visualizing live or recorded agent actions."],
      ["onTakeControl", "() => void", "Called when the person stops the workflow and takes ownership of browser input."],
      ["loadingLabel", "string", "Copy shown while the WebSocket is connecting or reconnecting."],
    ],
  },
  {
    title: "Display",
    props: [
      ["variant", '"framed" | "bare"', "Use the standalone glass frame or an unstyled edge-to-edge surface."],
      ["showControls", "boolean · false", "Adds the optional address and reload controls."],
      ["showPictureInPicture", "boolean · false", "Adds the floating picture-in-picture control."],
      ["showFullscreen", "boolean · false", "Adds application fullscreen without changing the remote viewport size."],
      ["mode", '"inline" | "picture-in-picture" | "fullscreen"', "Controls the display mode from your application."],
      ["defaultMode", 'display mode · "inline"', "Initial display mode when Browser manages its own state."],
      ["onModeChange", "(mode) => void", "Reports transitions between inline, PiP and fullscreen."],
    ],
  },
  {
    title: "Navigation",
    props: [
      ["url", "string", "Current URL shown by the optional controls."],
      ["onNavigate", "(url) => void", "Receives address submissions so the session owner can navigate agent-browser."],
      ["onReload", "() => void", "Receives reload requests from the optional browser controls."],
      ["ariaLabel", "string", "Accessible name for the interactive remote viewport."],
      ["viewportClassName", "string", "Class name applied directly to AgentBrowserViewport."],
    ],
  },
] as const;

interface WorkflowMessage {
  type: "ready" | "start" | "step" | "cursor" | "cursor-state" | "complete" | "cancel" | "error";
  workflowId?: WorkflowId;
  label?: string;
  outcome?: string;
  message?: string;
  pressed?: boolean;
  typing?: boolean;
  cursor?: BrowserAgentCursorState;
}

function highlightLine(line: string): ReactNode[] {
  const expression = /(\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|function|return|true|false|const)\b|<\/?[A-Z][\w.]*|\b[A-Za-z][\w]*(?==))/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push(line.slice(cursor, index));
    const token = match[0];
    const kind = token.startsWith("//") ? "comment"
      : token.startsWith('"') || token.startsWith("'") || token.startsWith("`") ? "string"
      : token.startsWith("<") ? "tag"
      : ["import", "from", "export", "function", "return", "true", "false", "const"].includes(token) ? "keyword"
      : "property";
    result.push(<span className={`syntax-${kind}`} key={`${index}-${token}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < line.length) result.push(line.slice(cursor));
  return result;
}

function CodeBlock({ code, filename }: { code: string; filename: string }) {
  return <div className="code-block">
    <header><span>{filename}</span><button type="button" onClick={() => navigator.clipboard?.writeText(code)}>Copy</button></header>
    <pre><code>{code.split("\n").map((line, index) => <span className="code-line" key={index}>{highlightLine(line)}{"\n"}</span>)}</code></pre>
  </div>;
}

async function browserCommand(body: Record<string, unknown>) {
  const response = await fetch("/api/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Browser command failed");
}

function RecordedBrowserPreview({
  label,
  onEnded,
  onModeChange,
  playbackKey,
  src,
  mode,
}: {
  label: string;
  onEnded: () => void;
  onModeChange: (mode: BrowserDisplayMode) => void;
  playbackKey: number;
  src: string;
  mode: BrowserDisplayMode;
}) {
  return <BrowserRoot mode={mode} onModeChange={onModeChange}>
    <BrowserSurface
      className="recorded-browser-surface"
      overlay={<BrowserOperatingOverlay label={label} />}
      style={{ aspectRatio: "16 / 10" }}
    >
      <video
        aria-label="Recorded browser workflow preview"
        autoPlay
        className="recorded-browser-preview"
        key={`${src}-${playbackKey}`}
        muted
        onLoadedMetadata={(event) => {
          event.currentTarget.defaultPlaybackRate = recordedPlaybackRate;
          event.currentTarget.playbackRate = recordedPlaybackRate;
        }}
        onEnded={onEnded}
        playsInline
        preload="auto"
        src={src}
      />
    </BrowserSurface>
    <BrowserDisplayControls>
      <BrowserPictureInPictureTrigger />
      <BrowserFullscreenTrigger />
    </BrowserDisplayControls>
  </BrowserRoot>;
}

export default function Home() {
  const streamUrl = process.env.NEXT_PUBLIC_BROWSER_STREAM_URL;
  const initialWorkflow = workflows[0];
  const initialUrl = process.env.NEXT_PUBLIC_BROWSER_INITIAL_URL ?? initialWorkflow.startUrl;
  const [workflowId, setWorkflowId] = useState<WorkflowId>(initialWorkflow.id);
  const [operating, setOperating] = useState(true);
  const [status, setStatus] = useState<BrowserViewportStatus>("connecting");
  const [liveUrl, setLiveUrl] = useState(initialUrl);
  const [actionLabel, setActionLabel] = useState<string>(initialWorkflow.steps[0].label);
  const [agentCursor, setAgentCursor] = useState<BrowserAgentCursorState>({ x: .5, y: .5, visible: false });
  const [displayMode, setDisplayMode] = useState<BrowserDisplayMode>("inline");
  const [previewPlaybackKey, setPreviewPlaybackKey] = useState(0);
  const displayModeRef = useRef<BrowserDisplayMode>("inline");
  const previewRef = useRef<HTMLDivElement>(null);
  const autoPictureInPicture = useRef(false);
  const suppressAutoPictureInPicture = useRef(false);
  const resizeTimer = useRef<number | null>(null);
  const workflowRun = useRef(0);
  const activeWorkflow = useRef<WorkflowId>(initialWorkflow.id);
  const startedInitialWorkflow = useRef(false);
  const autoAdvanceTimer = useRef<number | null>(null);
  const workflow = workflows.find((item) => item.id === workflowId) ?? initialWorkflow;

  const resize = useCallback((width: number, height: number) => {
    if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(() => void browserCommand({ action: "resize", width, height }), 180);
  }, []);

  const runWorkflow = useCallback(async (nextWorkflow: (typeof workflows)[number]) => {
    if (autoAdvanceTimer.current !== null) {
      window.clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
    const run = ++workflowRun.current;
    activeWorkflow.current = nextWorkflow.id;
    setWorkflowId(nextWorkflow.id);
    setOperating(true);
    setActionLabel(nextWorkflow.steps[0].label);
    setLiveUrl(nextWorkflow.startUrl);
    setAgentCursor({ x: .5, y: .5, visible: false });
    try { await browserCommand({ action: "run-workflow", workflowId: nextWorkflow.id }); }
    catch { /* The operating state and stream surface communicate interruption. */ }
    finally { if (workflowRun.current === run) setOperating(false); }
  }, []);

  const playRecordedWorkflow = useCallback((nextWorkflow: (typeof workflows)[number]) => {
    setWorkflowId(nextWorkflow.id);
    setOperating(false);
    setActionLabel(nextWorkflow.steps[0].label);
    setAgentCursor({ x: .5, y: .5, visible: false });
    setPreviewPlaybackKey((current) => current + 1);
  }, []);

  const cancelWorkflow = useCallback(() => {
    if (autoAdvanceTimer.current !== null) {
      window.clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
    workflowRun.current += 1;
    setOperating(false);
    setAgentCursor((current) => ({ ...current, visible: false, pressed: false, typing: false }));
    void browserCommand({ action: "cancel-workflow" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!streamUrl) return;
    const events = new EventSource("/api/browser");
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as WorkflowMessage;
      if (event.workflowId && event.workflowId !== activeWorkflow.current) return;
      if (event.type === "start") setOperating(true);
      else if (event.type === "step" && event.label) setActionLabel(event.label);
      else if (event.type === "cursor" && event.cursor) setAgentCursor(event.cursor);
      else if (event.type === "cursor-state") setAgentCursor((current) => ({ ...current, pressed: event.pressed, typing: event.typing }));
      else if (event.type === "complete") {
        setOperating(false);
        const completedWorkflowId = event.workflowId ?? activeWorkflow.current;
        const completedIndex = workflows.findIndex((item) => item.id === completedWorkflowId);
        const nextIndex = completedIndex < 0 ? 0 : (completedIndex + 1) % workflows.length;
        const nextWorkflow = workflows[nextIndex];
        autoAdvanceTimer.current = window.setTimeout(() => {
          autoAdvanceTimer.current = null;
          void runWorkflow(nextWorkflow);
        }, workflowTransitionDelayMs);
      } else if (event.type === "cancel") {
        setOperating(false);
        setAgentCursor((current) => ({ ...current, visible: false }));
      } else if (event.type === "error") {
        setOperating(false);
      }
    };
    return () => {
      events.close();
      if (autoAdvanceTimer.current !== null) {
        window.clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
    };
  }, [runWorkflow, streamUrl]);

  useEffect(() => {
    if (status !== "connected" || startedInitialWorkflow.current) return;
    startedInitialWorkflow.current = true;
    void runWorkflow(initialWorkflow);
  }, [runWorkflow, status, initialWorkflow]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const observer = new IntersectionObserver(([entry]) => {
      const hasScrolledPastPreview = entry.boundingClientRect.top < 0;
      const shouldFloat = hasScrolledPastPreview && entry.intersectionRatio <= enterPictureInPictureAt;
      const shouldReturn = entry.intersectionRatio >= returnInlineAt;

      if (shouldReturn) {
        suppressAutoPictureInPicture.current = false;
        if (!autoPictureInPicture.current || displayModeRef.current !== "picture-in-picture") return;
        autoPictureInPicture.current = false;
        displayModeRef.current = "inline";
        setDisplayMode("inline");
        return;
      }

      if (shouldFloat && !suppressAutoPictureInPicture.current && displayModeRef.current === "inline") {
        autoPictureInPicture.current = true;
        displayModeRef.current = "picture-in-picture";
        setDisplayMode("picture-in-picture");
      }
    }, { threshold: [0, enterPictureInPictureAt, returnInlineAt, 1] });
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  const changeDisplayMode = useCallback((nextMode: BrowserDisplayMode) => {
    autoPictureInPicture.current = false;
    const preview = previewRef.current;
    if (nextMode === "inline" && preview) {
      const bounds = preview.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0));
      suppressAutoPictureInPicture.current = visibleHeight / Math.max(bounds.height, 1) < returnInlineAt;
    } else {
      suppressAutoPictureInPicture.current = true;
    }
    displayModeRef.current = nextMode;
    setDisplayMode(nextMode);
  }, []);

  const selectWorkflow = useCallback((nextWorkflow: (typeof workflows)[number]) => {
    if (streamUrl) void runWorkflow(nextWorkflow);
    else playRecordedWorkflow(nextWorkflow);
  }, [playRecordedWorkflow, runWorkflow, streamUrl]);

  const advanceRecordedPreview = useCallback(() => {
    const completedIndex = workflows.findIndex((item) => item.id === workflowId);
    const nextWorkflow = workflows[(completedIndex + 1) % workflows.length];
    playRecordedWorkflow(nextWorkflow);
  }, [playRecordedWorkflow, workflowId]);

  return <main>
    <section className="intro">
      <h1>Browser</h1>
      <p>A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.</p>
      <div className="command"><code>pnpm add @browser-ui/react</code><button type="button" onClick={() => navigator.clipboard?.writeText("pnpm add @browser-ui/react")}>Copy</button></div>
    </section>

    <section className="demo">
      <div className="demo-preview" ref={previewRef}>
        {streamUrl ? <Browser
          streamUrl={streamUrl}
          viewportSize={desktopViewport}
          url={liveUrl}
          operating={operating}
          operatingLabel={actionLabel}
          agentCursor={agentCursor}
          mode={displayMode}
          showPictureInPicture
          showFullscreen
          onModeChange={changeDisplayMode}
          onTakeControl={cancelWorkflow}
          onReload={() => void browserCommand({ action: "reload" })}
          onNavigate={(next) => void browserCommand({ action: "navigate", url: next })}
          onUrlChange={setLiveUrl}
          onViewportResize={resize}
          onStatusChange={setStatus}
        /> : <RecordedBrowserPreview
          key={workflow.id}
          label={actionLabel}
          mode={displayMode}
          onEnded={advanceRecordedPreview}
          onModeChange={changeDisplayMode}
          playbackKey={previewPlaybackKey}
          src={workflow.previewSrc}
        />}
      </div>

      <div className="workflow-panel">
        <div className="workflow-heading">
          <h2>Demo</h2>
        </div>
        <div className="workflow-controls">
          <div className="workflow-tabs" role="tablist" aria-label="Browser demos">
            {workflows.map((item) => {
              const active = workflowId === item.id;
              return <button
                type="button"
                role="tab"
                aria-selected={active}
                key={item.id}
                onClick={() => selectWorkflow(item)}
              >
                {active ? <motion.span
                  className="workflow-tab-indicator"
                  layoutId="browser-demo-state"
                  transition={{ type: "spring", bounce: .2, duration: .6 }}
                /> : null}
                <span className="workflow-tab-label">{item.title}</span>
              </button>;
            })}
          </div>
          <div className="demo-credit"><span>Built by <a href="https://x.com/danielsims">danielsims</a></span><a href="https://github.com/danielsims/browser-ui" aria-label="Browser UI on GitHub"><FaGithub size={19} /></a></div>
        </div>
        <div className="workflow-detail">
          <p>{workflow.description}</p>
          <button className="replay" type="button" disabled={Boolean(streamUrl && operating)} onClick={() => selectWorkflow(workflow)}>Replay</button>
        </div>
      </div>
    </section>

    <section className="docs-section">
      <header className="section-heading"><h2>Usage</h2><p>Pass the stream URL from your agent-browser session and the small amount of state your application already owns.</p></header>
      <CodeBlock filename="agent-session.tsx" code={usageCode} />
    </section>

    <hr className="docs-divider" />
    <section className="docs-section props">
      <header className="section-heading"><h2>Props</h2><p>The composed API stays controlled where product behavior matters and provides sensible defaults for presentation.</p></header>
      {propGroups.map((group) => <div className="prop-group" key={group.title}>
        <h3>{group.title}</h3>
        <div>{group.props.map(([name, type, description]) => <article key={name}><header><strong>{name}</strong><span>{type}</span></header><p>{description}</p></article>)}</div>
      </div>)}
    </section>
  </main>;
}
