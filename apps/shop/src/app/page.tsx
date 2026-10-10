"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BrowserOperatingShaderOptions } from "@browser-ui/react";
import { AgentBrowser } from "@browser-ui/react";

import type {
  ShopPhase,
  ShopProgressEvent,
  ShopSessionSnapshot,
} from "../lib/events";
import { shopViewport } from "../lib/events";
import { derivePlan } from "../lib/plan";
import { PlanList } from "./plan-list";

const examples = ["Korma curry", "Fettuccine carbonara", "Chicken tacos"];

const operatingShader: BrowserOperatingShaderOptions = {
  variant: "tide",
  direction: "top-left-to-bottom-right",
  speed: "slow",
};

interface EventsMessage {
  type: "snapshot" | "event";
  session?: ShopSessionSnapshot | null;
  event?: ShopProgressEvent;
}

async function control(
  action: "take" | "resume" | "end",
): Promise<ShopSessionSnapshot | null> {
  const response = await fetch("/api/shop/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const payload = (await response.json()) as {
    session?: ShopSessionSnapshot | null;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? "Browser command failed");
  return payload.session ?? null;
}

export default function Shop() {
  const [recipe, setRecipe] = useState("");
  const [session, setSession] = useState<ShopSessionSnapshot | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<ShopSessionSnapshot | null>(null);
  const syncingRef = useRef(false);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const subscribe = useCallback(() => {
    const source = new EventSource("/api/shop/events");
    // An event can beat the POST response that first sets the session; if so,
    // pull the snapshot (which carries the whole log) instead of dropping it.
    const resync = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      fetch("/api/shop")
        .then((response) => response.json())
        .then((payload: { session?: ShopSessionSnapshot | null }) => {
          if (payload.session) setSession(payload.session);
        })
        .catch(() => undefined)
        .finally(() => {
          syncingRef.current = false;
        });
    };
    source.onmessage = (raw: MessageEvent<string>) => {
      const message = JSON.parse(raw.data) as EventsMessage;
      if (message.type === "snapshot") setSession(message.session ?? null);
      if (message.type === "event" && message.event) {
        if (!sessionRef.current) {
          resync();
          return;
        }
        const event = message.event;
        setSession((current) => {
          if (!current) return current;
          if (current.events.some((item) => item.seq === event.seq))
            return current;
          const events = [...current.events, event];
          const phase: ShopPhase =
            event.kind === "done" ? "done" : current.phase;
          return { ...current, events, phase };
        });
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => subscribe(), [subscribe]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = recipe.trim();
    if (!value || starting) return;
    setStarting(true);
    setError(null);
    setSession(null);
    try {
      const response = await fetch("/api/shop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe: value }),
      });
      const payload = (await response.json()) as {
        session?: ShopSessionSnapshot;
        error?: string;
      };
      if (!response.ok || !payload.session)
        throw new Error(payload.error ?? "Could not start");
      setSession(payload.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start");
    } finally {
      setStarting(false);
    }
  };

  const runControl = async (action: "take" | "resume" | "end") => {
    try {
      const next = await control(action);
      if (action === "end") {
        setSession(null);
        setRecipe("");
        setError(null);
        inputRef.current?.focus();
        return;
      }
      setSession((current) =>
        current && next ? { ...current, phase: next.phase } : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Browser command failed",
      );
    }
  };

  const phase: ShopPhase = starting ? "starting" : (session?.phase ?? "idle");
  const active = phase !== "idle";
  const operating =
    phase === "starting" || phase === "planning" || phase === "shopping";
  const events = useMemo(() => session?.events ?? [], [session]);
  const plan = useMemo(() => derivePlan(events), [events]);
  const latest = events[events.length - 1];
  const operatingLabel = starting
    ? "Waking up the browser"
    : (latest?.label ?? "Working on it");
  const streamUrl = session?.streamUrl ?? undefined;

  return (
    <main className="shell" data-phase={phase}>
      <header className="masthead">
        <span className="wordmark">Mise</span>
        <span className="masthead-note">
          {active
            ? `Shopping · ${session?.recipe ?? recipe}`
            : "Runs on your machine"}
        </span>
      </header>

      <section className="stage">
        <div className="hero">
          <h1>{active ? "Building your list" : "What are we cooking?"}</h1>
        </div>

        <form className="composer" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={recipe}
            onChange={(event) => setRecipe(event.target.value)}
            placeholder="What are we cooking?"
            aria-label="Recipe"
            spellCheck={false}
            disabled={active}
          />
          <button
            type="submit"
            disabled={active || !recipe.trim()}
            aria-label="Shop this recipe"
          >
            <span aria-hidden>{starting ? "…" : "Shop"}</span>
          </button>
        </form>

        {!active ? (
          <div className="chips">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setRecipe(example)}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {active || error ? (
        <section className="session" aria-live="polite">
          <div className="session-status">
            <span className="status-dot" data-phase={phase} aria-hidden />
            <span className="status-label">
              {error ? "Something went wrong" : operatingLabel}
            </span>
            {latest?.detail ? (
              <span className="status-detail">{latest.detail}</span>
            ) : null}
            <span className="status-phase">{phase}</span>
          </div>

          <div className={plan.total > 0 ? "body body--split" : "body"}>
            {plan.total > 0 ? <PlanList plan={plan} /> : null}
            {streamUrl ? (
              <div className="viewport">
                <AgentBrowser
                  streamUrl={streamUrl}
                  viewportSize={session?.viewport ?? shopViewport}
                  colorScheme="system"
                  operating={operating}
                  operatingLabel={operatingLabel}
                  operatingShader={operatingShader}
                  interactive={phase === "human"}
                  showFullscreen
                  showPictureInPicture
                  onTakeControl={() => void runControl("take")}
                  onEndSession={() => runControl("end")}
                  endSessionLabel="End session"
                />
              </div>
            ) : (
              <div className="viewport viewport--pending">
                <span>
                  {error
                    ? "The browser could not start."
                    : "Bringing the browser up…"}
                </span>
              </div>
            )}
          </div>

          {error ? (
            <p className="notice notice--error">{error}</p>
          ) : phase === "done" ? (
            <p className="notice notice--done">
              All done — the cart is ready in the window above.
            </p>
          ) : null}

          <div className="session-actions">
            {phase === "human" ? (
              <button type="button" onClick={() => void runControl("resume")}>
                Resume agent
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runControl("take")}
                disabled={!streamUrl}
              >
                Take control
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => void runControl("end")}
            >
              {phase === "done" ? "Shop another" : "End session"}
            </button>
          </div>

          {events.length > 0 ? (
            <ol className="log">
              {events.slice(-5).map((event) => (
                <li key={event.seq} data-kind={event.kind}>
                  <span>{event.label}</span>
                  {event.detail ? <em>{event.detail}</em> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      <footer className="foot">
        <span>
          Powered by an on-device browser you can take over at any moment.
        </span>
      </footer>
    </main>
  );
}
