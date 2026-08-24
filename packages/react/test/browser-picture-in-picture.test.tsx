// @vitest-environment jsdom

import { useMemo, useRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserPictureInPictureSnapPoint } from "../src/browser-picture-in-picture";
import { BrowserPictureInPictureTrigger } from "../src/browser-display";
import {
  cancelBrowserPointerInteraction,
  nearestBrowserPictureInPictureSnapPoint,
} from "../src/browser-picture-in-picture";
import { BrowserRoot } from "../src/browser-root";

class MockResizeObserver {
  observe() {
    return undefined;
  }

  unobserve() {
    return undefined;
  }

  disconnect() {
    return undefined;
  }
}

function rect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height);
}

function PictureInPictureHarness({
  allowedSnapPoints = ["bottom-left", "bottom-right"],
  defaultSnapPoint = "bottom-right",
  onSnapPointChange,
  preserveInlineSpace = false,
  withAvoidRegion = false,
  withCornerAvoidRegion = false,
}: {
  allowedSnapPoints?: readonly BrowserPictureInPictureSnapPoint[];
  defaultSnapPoint?: BrowserPictureInPictureSnapPoint;
  onSnapPointChange?: (snapPoint: BrowserPictureInPictureSnapPoint) => void;
  preserveInlineSpace?: boolean;
  withAvoidRegion?: boolean;
  withCornerAvoidRegion?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const avoidRef = useRef<HTMLDivElement>(null);
  const cornerAvoidRef = useRef<HTMLDivElement>(null);
  const avoidRefs = useMemo(() => [avoidRef, cornerAvoidRef], []);
  return (
    <div ref={containerRef} data-testid="pip-container">
      {withAvoidRegion ? (
        <div ref={avoidRef} data-testid="pip-avoid-region" />
      ) : null}
      {withCornerAvoidRegion ? (
        <div ref={cornerAvoidRef} data-testid="pip-corner-avoid-region" />
      ) : null}
      <BrowserRoot
        mode="picture-in-picture"
        pictureInPicture={{
          allowedSnapPoints,
          avoidRefs:
            withAvoidRegion || withCornerAvoidRegion ? avoidRefs : undefined,
          containerRef,
          defaultSnapPoint,
          inset: 20,
          onSnapPointChange,
          preserveInlineSpace,
        }}
      >
        <div>Browser content</div>
      </BrowserRoot>
    </div>
  );
}

function ControlledModeHarness({
  mode,
}: {
  mode: "inline" | "picture-in-picture";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} data-testid="pip-container">
      <BrowserRoot mode={mode} pictureInPicture={{ containerRef, inset: 20 }}>
        <div>Browser content</div>
      </BrowserRoot>
    </div>
  );
}

function ToggleHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} data-testid="pip-container">
      <BrowserRoot
        defaultMode="inline"
        pictureInPicture={{ containerRef, inset: 20 }}
      >
        <BrowserPictureInPictureTrigger />
        <div>Browser content</div>
      </BrowserRoot>
    </div>
  );
}

