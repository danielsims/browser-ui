/**
 * Shared session shapes. Deliberately free of server-only imports so the client
 * can render progress without pulling `node:child_process` into the bundle.
 */

export type ShopPhase =
  "idle" | "starting" | "planning" | "shopping" | "done" | "error" | "human";

export type ShopProgressKind =
  "info" | "plan" | "item" | "search" | "add" | "done" | "error" | "ready";

export type ShopItemStatus = "pending" | "adding" | "added" | "failed";

export interface ShopPlanItem {
  concept: string;
  quantity: number | string | null;
  via: string;
  status: ShopItemStatus;
  chosen?: string | null;
  note?: string | null;
  gate?: string | null;
  confidence?: number | null;
}

export interface ShopPlan {
  recipe: string | null;
  source: string;
  items: ShopPlanItem[];
}

export interface ShopCart {
  count: number;
  cleared: boolean;
}

export interface ShopVerificationItem {
  product: string;
  quantity: number;
  ok: number;
}

export interface ShopVerification {
  items: ShopVerificationItem[];
  overall: number;
}

export interface ShopSlot {
  method: string;
  date: string;
  slot: string;
  price: number;
  asap?: boolean;
}

export interface ShopProgressEvent {
  seq: number;
  kind: ShopProgressKind;
  label: string;
  detail?: string;
  at: number;
  plan?: ShopPlan;
  item?: ShopPlanItem;
  cart?: ShopCart;
  verification?: ShopVerification;
  slot?: ShopSlot;
  index?: number;
  total?: number;
}

export interface ShopViewport {
  width: number;
  height: number;
}

export interface ShopSessionSnapshot {
  id: string;
  recipe: string;
  phase: ShopPhase;
  viewport: ShopViewport;
  streamUrl: string | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  events: ShopProgressEvent[];
}

// The stream carries CSS pixels and cannot be told to render at a higher device
// ratio, so we shoot wider and let the UI scale down — downscaling is sharp,
// upscaling is not.
export const shopViewport: ShopViewport = { width: 1920, height: 1200 };
