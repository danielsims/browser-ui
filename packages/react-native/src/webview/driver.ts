import type {
  BrowserDriverCapability,
  BrowserDriverDescriptor,
} from "@browser-ui/core";
import { createBrowserDriverDescriptor } from "@browser-ui/core";

import type {
  ClickStage,
  WebViewBrowserClickOptions,
  WebViewBrowserClickResult,
  WebViewBrowserClickStatus,
} from "./click";
import { readClickElement, readStageStatus } from "./click";
import {
  buildDispatchClickScript,
  buildResolveClickScript,
  buildTypeScript,
  buildVerifyClickScript,
} from "./click-script";
import { SNAPSHOT_SCRIPT } from "./snapshot-script";

export type {
  WebViewBrowserClickElement,
  WebViewBrowserClickOptions,
  WebViewBrowserClickResult,
  WebViewBrowserClickStatus,
} from "./click";

/**
 * How to re-find an element if its `data-browser-ui-ref` node is replaced.
 * Captured at snapshot time; matched against the live composed DOM on click.
 */
export interface WebViewBrowserElementFingerprint {
  role: string;
  name: string;
  tag: string;
  href?: string;
  text?: string;
  context?: string;
  /** Index among elements with the same role and name, in composed order. */
  index: number;
}

/** One interactive element in a snapshot. `ref` is stable within a page. */
export interface WebViewBrowserElement {
  ref: string;
  role: string;
  name: string;
  context?: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  placeholder?: string;
  fingerprint?: WebViewBrowserElementFingerprint;
}

/** The semantic view of a live page that agent decisions are made over. */
export interface WebViewBrowserSnapshot {
  url: string;
  title: string;
  text: string;
  elements: WebViewBrowserElement[];
}

/**
 * Where the agent acted, normalised to the viewport (0..1 from the top-left).
 * The view renders this as an animated cursor/tap indicator.
 */
export interface WebViewBrowserCursor {
  x: number;
  y: number;
  label?: string;
  pressed?: boolean;
  typing?: boolean;
}

/** An action the driver performed that the view may visualise. */
export interface WebViewBrowserActivity {
  action: "click" | "type";
  cursor: WebViewBrowserCursor;
}

export type WebViewBrowserActivityListener = (
  activity: WebViewBrowserActivity,
) => void;

export interface WebViewBrowserDriverOptions {
  /** Descriptor id. Defaults to `react-native-webview`. */
  id?: string;
  /** How long a bridge call waits before rejecting. Defaults to 15 seconds. */
  requestTimeoutMs?: number;
  /** How long `click` waits to confirm the page changed. Defaults to 600ms. */
  clickConfirmationMs?: number;
  /** Approve a URL before the driver navigates. Defaults to http/https. */
  allowsUrl?: (url: string) => boolean;
  /** Approve an element before `click`/`type` act on it. */
  allowsElement?: (element: WebViewBrowserElement) => boolean;
}

/** Anything the driver needs from the view: `injectJavaScript` is enough. */
export interface WebViewBrowserInjector {
  injectJavaScript(script: string): void;
}

interface PendingCall {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BridgeMessage {
  error?: unknown;
  id?: unknown;
  ok?: unknown;
  value?: unknown;
}

const DEFAULT_ID = "react-native-webview";
const DEFAULT_TIMEOUT_MS = 15_000;
const CAPABILITIES: readonly BrowserDriverCapability[] = [
  "navigation",
  "semantic-snapshot",
  "element-click",
  "text-input",
  "script-evaluation",
  "wait",
];

function schemeOf(url: string): string {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1]?.toLowerCase() ?? "";
}

function allowsHttp(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === "http" || scheme === "https" || scheme === "about";
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return null;
  return {
    x: Math.max(0, Math.min(1, record.x)),
    y: Math.max(0, Math.min(1, record.y)),
  };
}

function isSnapshot(value: unknown): value is WebViewBrowserSnapshot {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.url === "string" &&
    typeof record.title === "string" &&
    typeof record.text === "string" &&
    Array.isArray(record.elements)
  );
}

/**
 * Drives a `react-native-webview` instance from the agent loop.
 *
 * `injectJavaScript` cannot return a value, so every call is a correlated
 * request/response over `postMessage`: a unique id travels into the page and
 * the page posts back `{ id, ok, value }`. `snapshot` tags elements with a
 * stable `data-browser-ui-ref` attribute so later calls act on the same nodes.
 */
