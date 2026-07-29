// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentBrowserViewport } from "../src/agent-browser-viewport";
import { Browser } from "../src/browser";
import { BrowserOperatingOverlay } from "../src/operating-overlay";
import { BrowserRecording } from "../src/browser-recording";

type Listener = (event: Event) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readonly listeners = new Map<string, Set<Listener>>();
  readyState = MockWebSocket.OPEN;

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send() {}

  close() {
    this.readyState = 3;
  }

  emit(type: string, event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class MockResizeObserver {
  static observeCount = 0;
  observe() { MockResizeObserver.observeCount += 1; }
  disconnect() {}
}

describe("AgentBrowserViewport", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    MockResizeObserver.observeCount = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports a fixed remote viewport without following presentation size", async () => {
    const onViewportResize = vi.fn();
    render(<AgentBrowserViewport
      streamUrl="ws://127.0.0.1:9223"
      viewportSize={{ width: 1280, height: 800 }}
      onViewportResize={onViewportResize}
    />);

    await waitFor(() => expect(onViewportResize).toHaveBeenCalledWith(1280, 800));
    expect(onViewportResize).toHaveBeenCalledTimes(1);
    expect(MockResizeObserver.observeCount).toBe(0);
  });

  it("does not report a usable browser on WebSocket open alone", async () => {
    const onStatusChange = vi.fn();
    render(<AgentBrowserViewport
      streamUrl="ws://127.0.0.1:9223"
      onStatusChange={onStatusChange}
    />);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    expect(onStatusChange).not.toHaveBeenCalledWith("connected");

    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "status",
        connected: true,
        screencasting: true,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    }));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("connected"));
  });

  it("is view-only unless interaction is explicitly enabled", () => {
    const view = render(<AgentBrowserViewport streamUrl="ws://127.0.0.1:9223" />);
    expect(screen.getByRole("application").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("application").getAttribute("tabindex")).toBe("-1");

    view.rerender(<AgentBrowserViewport
      interactive
      streamUrl="ws://127.0.0.1:9223"
    />);
    expect(screen.getByRole("application").getAttribute("aria-disabled")).toBe("false");
  });

  it("requires a live matching lease when access is projected", () => {
    const viewer = { id: "viewer", displayName: "Viewer", kind: "user" as const };
    render(<AgentBrowserViewport
      access={{
        owner: viewer,
        viewer,
        visibility: "explicit",
        capabilities: ["observe", "control"],
        controller: viewer,
      }}
      interactive
      streamUrl="ws://127.0.0.1:9223"
    />);
    expect(screen.getByRole("application").getAttribute("aria-disabled")).toBe("true");
  });

  it("requests control on first interaction without forwarding the click", () => {
    const onInteractionIntent = vi.fn();
    const viewer = { id: "viewer", displayName: "Viewer", kind: "user" as const };
    render(<AgentBrowserViewport
      access={{
        owner: viewer,
        viewer,
        visibility: "explicit",
        capabilities: ["observe", "control"],
      }}
      interactive
      onInteractionIntent={onInteractionIntent}
      streamUrl="ws://127.0.0.1:9223"
    />);

    const viewport = screen.getByRole("application");
    expect(viewport.getAttribute("data-input-intent")).toBe("true");
    fireEvent.pointerDown(viewport);
    expect(onInteractionIntent).toHaveBeenCalledTimes(1);
  });

  it("uses the operating surface itself as the takeover control", () => {
    const onTakeControl = vi.fn();
    render(<BrowserOperatingOverlay onTakeControl={onTakeControl} />);

    const takeover = screen.getByRole("button", { name: "Take control" });
    expect(takeover.tagName).toBe("DIV");
    fireEvent.click(takeover);
    expect(onTakeControl).toHaveBeenCalledTimes(1);
  });

  it("starts recordings at a settled frame and follows cursor movement", async () => {
    const view = render(<BrowserRecording
      operating
      playbackRate={1.5}
      src="/preview.mp4"
      startTime={5.5}
      timeline={[
        { at: 0, operatingLabel: "Opening", agentCursor: { x: .5, y: .5, visible: false } },
        { at: 5_000, operatingLabel: "Selecting", agentCursor: { x: .8, y: .1, visible: true } },
        { at: 10_000, operatingLabel: "Reviewing", agentCursor: { x: .2, y: .7, visible: true } },
      ]}
      viewportSize={{ width: 1280, height: 800 }}
    />);

    expect(view.container.querySelector(".bui-agent-cursor--visible")).not.toBeNull();
    expect(screen.getByText("Selecting")).not.toBeNull();
    const video = screen.getByLabelText("Recorded browser workflow") as HTMLVideoElement;
    expect(video.closest(".bui-browser-surface")).not.toBeNull();
    await waitFor(() => expect(video.playbackRate).toBe(1.5));
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(5.5);
    expect(video.autoplay).toBe(false);
    fireEvent.seeked(video);
    await waitFor(() => expect(video.autoplay).toBe(true));
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    await waitFor(() => {
      expect(view.container.querySelector<HTMLElement>(".bui-agent-cursor")?.style.getPropertyValue("--bui-agent-cursor-x")).toBe("20%");
      expect(screen.getByText("Reviewing")).not.toBeNull();
    });
  });

  it("keeps the live socket mounted across display modes", () => {
    const view = render(<Browser
      mode="inline"
      streamUrl="ws://127.0.0.1:9223"
      viewportSize={{ width: 1280, height: 800 }}
    />);
    expect(MockWebSocket.instances).toHaveLength(1);

    view.rerender(<Browser
      mode="fullscreen"
      streamUrl="ws://127.0.0.1:9223"
      viewportSize={{ width: 1280, height: 800 }}
    />);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("animates externally controlled inline to picture-in-picture changes", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const pip = this.classList.contains("bui-browser-frame--pip");
      const width = pip ? 440 : 800;
      const height = pip ? 275 : 500;
      const left = pip ? 800 : 100;
      const top = pip ? 425 : 100;
      return {
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const view = render(<Browser
      mode="inline"
      streamUrl="ws://127.0.0.1:9223"
      viewportSize={{ width: 1280, height: 800 }}
    />);
    await waitFor(() => expect(view.container.querySelector(".bui-browser-frame")).not.toBeNull());

    view.rerender(<Browser
      mode="picture-in-picture"
      streamUrl="ws://127.0.0.1:9223"
      viewportSize={{ width: 1280, height: 800 }}
    />);
    const frame = view.container.ownerDocument.querySelector<HTMLElement>(".bui-browser-frame--pip");
    expect(frame?.dataset.transitioning).toBe("true");
    expect(frame?.style.transform).toContain("scale(1, 1)");
    expect(frame?.style.transition).toContain("420ms");
    expect(frame?.parentElement?.parentElement).toBe(document.body);
  });

  it("resolves a fresh gateway connection before opening the socket", async () => {
    const resolveConnection = vi.fn(async () => ({
      url: "wss://sessions.example.com/v1/view",
      protocols: ["browser-session.v1", "ticket.once"],
    }));
    render(<AgentBrowserViewport resolveConnection={resolveConnection} />);

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(resolveConnection).toHaveBeenCalledTimes(1);
  });
});
