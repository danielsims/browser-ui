"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Browser,
  BrowserLoading,
  BrowserRoot,
  BrowserSurface,
} from "@browser-ui/react";

interface DemoSession {
  expiresAt?: string;
  gatewayOrigin: string;
  key: string;
  sessionId: string;
  title: string;
  viewport: { width: number; height: number };
}

const deployUrl =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdanielsims%2Fbrowser-ui%2Ftree%2Fmain%2Fexamples%2Fvercel-sandbox&project-name=browser-ui-sandbox&repository-name=browser-ui-sandbox&env=DEMO_ACCESS_CODE&envDescription=Set%20a%20private%20code%20that%20protects%20your%20Sandbox%20and%20AI%20usage";

const suggestions = [
  "Open the agent-browser GitHub repository",
  "Find the latest Vercel Sandbox announcement",
  "Open example.com and describe the page",
];

export default function Page() {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [accessRequired, setAccessRequired] = useState(false);
  const [deploymentRequired, setDeploymentRequired] = useState(false);
  const [starting, setStarting] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
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
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: session.key,
        clientInstanceId: `viewer_${session.key}`,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 410) {
        setSession(null);
        setControl("agent");
        setLeaseId(null);
        setError("The sandbox ended. Start another session to continue.");
      }
      throw new Error(result.error ?? "Could not connect to the browser");
    }
    return result.connection;
  }, [session]);

  async function startSession(code = accessCode) {
    if (pendingSessionKeyRef.current) return;
    const key = createSessionKey();
    pendingSessionKeyRef.current = key;
    setStarting(true);
    setError(null);
    setReply(
      "Installing Chrome and starting the remote browser. First boot can take a couple of minutes.",
    );
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: code, key }),
      });
      const result = await response.json();
      if (response.status === 412 && result.code === "deployment_required") {
        pendingSessionKeyRef.current = null;
        setDeploymentRequired(true);
        setError(null);
        setReply("Deploy your own copy to start an isolated Vercel Sandbox.");
        return;
      }
      if (response.status === 401) {
        pendingSessionKeyRef.current = null;
        setAccessRequired(true);
        setError(
          code ? (result.error ?? "Incorrect deployment access code") : null,
        );
        setReply(
          "Enter this deployment's private access code to start its sandbox.",
        );
        return;
      }
      if (!response.ok)
        throw new Error(result.error ?? "Could not start the sandbox");
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
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: active?.key ?? pendingKey,
          waitForCreation: !active,
        }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", cleanUp);
    return () => window.removeEventListener("pagehide", cleanUp);
  }, []);

  const reportActivity = useCallback(() => {
    if (!session || Date.now() - lastActivityRef.current < 60_000) return;
    lastActivityRef.current = Date.now();
    void fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: session.key }),
    });
  }, [session]);

  async function endSession() {
    if (!session) return;
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: session.key }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
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
    if (!session) return;
    setError(null);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          key: session.key,
          clientInstanceId,
          ...(leaseId ? { leaseId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not change browser control");
      const nextControl = action === "acquire" ? "human" : "agent";
      setControl(nextControl);
      setLeaseId(action === "acquire" ? result.leaseId : null);
      setReply(
        action === "acquire"
          ? "You have control of the browser."
          : "Control returned to the agent.",
      );
      if (action === "acquire") setAgentRunning(false);
    } catch (nextError) {
      setError(message(nextError));
    }
  }

  async function sendPrompt(event: FormEvent) {
    event.preventDefault();
    const instruction = prompt.trim();
    if (!session || !instruction || agentRunning || control === "human") return;
    setPrompt("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setError(null);
    setHasPrompted(true);
    setAgentRunning(true);
    setReply(instruction);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: session.key, prompt: instruction }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ?? "The agent could not complete that request",
        );
      setReply(result.reply ?? "Done.");
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setAgentRunning(false);
    }
  }

  return (
    <div className="page">
      <header className="site-header">
        <a className="brand" href="https://browser.danielsi.ms">
          browser-ui <span>/ vercel-sandbox</span>
        </a>
        <div className="header-actions">
          {session || starting ? (
            <>
              <span
                className={
                  starting ? "sandbox-status starting" : "sandbox-status"
                }
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
          {!deploymentRequired ? (
            <a
              className="deploy-button"
              href={deployUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                alt="Deploy with Vercel"
                height="32"
                src="https://vercel.com/button"
                width="103"
              />
            </a>
          ) : null}
        </div>
      </header>

      <main className="content">
        <section className="intro">
          <h1>browser-ui - Vercel Sandbox Example</h1>
          <p>
            A real agent-browser session running in an isolated Vercel Sandbox.
            Ask the agent to browse, or take over the same session yourself.
          </p>
        </section>

        <section
          className="browser-area"
          aria-label="Remote browser"
          onKeyDownCapture={reportActivity}
          onPointerDownCapture={reportActivity}
          onPointerMoveCapture={reportActivity}
          onWheelCapture={reportActivity}
        >
          {session ? (
            <Browser
              colorScheme="light"
              resolveConnection={resolveConnection}
              viewportSize={session.viewport}
              interactive={control === "human"}
              operating={agentRunning && control === "agent"}
              operatingLabel="Agent is browsing"
              displayControls={
                <button
                  className="bui-display-trigger sandbox-end-trigger"
                  onClick={() => void endSession()}
                  title="End sandbox"
                  aria-label="End sandbox"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <rect x="5" y="5" width="6" height="6" rx="1" />
                  </svg>
                </button>
              }
              onTakeControl={() => void changeControl("acquire")}
              showPictureInPicture
              showFullscreen
              style={{ width: "100%" }}
            />
          ) : (
            <BrowserRoot
              colorScheme="light"
              style={
                {
                  width: "100%",
                  "--bui-browser-aspect-ratio": "1.6",
                } as React.CSSProperties
              }
            >
              <BrowserSurface
                className="bui-browser-surface"
                loading
                loadingFallback={
                  starting ? (
                    <BrowserLoading label="Installing Chrome in Vercel Sandbox" />
                  ) : deploymentRequired ? (
                    <div className="sandbox-deploy">
                      <h2>Deploy Sandbox</h2>
                      <p>
                        Run Browser UI in your own Vercel project with Sandbox
                        and AI Gateway.
                      </p>
                      <a
                        href={deployUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          alt="Deploy with Vercel"
                          height="32"
                          src="https://vercel.com/button"
                          width="103"
                        />
                      </a>
                    </div>
                  ) : accessRequired ? (
                    <form
                      className="sandbox-access"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (accessCode.trim())
                          void startSession(accessCode.trim());
                      }}
                    >
                      <span>Private deployment</span>
                      <p>
                        Enter the access code configured by the person who
                        deployed this template.
                      </p>
                      <div>
                        <input
                          aria-label="Deployment access code"
                          autoComplete="current-password"
                          onChange={(event) =>
                            setAccessCode(event.target.value)
                          }
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
                      <p>
                        The disposable sandbox has stopped. Start a fresh
                        session to continue.
                      </p>
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
            className={error ? "agent-update error" : "agent-update"}
            aria-live="polite"
          >
            <span>
              {agentRunning
                ? "Agent"
                : error
                  ? "Error"
                  : control === "human"
                    ? "Handoff"
                    : "Agent"}
            </span>
            <p>{error ?? (agentRunning ? "Working..." : reply)}</p>
          </div>
        ) : null}
        {session && !hasPrompted && control === "agent" ? (
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
              ref={textareaRef}
              aria-label="Browser instruction"
              disabled={!session || control === "human"}
              onChange={(event) => setPrompt(event.target.value)}
              onInput={(event) => {
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                control === "human"
                  ? "Return control to continue chatting"
                  : session
                    ? "Ask the agent to browse..."
                    : "Start a sandbox to begin"
              }
              rows={1}
              value={prompt}
            />
            <div className="composer-footer">
              <span className="model-label">
                <i /> GPT-5.6 Luna
              </span>
              <button
                disabled={
                  !session ||
                  !prompt.trim() ||
                  agentRunning ||
                  control === "human"
                }
                type="submit"
                aria-label="Send instruction"
                title="Send instruction"
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function createSessionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
