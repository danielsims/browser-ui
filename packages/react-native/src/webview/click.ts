/**
 * Click result shapes shared by the driver and its injected scripts.
 *
 * The scripts report plain data; the driver validates it here so a malformed
 * page payload can never masquerade as a successful activation.
 */

/**
 * Why a click ended how it did. `clicked` means the page visibly reacted;
 * `dispatched-but-unconfirmed` means the sequence was sent but nothing changed,
 * so the caller must verify the outcome itself.
 */
export type WebViewBrowserClickStatus =
  | "clicked"
  | "dispatched-but-unconfirmed"
  | "ref-not-found"
  | "element-disabled"
  | "not-visible"
  | "covered";

/** The target a click resolved to, for debugging a failed activation. */
export interface WebViewBrowserClickElement {
  ref: string;
  role: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  excerpt?: string;
}

export interface WebViewBrowserClickResult {
  status: WebViewBrowserClickStatus;
  ref: string;
  element: WebViewBrowserClickElement | null;
  /** Normalised (0..1) point the click acted on. */
  point?: { x: number; y: number };
  /** Events actually dispatched, in order; `!` marks a constructor failure. */
  sequence?: string[];
  message?: string;
}

export interface WebViewBrowserClickOptions {
  /** Wait for and report a visible page change. Defaults to true. */
  confirm?: boolean;
}

/** Internal stage statuses the scripts use before the driver folds them down. */
export type ClickStageStatus = WebViewBrowserClickStatus | "ok" | "dispatched";

/** A click stage plus the pre-dispatch signature used to confirm the effect. */
export interface ClickStage extends Omit<WebViewBrowserClickResult, "status"> {
  status: ClickStageStatus;
  before?: string;
}

const STAGE_STATUSES: readonly ClickStageStatus[] = [
  "ok",
  "dispatched",
  "clicked",
  "dispatched-but-unconfirmed",
  "ref-not-found",
  "element-disabled",
  "not-visible",
  "covered",
];

export function readStageStatus(value: unknown): ClickStageStatus | null {
  return typeof value === "string" &&
    (STAGE_STATUSES as readonly string[]).includes(value)
    ? (value as ClickStageStatus)
    : null;
}

export function readClickElement(
  value: unknown,
): WebViewBrowserClickElement | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const box = record.rect;
  if (
    typeof record.ref !== "string" ||
    typeof record.role !== "string" ||
    typeof record.name !== "string" ||
    box === null ||
    typeof box !== "object"
  ) {
    return null;
  }
  const rect = box as Record<string, unknown>;
  const { x, y, width, height } = rect;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }
  const excerpt =
    typeof record.excerpt === "string" && record.excerpt.length > 0
      ? record.excerpt
      : undefined;
  return {
    ref: record.ref,
    role: record.role,
    name: record.name,
    rect: { x, y, width, height },
    ...(excerpt ? { excerpt } : {}),
  };
}