export class WebViewBrowserDriver {
  readonly descriptor: BrowserDriverDescriptor;

  private handle: WebViewBrowserInjector | null = null;
  private options: WebViewBrowserDriverOptions;
  private pending = new Map<string, PendingCall>();
  private elements = new Map<string, WebViewBrowserElement>();
  private listeners = new Set<WebViewBrowserActivityListener>();
  private sequence = 0;

  constructor(options: WebViewBrowserDriverOptions = {}) {
    this.options = options;
    this.descriptor = createBrowserDriverDescriptor(
      options.id ?? DEFAULT_ID,
      "webkit",
      CAPABILITIES,
    );
  }

  /** Merge new host policy. Read by the next navigation or element action. */
  configure(options: WebViewBrowserDriverOptions): void {
    this.options = { ...this.options, ...options };
  }

  allowsNavigation(url: string): boolean {
    return this.options.allowsUrl?.(url) ?? allowsHttp(url);
  }

  /**
   * Observe driver actions with the viewport point they acted on. Returns an
   * unsubscribe. Visualisation only: the driver never synthesises input.
   */
  subscribeActivity(listener: WebViewBrowserActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  attach(handle: WebViewBrowserInjector | null): void {
    this.handle = handle;
  }

  detach(): void {
    this.handle = null;
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error("The browser was closed."));
      this.pending.delete(id);
    }
  }

  /** Feed a `postMessage` payload from the WebView. Ignores foreign messages. */
  receive(data: string): void {
    let message: BridgeMessage;
    try {
      message = JSON.parse(data) as BridgeMessage;
    } catch {
      return;
    }
    if (typeof message.id !== "string") return;
    const call = this.pending.get(message.id);
    if (!call) return;
    this.pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.ok === true) call.resolve(message.value);
    else {
      call.reject(
        new Error(
          typeof message.error === "string"
            ? message.error
            : "Browser action failed.",
        ),
      );
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.allowsNavigation(url)) {
      throw new Error("Navigation was blocked by the host policy.");
    }
    await this.call(`(location.assign(${JSON.stringify(url)}), "ok")`);
    await this.waitForDocument();
  }

  async snapshot(): Promise<WebViewBrowserSnapshot> {
    const value = await this.call(SNAPSHOT_SCRIPT, 20_000);
    if (!isSnapshot(value)) throw new Error("Could not read the page.");
    // The page sends each fingerprint without the fields it shares with its
    // element, which keeps large snapshots small on the native bridge.
    for (const element of value.elements) {
      if (!element.fingerprint) continue;
      element.fingerprint = {
        ...element.fingerprint,
        role: element.role,
        name: element.name,
        ...(element.context ? { context: element.context.slice(0, 160) } : {}),
      };
    }
    this.elements = new Map(
      value.elements.map((element) => [element.ref, element]),
    );
    return value;
  }

  /** Evaluate `js` in the page and return its value. */
  async evaluate(js: string): Promise<unknown> {
    const value = await this.call(
      `(function(){try{return eval(${JSON.stringify(js)});}catch(e){return {__error:String((e&&e.message)||e)};}})()`,
    );
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.__error === "string") throw new Error(record.__error);
    }
    return value;
  }

  /**
   * Activate a snapshot ref with a realistic pointer/touch sequence, then report
   * whether the page reacted. A missing or replaced ref is re-resolved from its
   * locator fingerprint against the live composed DOM (open shadow roots
   * included) before giving up. Never throws for an element condition: the
   * precise `status`, `element`, and diagnostic `message` are returned for the
   * caller to surface, which is what makes a device failure diagnosable.
   */
  async click(
    ref: string,
    options: WebViewBrowserClickOptions = {},
  ): Promise<WebViewBrowserClickResult> {
    this.assertAllowed(ref, "Click");
    const known = this.elements.get(ref);
    const fingerprint = known?.fingerprint;
    const targetRef = ref;
    let stage = await this.runClickStage(
      buildResolveClickScript(targetRef, fingerprint),
      targetRef,
    );

    // Legacy snapshots (no fingerprint) still get the role/name snapshot retry.
    if (stage.status === "ref-not-found" && !fingerprint && known) {
      const fresh = await this.snapshot();
      const match = fresh.elements.find(
        (element) =>
          element.role === known.role &&
          element.name === known.name &&
          !element.disabled,
      );
      if (match) {
        stage = await this.runClickStage(
          buildResolveClickScript(match.ref, match.fingerprint),
          match.ref,
        );
      }
    }

    if (stage.status !== "ok") return this.toClickResult(stage);

    // Let the scrollIntoView settle before measuring where to dispatch.
    await this.wait(120);
    const dispatched = await this.runClickStage(
      buildDispatchClickScript(targetRef, fingerprint),
      targetRef,
    );
    if (dispatched.point) {
      this.reportActivity({
        action: "click",
        cursor: { ...dispatched.point, pressed: true },
      });
    }
    if (dispatched.status !== "dispatched") {
      return this.toClickResult(dispatched);
    }
    if (options.confirm === false || typeof dispatched.before !== "string") {
      return this.toClickResult(dispatched, { status: "clicked" });
    }

    await this.wait(this.options.clickConfirmationMs ?? 600);
    const verified = await this.runClickStage(
      buildVerifyClickScript(targetRef, dispatched.before, fingerprint),
      targetRef,
    );
    return this.toClickResult(dispatched, {
      status:
        verified.status === "clicked"
          ? "clicked"
          : "dispatched-but-unconfirmed",
      element: verified.element ?? dispatched.element,
    });
  }

  private toClickResult(
    stage: ClickStage,
    overrides: Partial<
      Pick<WebViewBrowserClickResult, "status" | "element">
    > = {},
  ): WebViewBrowserClickResult {
    const status: WebViewBrowserClickStatus =
      overrides.status ??
      (stage.status === "ok" || stage.status === "dispatched"
        ? "dispatched-but-unconfirmed"
        : stage.status);
    return {
      status,
      ref: stage.ref,
      element:
        overrides.element !== undefined ? overrides.element : stage.element,
      ...(stage.point ? { point: stage.point } : {}),
      ...(stage.message ? { message: stage.message } : {}),
      ...(stage.sequence ? { sequence: stage.sequence } : {}),
    };
  }

  private async runClickStage(
    script: string,
    ref: string,
  ): Promise<ClickStage> {
    const raw = await this.call(script);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("The browser returned no click result.");
    }
    const record = raw as Record<string, unknown>;
    const status = readStageStatus(record.status);
    if (!status)
      throw new Error("The browser returned an unknown click result.");
    const point = readPoint(record.point);
    const message =
      typeof record.message === "string" ? record.message : undefined;
    const before =
      typeof record.before === "string" ? record.before : undefined;
    const sequence = Array.isArray(record.sequence)
      ? record.sequence
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 24)
      : undefined;
    return {
      status,
      ref: typeof record.ref === "string" ? record.ref : ref,
      element: readClickElement(record.element),
      ...(point ? { point } : {}),
      ...(message ? { message } : {}),
      ...(before ? { before } : {}),
      ...(sequence ? { sequence } : {}),
    };
  }

  async type(ref: string, text: string): Promise<void> {
    this.assertAllowed(ref, "Typing into");
    const known = this.elements.get(ref);
    const result = await this.call(
      buildTypeScript(ref, text, known?.fingerprint),
    );
    const record =
      result !== null && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null;
    if (record?.status !== "ok") {
      throw new Error(
        typeof record?.message === "string"
          ? record.message
          : `No element matches ref ${ref}`,
      );
    }
    const point = readPoint(record.point);
    if (point) {
      this.reportActivity({
        action: "type",
        cursor: { ...point, typing: true },
      });
    }
  }

  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, milliseconds));
    });
  }

  private reportActivity(activity: WebViewBrowserActivity): void {
    for (const listener of this.listeners) listener(activity);
  }

  private assertAllowed(ref: string, action: string): void {
    const element = this.elements.get(ref);
    if (element && this.options.allowsElement?.(element) === false) {
      throw new Error(
        `${action} "${element.name}" was blocked by the host policy.`,
      );
    }
  }

  private async waitForDocument(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await this.evaluate("document.readyState");
        if (state === "interactive" || state === "complete") return;
      } catch {
        // The page is mid-navigation; try again.
      }
      await this.wait(250);
    }
  }

  private call(
    expression: string,
    timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    const handle = this.handle;
    if (!handle) return Promise.reject(new Error("The browser is not ready."));
    this.sequence += 1;
    const id = `c${this.sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The browser did not respond."));
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      handle.injectJavaScript(
        `(function(){var id=${JSON.stringify(id)};try{var value=(${expression});window.ReactNativeWebView.postMessage(JSON.stringify({id:id,ok:true,value:value}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({id:id,ok:false,error:String((e&&e.message)||e)}));}})();true;`,
      );
    });
  }
}