describe("BrowserRoot picture-in-picture container", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("PointerEvent", MouseEvent);
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: () => undefined },
      setPointerCapture: { configurable: true, value: () => undefined },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "pip-container")
          return rect(100, 80, 900, 500);
        if (this.dataset.testid === "pip-avoid-region")
          return rect(100, 480, 900, 100);
        if (this.dataset.testid === "pip-corner-avoid-region")
          return rect(580, 180, 420, 275);
        if (this.classList.contains("bui-browser-portal"))
          return rect(100, 80, 900, 500);
        if (this.classList.contains("bui-browser-frame")) {
          const localLeft = Number.parseFloat(
            this.style.getPropertyValue("--bui-pip-left") || "440",
          );
          const localTop = Number.parseFloat(
            this.style.getPropertyValue("--bui-pip-top") || "205",
          );
          return rect(100 + localLeft, 80 + localTop, 440, 275);
        }
        return rect(0, 0, 800, 500);
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("constrains the portal to the supplied container", async () => {
    render(<PictureInPictureHarness />);

    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).not.toBeNull(),
    );
    const frame = document.querySelector<HTMLElement>(
      ".bui-browser-frame--pip",
    );
    const portal = frame?.parentElement;

    expect(
      portal?.classList.contains("bui-browser-portal--pip-contained"),
    ).toBe(true);
    expect(portal?.style.left).toBe("100px");
    expect(portal?.style.top).toBe("80px");
    expect(portal?.style.width).toBe("900px");
    expect(portal?.style.height).toBe("500px");
    expect(frame?.style.getPropertyValue("--bui-pip-left")).toBe("440px");
    expect(frame?.style.getPropertyValue("--bui-pip-top")).toBe("205px");
  });

  it("preserves viewport-level PiP without adding a broken drag handle", () => {
    render(
      <BrowserRoot mode="picture-in-picture">
        <div>Browser content</div>
      </BrowserRoot>,
    );

    expect(
      screen.queryByRole("button", { name: "Move picture in picture" }),
    ).toBeNull();
  });

  it("moves a resting snap point above a reserved region", async () => {
    render(<PictureInPictureHarness withAvoidRegion />);

    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).not.toBeNull(),
    );
    const frame = document.querySelector<HTMLElement>(
      ".bui-browser-frame--pip",
    );

    expect(frame?.style.getPropertyValue("--bui-pip-left")).toBe("440px");
    expect(frame?.style.getPropertyValue("--bui-pip-top")).toBe("105px");
  });

  it("finds a position that avoids every reserved region", async () => {
    render(<PictureInPictureHarness withAvoidRegion withCornerAvoidRegion />);

    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).not.toBeNull(),
    );
    const frame = document.querySelector<HTMLElement>(
      ".bui-browser-frame--pip",
    );

    expect(frame?.style.getPropertyValue("--bui-pip-left")).toBe("20px");
    expect(frame?.style.getPropertyValue("--bui-pip-top")).toBe("105px");
  });

  it("only retains the inline slot when explicitly requested", () => {
    const { rerender } = render(<PictureInPictureHarness />);
    const root = document.querySelector(".bui-browser");
    expect(root?.hasAttribute("data-pip-preserve-inline-space")).toBe(false);

    rerender(<PictureInPictureHarness preserveInlineSpace />);
    expect(
      document
        .querySelector(".bui-browser")
        ?.getAttribute("data-pip-preserve-inline-space"),
    ).toBe("true");
  });

  it("uses the whole frame as the drag surface and resolves the nearest snap", async () => {
    render(<PictureInPictureHarness />);
    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).not.toBeNull(),
    );
    const frame = document.querySelector<HTMLElement>(
      ".bui-browser-frame--pip",
    );
    if (!frame) throw new Error("Expected a PiP frame");

    expect(frame.dataset.pipDraggable).toBe("true");
    expect(
      screen.queryByRole("button", { name: "Move picture in picture" }),
    ).toBeNull();
    expect(
      nearestBrowserPictureInPictureSnapPoint(
        { left: 20, top: 205 },
        ["bottom-left", "bottom-right"],
        rect(100, 80, 900, 500),
        rect(120, 285, 440, 275),
        20,
        [],
      ),
    ).toBe("bottom-left");
  });

  it("always enters at bottom-right and toggles cleanly back to inline", async () => {
    render(<ToggleHarness />);
    const open = screen.getByRole("button", {
      name: "Open browser picture in picture",
    });

    fireEvent.click(open);
    const frame = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        ".bui-browser-frame--pip",
      );
      if (!element) throw new Error("Expected picture in picture browser");
      return element;
    });
    expect(frame.style.getPropertyValue("--bui-pip-left")).toBe("440px");
    expect(frame.style.getPropertyValue("--bui-pip-top")).toBe("205px");
    frame.style.setProperty("--bui-pip-left", "20px");

    fireEvent.click(
      screen.getByRole("button", { name: "Return browser to page" }),
    );
    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).toBeNull(),
    );
    expect(frame.style.getPropertyValue("--bui-pip-left")).toBe("");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open browser picture in picture",
      }),
    );
    await waitFor(() =>
      expect(frame.style.getPropertyValue("--bui-pip-left")).toBe("440px"),
    );
    expect(frame.style.getPropertyValue("--bui-pip-top")).toBe("205px");
  });

  it("positions a directly controlled transition at its default snap point", async () => {
    const { rerender } = render(<ControlledModeHarness mode="inline" />);

    rerender(<ControlledModeHarness mode="picture-in-picture" />);

    const frame = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        ".bui-browser-frame--pip",
      );
      if (!element) throw new Error("Expected picture in picture browser");
      return element;
    });
    expect(frame.style.getPropertyValue("--bui-pip-left")).toBe("440px");
    expect(frame.style.getPropertyValue("--bui-pip-top")).toBe("205px");
  });

  it("cancels the embedded browser pointer once a surface drag begins", () => {
    const frame = document.createElement("div");
    const viewport = document.createElement("div");
    frame.appendChild(viewport);
    document.body.appendChild(frame);
    const onPointerCancel = vi.fn();
    viewport.addEventListener("pointercancel", onPointerCancel);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => viewport),
    });

    cancelBrowserPointerInteraction(
      new PointerEvent("pointerdown", { clientX: 120, clientY: 160 }),
      frame,
    );

    expect(onPointerCancel).toHaveBeenCalledTimes(1);
    frame.remove();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("honors a restricted snap-point policy", async () => {
    render(
      <PictureInPictureHarness
        allowedSnapPoints={["top-left"]}
        defaultSnapPoint="bottom-right"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".bui-browser-frame--pip")).not.toBeNull(),
    );
    const frame = document.querySelector<HTMLElement>(
      ".bui-browser-frame--pip",
    );

    expect(frame?.style.getPropertyValue("--bui-pip-left")).toBe("20px");
    expect(frame?.style.getPropertyValue("--bui-pip-top")).toBe("20px");
  });
});
