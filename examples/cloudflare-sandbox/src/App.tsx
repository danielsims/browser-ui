import {
  Browser,
  BrowserLoading,
  BrowserRoot,
  BrowserSurface,
  type BrowserAgentActivity,
} from "@browser-ui/react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface DemoSession {
  expiresAt?: string;
  gatewayOrigin: string;
  key: string;
  sessionId: string;
  title: string;
  viewport: { width: number; height: number };
}

const deployUrl =
  "https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fdanielsims%2Fbrowser-ui%2Ftree%2Fcloudflare-sandbox-preview%2Fexamples%2Fcloudflare-sandbox";
const deployFirstPreview =
  new URLSearchParams(window.location.search).get("preview") === "deploy-first";

const suggestions = [
  "Open the agent-browser GitHub repository",
  "Find the latest Cloudflare Sandbox announcement",
  "Open example.com and describe the page",
];

export default function App() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessRequired, setAccessRequired] = useState(false);
  const [deploymentRequired, setDeploymentRequired] = useState(false);
  const [starting, setStarting] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentActivity, setAgentActivity] =
    useState<BrowserAgentActivity | null>(null);
  const [control, setControl] = useState<"agent" | "human">("agent");
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState(
    "Start a sandbox, then ask the agent to browse.",
  );
  const [hasPrompted, setHasPrompted] = useState(false);
  const startedRef = useRef(false);
  const sessionRef = useRef<DemoSession | null>(null);
  const pendingSessionKeyRef = useRef<string | null>(null);
  const lastActivityRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clientInstanceId = session ? `viewer_${session.key}` : "";
  sessionRef.current = session;

  const resolveConnection = useCallback(async () => {
    if (!session) throw new Error("Sandbox is not ready");
    const response = await fetch("/api/connection", {
      body: JSON.stringify({
        clientInstanceId: `viewer_${session.key}`,
        key: session.key,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = (await response.json()) as {
      connection?: unknown;
      error?: string;
    };
    if (!response.ok) {
      if (response.status === 410) {
        setSession(null);
        setControl("agent");
        setLeaseId(null);
        setError("The sandbox ended. Start another session to continue.");
      }
      throw new Error(result.error ?? "Could not connect to the browser");
    }
    return result.connection as Awaited<
      ReturnType<NonNullable<React.ComponentProps<typeof Browser>["resolveConnection"]>>
    >;
  }, [session]);

  async function startSession(code = accessCode) {
    if (pendingSessionKeyRef.current) return;
    const key = createSessionKey();
    pendingSessionKeyRef.current = key;
    setStarting(true);
    setError(null);
    setReply(
      "Starting Chromium in Cloudflare Sandbox. First boot can take a couple of minutes.",
    );
    try {
      const response = await fetch("/api/session", {
        body: JSON.stringify({ accessCode: code, key }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        code?: string;
        error?: string;
      } & DemoSession;
      if (response.status === 412 && result.code === "deployment_required") {
        pendingSessionKeyRef.current = null;
        setDeploymentRequired(true);
        setError(null);
        setReply("Deploy your own copy to start an isolated Cloudflare Sandbox.");
        return;
      }
      if (response.status === 401 || result.code === "configuration_required") {
        pendingSessionKeyRef.current = null;
        setAccessRequired(true);
        setError(code ? (result.error ?? "Incorrect deployment access code") : null);
        setReply(
          result.code === "configuration_required"
            ? "This deployment needs an access code."
            : "Enter this deployment's private access code to start the sandbox.",
        );
        return;
      }
      if (!response.ok) {
        throw new Error(result.error ?? "Could not start the sandbox");
      }
      setAccessRequired(false);
      setDeploymentRequired(false);
      pendingSessionKeyRef.current = null;
      setSession(result);
      setReply("Sandbox ready. What should the agent do?");
    } catch (nextError) {
      pendingSessionKeyRef.current = null;
      setError(message(nextError));
      setReply("The sandbox did not start.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (deployFirstPreview) {
      setStarting(false);
      setDeploymentRequired(true);
      setReply("Deploy your own copy to start an isolated Cloudflare Sandbox.");
      return;
    }
    void startSession();
  }, []);

  useEffect(() => {
    const cleanUp = (event: PageTransitionEvent) => {
      const active = sessionRef.current;
      const pendingKey = pendingSessionKeyRef.current;
      if (event.persisted || (!active && !pendingKey)) return;
      sessionRef.current = null;
      pendingSessionKeyRef.current = null;
      void fetch("/api/session", {
        body: JSON.stringify({ key: active?.key ?? pendingKey }),
        headers: { "content-type": "application/json" },
        keepalive: true,
        method: "DELETE",
      });
    };
    window.addEventListener("pagehide", cleanUp);
    return () => window.removeEventListener("pagehide", cleanUp);
  }, []);

  const reportActivity = useCallback(() => {
    if (!session || Date.now() - lastActivityRef.current < 60_000) return;
    lastActivityRef.current = Date.now();
    void fetch("/api/activity", {
      body: JSON.stringify({ key: session.key }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }, [session]);

  const handleAgentActivity = useCallback(
    (activity: BrowserAgentActivity | null) => {
      if (activity) setAgentActivity(activity);
    },
    [],
  );

  async function endSession() {
    if (!session) return;
    setError(null);
    try {
      const response = await fetch("/api/session", {
        body: JSON.stringify({ key: session.key }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(result.error ?? "Could not end the sandbox");
      }
      setSession(null);
      setControl("agent");
      setLeaseId(null);
      setHasPrompted(false);
      setReply("The sandbox has ended. Restart it whenever you are ready.");
    } catch (nextError) {
      setError(message(nextError));
    }
  }

  async function changeControl(action: "acquire" | "release") {
    if (!session) return false;
    setError(null);
    try {
      const response = await fetch("/api/control", {
        body: JSON.stringify({
          action,
          clientInstanceId,
          key: session.key,
          ...(leaseId ? { leaseId } : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: string;
        leaseId?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not change browser control");
      }
      const nextControl = action === "acquire" ? "human" : "agent";
      setControl(nextControl);
      setLeaseId(action === "acquire" ? (result.leaseId ?? null) : null);
      setReply(
        action === "acquire"
          ? "You have control of the browser."
          : "Control returned to the agent.",
      );
      if (action === "acquire") setAgentRunning(false);
      return true;
    } catch (nextError) {
      setError(message(nextError));
      return false;
    }
  }

  async function sendPrompt(event: FormEvent) {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!session || !instruction || agentRunning) return;
    setPrompt("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setError(null);
    setHasPrompted(true);
    setReply(instruction);
    setAgentActivity(null);
    setAgentRunning(true);
    if (control === "human" && !(await changeControl("release"))) {
      setPrompt(instruction);
      setAgentRunning(false);
      return;
    }
    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({ key: session.key, prompt: instruction }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: string;
        reply?: string;
      };
      if (!response.ok) {
        throw new Error(
          result.error ?? "The agent could not complete that request",
        );
      }
      setReply(result.reply ?? "Done.");
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setAgentActivity(null);
      setAgentRunning(false);
    }
  }

  return (
    <div className="page">
      <header className="site-header">
        <a className="brand" href="https://browser-ui.danielsi.ms">
          browser-ui <span>/ cloudflare-sandbox</span>
        </a>
        <div className="header-actions">
          {session || starting ? (
            <>
              <span
                className={starting ? "sandbox-status starting" : "sandbox-status"}
              >
                <i /> {starting ? "Starting sandbox" : "Live sandbox"}
              </span>
              {session ? (
                <>
                  <button
                    className="text-button"
                    onClick={() =>
                      void changeControl(
                        control === "human" ? "release" : "acquire",
                      )
                    }
                  >
                    {control === "human" ? "Return to agent" : "Take control"}
                  </button>
                  <button
                    className="text-button muted"
                    onClick={() => void endSession()}
                  >
                    End
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          <DeployButton compact />
        </div>
      </header>

      <main className="content">
        <section className="intro">
          <h1>browser-ui - Cloudflare Sandbox Example</h1>
          <p>
            A real agent-browser session running in an isolated Cloudflare
            Sandbox. Ask the agent to browse, or take over the same session
            yourself.
          </p>
        </section>

        <section
          aria-label="Remote browser"
          className="browser-area"
          onKeyDownCapture={reportActivity}
          onPointerDownCapture={reportActivity}
          onPointerMoveCapture={reportActivity}
          onWheelCapture={reportActivity}
        >
          {session ? (
            <Browser
              colorScheme="light"
              displayControls={
                <button
                  aria-label="End sandbox"
                  className="bui-display-trigger sandbox-end-trigger"
                  onClick={() => void endSession()}
                  title="End sandbox"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <rect height="6" rx="1" width="6" x="5" y="5" />
                  </svg>
                </button>
              }
              interactive={control === "human"}
              onActivityChange={handleAgentActivity}
              onInteractionIntent={() => changeControl("acquire")}
              onTakeControl={() => void changeControl("acquire")}
              operating={agentRunning && control === "agent"}
              operatingLabel="Agent is browsing"
              resolveConnection={resolveConnection}
              showFullscreen
              showPictureInPicture
              style={{ width: "100%" }}
              viewportSize={session.viewport}
            />
          ) : (
            <BrowserRoot
              colorScheme="light"
              style={
                {
                  "--bui-browser-aspect-ratio": "1.6",
                  width: "100%",
                } as CSSProperties
              }
            >
              <BrowserSurface
                className="bui-browser-surface"
                loading
                loadingFallback={
                  starting ? (
                    <BrowserLoading label="Starting Cloudflare Sandbox" />
                  ) : deploymentRequired ? (
                    <div className="sandbox-deploy">
                      <h2>Deploy Sandbox</h2>
                      <p>
                        Run Browser UI with Cloudflare Sandbox and Workers AI in
                        your account.
                      </p>
                      <DeployButton />
                    </div>
                  ) : accessRequired ? (
                    <form
                      className="sandbox-access"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (accessCode.trim()) {
                          void startSession(accessCode.trim());
                        }
                      }}
                    >
                      <span>Private deployment</span>
                      <p>Enter the access code configured during deployment.</p>
                      <div>
                        <input
                          aria-label="Deployment access code"
                          autoComplete="current-password"
                          onChange={(event) => setAccessCode(event.target.value)}
                          placeholder="Access code"
                          type="password"
                          value={accessCode}
                        />
                        <button
                          disabled={!accessCode.trim() || starting}
                          type="submit"
                        >
                          Start
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="sandbox-retry">
                      <span>Remote browser offline</span>
                      <p>Sandbox stopped. Start a new session.</p>
                      <button onClick={() => void startSession()}>
                        Restart sandbox
                      </button>
                    </div>
                  )
                }
                style={{ aspectRatio: 1.6 }}
              />
            </BrowserRoot>
          )}
        </section>
      </main>

      <div className="composer-dock">
        {!deploymentRequired ? (
          <div
            aria-live="polite"
            className={error ? "agent-update error" : "agent-update"}
          >
            {!accessRequired ? (
              <span>
                {agentRunning
                  ? "Agent"
                  : error
                    ? "Error"
                    : control === "human"
                      ? "Handoff"
                      : "Agent"}
              </span>
            ) : null}
            <p>
              {error ??
                (agentRunning ? (agentActivity?.label ?? "Working...") : reply)}
            </p>
          </div>
        ) : null}
        {session && !hasPrompted ? (
          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion} onClick={() => setPrompt(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {!deploymentRequired ? (
          <form className="composer" onSubmit={(event) => void sendPrompt(event)}>
            <textarea
              aria-label="Browser instruction"
              disabled={!session}
              onChange={(event) => setPrompt(event.target.value)}
              onInput={(event) => {
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(
                  event.currentTarget.scrollHeight,
                  120,
                )}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                session ? "Ask the agent to browse..." : "Start a sandbox to begin"
              }
              ref={textareaRef}
              rows={1}
              value={prompt}
            />
            <div className="composer-footer">
              <span className="model-label">
                <i /> GPT-5.6 Luna
              </span>
              <button
                aria-label="Send instruction"
                disabled={!session || !prompt.trim() || agentRunning}
                title="Send instruction"
                type="submit"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M8 12.5v-9m0 0L4.5 7M8 3.5 11.5 7" />
                </svg>
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function DeployButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={compact ? "deploy-button compact" : "deploy-button"}
      href={deployUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <CloudflareMark />
      <span>Deploy to Cloudflare</span>
    </a>
  );
}

function CloudflareMark() {
  return (
    <svg
      aria-hidden="true"
      className="cloudflare-mark"
      viewBox="12 13 25 13"
    >
      <path d="M28.887 24.775l.123-.425c.146-.505.092-.972-.154-1.315-.226-.316-.602-.502-1.059-.524l-8.655-.11a.17.17 0 0 1-.136-.073.18.18 0 0 1-.019-.156.22.22 0 0 1 .201-.154l8.736-.11c1.036-.048 2.158-.889 2.55-1.914l.499-1.302a.3.3 0 0 0 .013-.172 5.69 5.69 0 0 0-5.551-4.446 5.68 5.68 0 0 0-5.388 3.858 2.55 2.55 0 0 0-4.014 2.683 3.64 3.64 0 0 0-3.494 4.163.17.17 0 0 0 .166.146l15.98.002a.21.21 0 0 0 .202-.151Z" />
      <path d="M31.77 18.788c-.08 0-.161.002-.24.006a.15.15 0 0 0-.125.1l-.34 1.176c-.147.505-.092.971.153 1.314.226.317.602.502 1.059.524l1.845.11a.17.17 0 0 1 .132.072.18.18 0 0 1 .019.157.22.22 0 0 1-.2.154l-1.918.11c-1.04.048-2.162.889-2.555 1.914l-.139.362c-.025.066.022.136.091.139h6.602a.18.18 0 0 0 .17-.127 4.74 4.74 0 0 0-4.554-6.011Z" />
    </svg>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function createSessionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
