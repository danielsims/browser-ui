"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { motion, type HTMLMotionProps } from "motion/react";

export type BrowserDisplayMode = "inline" | "picture-in-picture" | "fullscreen";

interface BrowserDisplayContextValue {
  mode: BrowserDisplayMode;
  setMode: (mode: BrowserDisplayMode) => void;
}

const BrowserDisplayContext = createContext<BrowserDisplayContextValue | null>(null);

interface BrowserDisplayProviderProps extends BrowserDisplayContextValue {
  children: ReactNode;
}

export function BrowserDisplayProvider({ children, mode, setMode }: BrowserDisplayProviderProps) {
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <BrowserDisplayContext.Provider value={value}>
    {children}
  </BrowserDisplayContext.Provider>;
}

function useBrowserDisplay() {
  const context = useContext(BrowserDisplayContext);
  if (!context) throw new Error("Browser display controls must be rendered inside BrowserRoot.");
  return context;
}

function PictureInPictureIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <rect x="8" y="7" width="4" height="3.5" rx=".5" />
  </svg>;
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active
    ? <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M6 2v4H2m12 0h-4V2M6 14v-4H2m12 0h-4v4" />
    </svg>
    : <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M6 2H2v4m8-4h4v4M6 14H2v-4m8 4h4v-4" />
    </svg>;
}

export type BrowserDisplayControlsProps = HTMLMotionProps<"div">;

export function BrowserDisplayControls({ className, ...props }: BrowserDisplayControlsProps) {
  return <motion.div
    {...props}
    className={["bui-display-controls", className].filter(Boolean).join(" ")}
  />;
}

export type BrowserDisplayTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Generic action rendered in Browser UI's package-owned display-control rail. */
export const BrowserDisplayTrigger = forwardRef<HTMLButtonElement, BrowserDisplayTriggerProps>(function BrowserDisplayTrigger({
  className,
  type = "button",
  ...props
}, forwardedRef) {
  return <button
    {...props}
    ref={forwardedRef}
    type={type}
    className={["bui-display-trigger", className].filter(Boolean).join(" ")}
  />;
});

export interface BrowserPictureInPictureTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  openLabel?: string;
  returnLabel?: string;
}

export const BrowserPictureInPictureTrigger = forwardRef<HTMLButtonElement, BrowserPictureInPictureTriggerProps>(function BrowserPictureInPictureTrigger({
  className,
  onClick,
  openLabel = "Open browser picture in picture",
  returnLabel = "Return browser to page",
  ...props
}, forwardedRef) {
  const { mode, setMode } = useBrowserDisplay();
  const active = mode === "picture-in-picture";
  const label = active ? returnLabel : openLabel;

  return <BrowserDisplayTrigger
    {...props}
    ref={forwardedRef}
    className={["bui-pip-toggle", className].filter(Boolean).join(" ")}
    aria-label={props["aria-label"] ?? label}
    title={props.title ?? label}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) setMode(active ? "inline" : "picture-in-picture");
    }}
  >
    <PictureInPictureIcon />
  </BrowserDisplayTrigger>;
});

export interface BrowserFullscreenTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  enterLabel?: string;
  exitLabel?: string;
}

export const BrowserFullscreenTrigger = forwardRef<HTMLButtonElement, BrowserFullscreenTriggerProps>(function BrowserFullscreenTrigger({
  className,
  enterLabel = "Open browser full screen",
  exitLabel = "Exit browser full screen",
  onClick,
  ...props
}, forwardedRef) {
  const { mode, setMode } = useBrowserDisplay();
  const active = mode === "fullscreen";
  const label = active ? exitLabel : enterLabel;

  return <BrowserDisplayTrigger
    {...props}
    ref={forwardedRef}
    className={["bui-fullscreen-toggle", className].filter(Boolean).join(" ")}
    aria-label={props["aria-label"] ?? label}
    title={props.title ?? label}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) setMode(active ? "inline" : "fullscreen");
    }}
  >
    <FullscreenIcon active={active} />
  </BrowserDisplayTrigger>;
});
