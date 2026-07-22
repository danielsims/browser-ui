"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion, MotionConfig, type HTMLMotionProps } from "motion/react";

export type BrowserVariant = "framed" | "bare";
export type BrowserDisplayMode = "inline" | "picture-in-picture" | "fullscreen";
export type BrowserColorScheme = "light" | "dark" | "system";

interface BrowserRootContextValue {
  mode: BrowserDisplayMode;
  setMode: (mode: BrowserDisplayMode) => void;
}

const BrowserRootContext = createContext<BrowserRootContextValue | null>(null);

function useBrowserRoot() {
  const context = useContext(BrowserRootContext);
  if (!context) throw new Error("Browser controls must be rendered inside BrowserRoot.");
  return context;
}

export interface BrowserRootProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: BrowserVariant;
  defaultMode?: BrowserDisplayMode;
  mode?: BrowserDisplayMode;
  onModeChange?: (mode: BrowserDisplayMode) => void;
  colorScheme?: BrowserColorScheme;
}

const layoutTransition = { type: "spring", visualDuration: .42, bounce: .08 } as const;

/** Layout and display-mode root shared by live and custom transports. */
export const BrowserRoot = forwardRef<HTMLElement, BrowserRootProps>(function BrowserRoot({
  children,
  className,
  colorScheme = "light",
  defaultMode = "inline",
  mode: controlledMode,
  onModeChange,
  style,
  variant = "framed",
  ...props
}, forwardedRef) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inlineHeightRef = useRef<number | undefined>(undefined);
  const [localMode, setLocalMode] = useState<BrowserDisplayMode>(defaultMode);
  const mode = controlledMode ?? localMode;

  const setAnchorRef = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const commitMode = useCallback((nextMode: BrowserDisplayMode) => {
    if (controlledMode === undefined) setLocalMode(nextMode);
    onModeChange?.(nextMode);
  }, [controlledMode, onModeChange]);

  const setMode = useCallback((nextMode: BrowserDisplayMode) => {
    if (nextMode !== mode) commitMode(nextMode);
  }, [commitMode, mode]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || mode !== "inline") return;
    const updateHeight = () => { inlineHeightRef.current = frame.getBoundingClientRect().height; };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    if (mode !== "fullscreen") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mode]);

  const retainedHeight = mode === "inline" ? undefined : inlineHeightRef.current;
  const rootStyle = retainedHeight === undefined
    ? style
    : ({ ...style, minHeight: retainedHeight } as CSSProperties);
  const frameModeClass = mode === "picture-in-picture"
    ? "bui-browser-frame--pip"
    : mode === "fullscreen" ? "bui-browser-frame--fullscreen" : "";

  return <MotionConfig reducedMotion="user" transition={layoutTransition}>
    <BrowserRootContext.Provider value={{ mode, setMode }}>
      <section
        {...props}
        ref={setAnchorRef}
        className={["bui-browser", `bui-browser--${variant}`, className].filter(Boolean).join(" ")}
        data-color-scheme={colorScheme}
        style={rootStyle}
      >
        <motion.div
          ref={frameRef}
          layout
          layoutRoot={mode !== "inline"}
          transition={{ layout: layoutTransition }}
          className={["bui-browser-frame", frameModeClass].filter(Boolean).join(" ")}
          data-mode={mode}
          style={{ borderRadius: mode === "fullscreen" ? 0 : variant === "framed" ? 13 : 0 }}
        >
          <motion.span aria-hidden="true" className="bui-browser-frame-decoration" layout="position" />
          {children}
        </motion.div>
      </section>
    </BrowserRootContext.Provider>
  </MotionConfig>;
});

function PictureInPictureIcon({ active }: { active: boolean }) {
  return active
    ? <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1.3" /><path d="m10.5 6-5 5m0-3v3h3" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" /><rect x="8" y="7" width="4" height="3.5" rx=".5" /></svg>;
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active
    ? <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 2v4H2m12 0h-4V2M6 14v-4H2m12 0h-4v4" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 2H2v4m8-4h4v4M6 14H2v-4m8 4h4v-4" /></svg>;
}

export type BrowserDisplayControlsProps = HTMLMotionProps<"div">;

export function BrowserDisplayControls({ className, ...props }: BrowserDisplayControlsProps) {
  return <motion.div {...props} layout="position" className={["bui-display-controls", className].filter(Boolean).join(" ")} />;
}

export interface BrowserPictureInPictureTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  openLabel?: string;
  returnLabel?: string;
}

export function BrowserPictureInPictureTrigger({
  className,
  onClick,
  openLabel = "Open browser picture in picture",
  returnLabel = "Return browser to page",
  ...props
}: BrowserPictureInPictureTriggerProps) {
  const { mode, setMode } = useBrowserRoot();
  const active = mode === "picture-in-picture";
  const label = active ? returnLabel : openLabel;
  return <button
    {...props}
    type="button"
    className={["bui-display-trigger", "bui-pip-toggle", className].filter(Boolean).join(" ")}
    aria-label={props["aria-label"] ?? label}
    title={props.title ?? label}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) setMode(active ? "inline" : "picture-in-picture");
    }}
  ><PictureInPictureIcon active={active} /></button>;
}

export interface BrowserFullscreenTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  enterLabel?: string;
  exitLabel?: string;
}

export function BrowserFullscreenTrigger({
  className,
  enterLabel = "Open browser full screen",
  exitLabel = "Exit browser full screen",
  onClick,
  ...props
}: BrowserFullscreenTriggerProps) {
  const { mode, setMode } = useBrowserRoot();
  const active = mode === "fullscreen";
  const label = active ? exitLabel : enterLabel;
  return <button
    {...props}
    type="button"
    className={["bui-display-trigger", "bui-fullscreen-toggle", className].filter(Boolean).join(" ")}
    aria-label={props["aria-label"] ?? label}
    title={props.title ?? label}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) setMode(active ? "inline" : "fullscreen");
    }}
  ><FullscreenIcon active={active} /></button>;
}
