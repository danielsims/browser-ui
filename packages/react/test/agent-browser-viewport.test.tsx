// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentBrowserViewport } from "../src/agent-browser-viewport";
import { Browser } from "../src/browser";
import { BrowserOperatingOverlay } from "../src/operating-overlay";
import { BrowserOperatingShader } from "../src/operating-shader";
import { BrowserRecording } from "../src/browser-recording";

type Listener = (event: Event) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readonly listeners = new Map<string, Set<Listener>>();
  readonly sent: string[] = [];
  readyState = MockWebSocket.OPEN;

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) { this.sent.push(value); }

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
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1280, height: 800, close() {} }));
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [],
    });
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: () => undefined },
      setPointerCapture: { configurable: true, value: () => undefined },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("requests control from a view-only viewport and replays the first click", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 400, height: 400, left: 0, right: 640, top: 0, width: 640,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const onInteractionIntent = vi.fn();
    const view = render(<AgentBrowserViewport
      onInteractionIntent={onInteractionIntent}
      streamUrl="ws://127.0.0.1:9223"
    />);
    const viewport = screen.getByRole("application");
    const socket = MockWebSocket.instances[0];
    socket.emit("message", frameMessage());
    await waitFor(() => expect(viewport.querySelector("canvas")?.width).toBe(1280));

    expect(viewport.getAttribute("data-input-intent")).toBe("true");
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 320,
      clientY: 200,
      pointerId: 1,
    });
    expect(onInteractionIntent).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(0);

    view.rerender(<AgentBrowserViewport
      interactive
      onInteractionIntent={onInteractionIntent}
      streamUrl="ws://127.0.0.1:9223"
    />);

    await waitFor(() => {
      const input = socket.sent
        .map((value) => JSON.parse(value))
        .filter((value) => value.type === "input_mouse");
      expect(input.map((value) => value.eventType)).toEqual([
        "mouseMoved",
        "mousePressed",
        "mouseReleased",
      ]);
      expect(input[0]).toMatchObject({ x: 640, y: 400, button: "left" });
    });
  });

  it("requests control from a view-only viewport and replays the first scroll", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 400, height: 400, left: 0, right: 640, top: 0, width: 640,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const onInteractionIntent = vi.fn();
    const view = render(<AgentBrowserViewport
      onInteractionIntent={onInteractionIntent}
      streamUrl="ws://127.0.0.1:9223"
    />);
    const viewport = screen.getByRole("application");
    vi.spyOn(document, "elementsFromPoint").mockReturnValue([viewport]);
    const socket = MockWebSocket.instances[0];
    socket.emit("message", frameMessage());
    await waitFor(() => expect(viewport.querySelector("canvas")?.width).toBe(1280));

    fireEvent.wheel(viewport, {
      clientX: 320,
      clientY: 200,
      deltaX: 10,
      deltaY: 40,
    });
    expect(onInteractionIntent).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(0);

    view.rerender(<AgentBrowserViewport
      interactive
      onInteractionIntent={onInteractionIntent}
      streamUrl="ws://127.0.0.1:9223"
    />);

    await waitFor(() => {
      const wheel = socket.sent
        .map((value) => JSON.parse(value))
        .find((value) => value.eventType === "mouseWheel");
      expect(wheel).toMatchObject({
        x: 640,
        y: 400,
        deltaX: 20,
        deltaY: 80,
      });
    });
  });

  it("forwards clicks directly to the remote viewport", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 400, height: 400, left: 0, right: 640, top: 0, width: 640,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    render(<AgentBrowserViewport interactive streamUrl="ws://127.0.0.1:9223" />);
    const viewport = screen.getByRole("application");
    const socket = MockWebSocket.instances[0];
    socket.emit("message", frameMessage());
    await waitFor(() => expect(viewport.querySelector("canvas")?.width).toBe(1280));

    fireEvent.pointerDown(viewport, { button: 0, clientX: 320, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 320, clientY: 200, pointerId: 1 });

    const input = socket.sent.map((value) => JSON.parse(value)).filter((value) => value.type === "input_mouse");
    expect(input.map((value) => value.eventType)).toEqual(["mousePressed", "mouseReleased"]);
    expect(input[0]).toMatchObject({ x: 640, y: 400, button: "left" });
  });

  it("sends wheel input immediately in remote viewport pixels", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 400, height: 400, left: 0, right: 640, top: 0, width: 640,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    render(<AgentBrowserViewport interactive streamUrl="ws://127.0.0.1:9223" />);
    const viewport = screen.getByRole("application");
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 500 },
      clientWidth: { configurable: true, value: 800 },
    });
    vi.spyOn(document, "elementsFromPoint").mockReturnValue([viewport]);
    const socket = MockWebSocket.instances[0];
    socket.emit("message", frameMessage());
    await waitFor(() => expect(viewport.querySelector("canvas")?.width).toBe(1280));

    fireEvent.wheel(viewport, { clientX: 320, clientY: 200, deltaX: 10, deltaY: 40 });

    const wheel = socket.sent.map((value) => JSON.parse(value)).find((value) => value.eventType === "mouseWheel");
    expect(wheel).toMatchObject({ x: 640, y: 400, deltaX: 20, deltaY: 80 });
  });

  it("coalesces rapid wheel updates instead of building an input backlog", async () => {
    let flushWheel: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      flushWheel = callback;
      return 1;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 400, height: 400, left: 0, right: 640, top: 0, width: 640,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    render(<AgentBrowserViewport interactive streamUrl="ws://127.0.0.1:9223" />);
    const viewport = screen.getByRole("application");
    vi.spyOn(document, "elementsFromPoint").mockReturnValue([viewport]);
    const socket = MockWebSocket.instances[0];
    socket.emit("message", frameMessage());
    await waitFor(() => expect(viewport.querySelector("canvas")?.width).toBe(1280));

    fireEvent.wheel(viewport, { clientX: 320, clientY: 200, deltaY: 10 });
    fireEvent.wheel(viewport, { clientX: 320, clientY: 200, deltaY: 20 });
    fireEvent.wheel(viewport, { clientX: 320, clientY: 200, deltaY: 30 });

    const beforeFlush = socket.sent
      .map((value) => JSON.parse(value))
      .filter((value) => value.eventType === "mouseWheel");
    expect(beforeFlush).toHaveLength(1);
    flushWheel?.(performance.now());

    const afterFlush = socket.sent
      .map((value) => JSON.parse(value))
      .filter((value) => value.eventType === "mouseWheel");
    expect(afterFlush).toHaveLength(2);
    expect(afterFlush[1]).toMatchObject({ deltaY: 100 });
  });

  it("keeps drawing when a newer frame arrives during JPEG decoding", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const decodes: Array<(bitmap: { width: number; height: number; close(): void }) => void> = [];
    vi.stubGlobal("createImageBitmap", () => new Promise((resolve) => decodes.push(resolve)));
    render(<AgentBrowserViewport streamUrl="ws://127.0.0.1:9223" />);
    const socket = MockWebSocket.instances[0];

    socket.emit("message", frameMessage());
    await waitFor(() => expect(decodes).toHaveLength(1));
    socket.emit("message", frameMessage());
    decodes[0]({ width: 1280, height: 800, close() {} });
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(decodes).toHaveLength(2));
    decodes[1]({ width: 1280, height: 800, close() {} });
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
  });

  it("does not draw a decoded frame after its connection is unmounted", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    let finishDecode: ((bitmap: { width: number; height: number; close(): void }) => void) | undefined;
    vi.stubGlobal("createImageBitmap", () => new Promise((resolve) => { finishDecode = resolve; }));
    const view = render(<AgentBrowserViewport streamUrl="ws://127.0.0.1:9223" />);
    MockWebSocket.instances[0].emit("message", frameMessage());
    await waitFor(() => expect(finishDecode).toBeTypeOf("function"));

    view.unmount();
    finishDecode?.({ width: 1280, height: 800, close() {} });
    await Promise.resolve();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("uses the operating surface itself as the takeover control", () => {
    const onTakeControl = vi.fn();
    render(<BrowserOperatingOverlay onTakeControl={onTakeControl} />);

    const takeover = screen.getByRole("button", { name: "Take control" });
    expect(takeover.tagName).toBe("DIV");
    fireEvent.click(takeover);
    expect(onTakeControl).toHaveBeenCalledTimes(1);
  });

  it("projects operating shader options without coupling them to WebGL support", () => {
    render(<BrowserOperatingShader
      className="custom-shader"
      direction="bottom-right-to-top-left"
      speed="fast"
      variant="tide"
    />);

    const shader = document.querySelector("canvas.bui-operating-shader");
    expect(shader?.classList.contains("custom-shader")).toBe(true);
    expect(shader?.getAttribute("data-variant")).toBe("tide");
    expect(shader?.getAttribute("data-direction")).toBe("bottom-right-to-top-left");
    expect(shader?.getAttribute("data-speed")).toBe("fast");
  });

  it("passes shader options through the composed Browser surface", async () => {
    render(<Browser
      operating
      operatingShader={{ variant: "pulse", direction: "right-to-left", speed: "slow" }}
      streamUrl="ws://127.0.0.1:9223"
    />);
    MockWebSocket.instances[0].emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "status",
        connected: true,
        screencasting: true,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    }));

    const shader = await waitFor(() => {
      const element = document.querySelector("canvas.bui-operating-shader");
      expect(element).not.toBeNull();
      return element;
    });
    expect(shader?.getAttribute("data-variant")).toBe("pulse");
    expect(shader?.getAttribute("data-direction")).toBe("right-to-left");
    expect(shader?.getAttribute("data-speed")).toBe("slow");
  });

  it("turns structured browser commands into live operating labels", async () => {
    const onActivityChange = vi.fn();
    render(<Browser
      onActivityChange={onActivityChange}
      streamUrl="ws://127.0.0.1:9223"
    />);
    const socket = MockWebSocket.instances[0];
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "status",
        connected: true,
        screencasting: true,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    }));
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "command",
        action: "open",
        id: "open-one",
        params: { url: "https://example.com/private?token=secret" },
        timestamp: Date.now(),
      }),
    }));

    await waitFor(() => expect(screen.getByText("Opening example.com")).not.toBeNull());
    expect(onActivityChange).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "open-one",
      label: "Opening example.com",
    }));
    expect(document.body.textContent).not.toContain("token=secret");

    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "result",
        id: "open-one",
        action: "open",
        success: true,
        data: null,
        duration_ms: 25,
        timestamp: Date.now(),
      }),
    }));
    await waitFor(() => expect(screen.queryByText("Opening example.com")).toBeNull());
    expect(onActivityChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the latest activity visible between commands during an agent run", async () => {
    const view = render(<Browser
      operating
      operatingLabel="Agent is browsing"
      streamUrl="ws://127.0.0.1:9223"
    />);
    const socket = MockWebSocket.instances[0];
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "status",
        connected: true,
        screencasting: true,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    }));
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "command",
        action: "open",
        id: "open-one",
        params: { url: "https://example.com" },
        timestamp: Date.now(),
      }),
    }));

    await waitFor(() => expect(screen.getByText("Opening example.com")).not.toBeNull());
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        type: "result",
        id: "open-one",
        action: "open",
        success: true,
        data: null,
        duration_ms: 25,
        timestamp: Date.now(),
      }),
    }));
    await waitFor(() => expect(screen.getByText("Opening example.com")).not.toBeNull());
    expect(screen.queryByText("Agent is browsing")).toBeNull();

    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        v: 1,
        type: "activity",
        eventSequence: 1,
        action: "click",
        id: "click-one",
        label: "Clicking an element",
        phase: "started",
        timestamp: Date.now(),
        agentCursor: { x: 0.25, y: 0.75, visible: true },
      }),
    }));
    await waitFor(() => expect(screen.getByText("Clicking an element")).not.toBeNull());
    expect(screen.queryByText("Opening example.com")).toBeNull();
    const cursor = view.container.querySelector<HTMLElement>(".bui-agent-cursor");
    expect(cursor?.style.getPropertyValue("--bui-agent-cursor-x")).toBe("25%");
    expect(cursor?.style.getPropertyValue("--bui-agent-cursor-y")).toBe("75%");
    socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        v: 1,
        type: "activity",
        eventSequence: 2,
        id: "click-one",
        action: "click",
        label: "Clicking an element",
        phase: "completed",
        success: true,
        durationMs: 25,
        timestamp: Date.now(),
      }),
    }));
    await waitFor(() => expect(screen.getByText("Clicking an element")).not.toBeNull());
    expect(view.container.querySelector(".bui-agent-cursor--visible")).not.toBeNull();

    view.rerender(<Browser
      operating={false}
      operatingLabel="Agent is browsing"
      streamUrl="ws://127.0.0.1:9223"
    />);
    await waitFor(() => expect(screen.queryByText("Clicking an element")).toBeNull());
    expect(view.container.querySelector(".bui-agent-cursor--visible")).not.toBeNull();
  });

  it("keeps the live cursor mounted between actions and fades it after inactivity", async () => {
    const view = render(<Browser
      operating
      streamUrl="ws://127.0.0.1:9223"
    />);
    const socket = MockWebSocket.instances[0];
    let hideCursor: (() => void) | undefined;
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 4_000 && typeof handler === "function") {
        hideCursor = () => handler(...args);
        return 1;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    await act(async () => {
      socket.emit("message", new MessageEvent("message", {
        data: JSON.stringify({
          type: "status",
          connected: true,
          screencasting: true,
          viewportWidth: 1280,
          viewportHeight: 800,
        }),
      }));
      socket.emit("message", new MessageEvent("message", {
        data: JSON.stringify({
          v: 1,
          type: "activity",
          eventSequence: 1,
          action: "click",
          id: "click-one",
          label: "Clicking the first element",
          phase: "started",
          timestamp: Date.now(),
          agentCursor: { x: 0.2, y: 0.3, visible: true },
        }),
      }));
      await Promise.resolve();
    });
    const cursor = view.container.querySelector<HTMLElement>(".bui-agent-cursor");
    expect(cursor?.classList.contains("bui-agent-cursor--visible")).toBe(true);

    act(() => socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        v: 1,
        type: "activity",
        eventSequence: 2,
        action: "open",
        id: "open-one",
        label: "Opening another page",
        phase: "started",
        timestamp: Date.now(),
      }),
    })));
    expect(view.container.querySelector(".bui-agent-cursor")).toBe(cursor);
    expect(cursor?.style.getPropertyValue("--bui-agent-cursor-x")).toBe("20%");

    act(() => hideCursor?.());
    expect(view.container.querySelector(".bui-agent-cursor")).toBe(cursor);
    expect(cursor?.classList.contains("bui-agent-cursor--visible")).toBe(false);

    act(() => socket.emit("message", new MessageEvent("message", {
      data: JSON.stringify({
        v: 1,
        type: "activity",
        eventSequence: 3,
        action: "click",
        id: "click-two",
        label: "Clicking the next element",
        phase: "started",
        timestamp: Date.now(),
        agentCursor: { x: 0.8, y: 0.7, visible: true },
      }),
    })));
    expect(view.container.querySelector(".bui-agent-cursor")).toBe(cursor);
    expect(cursor?.classList.contains("bui-agent-cursor--visible")).toBe(true);
    expect(cursor?.style.getPropertyValue("--bui-agent-cursor-x")).toBe("80%");
    expect(cursor?.style.getPropertyValue("--bui-agent-cursor-y")).toBe("70%");
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

function frameMessage() {
  return new MessageEvent("message", {
    data: JSON.stringify({
      type: "frame",
      data: "AA==",
      metadata: {
        deviceWidth: 1280,
        deviceHeight: 800,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    }),
  });
}
