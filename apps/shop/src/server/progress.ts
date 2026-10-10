import type {
  ShopCart,
  ShopPlan,
  ShopPlanItem,
  ShopProgressKind,
  ShopSlot,
  ShopVerification,
} from "../lib/events";

export interface ParsedLine {
  kind: ShopProgressKind;
  label: string;
  detail?: string;
  plan?: ShopPlan;
  item?: ShopPlanItem;
  cart?: ShopCart;
  verification?: ShopVerification;
  slot?: ShopSlot;
  index?: number;
  total?: number;
}

const itemLine = /^\s*\[(\d+)\/(\d+)\]\s+(.+?)\s+->\s+(.+)$/u;
const successLine = /^\s*[✓√]\s+(.+?)(?:\s{2,}.*)?$/u;
const failureLine = /^\s*[✗x×]\s+(.+)$/u;
const planLine = /^plan\s+\(([^)]+)\):\s*(.+)$/u;
const cartNowLine = /^cart now:\s*(.+)$/u;
const scoreLine = /^score:\s+(.+?)\s+substitutions:\s*(.+)$/u;

/** Parse one of the engine's structured `##MARKER {json}` lines. */
function structured(raw: string): ParsedLine | null {
  if (raw.startsWith("##PLAN ")) {
    const payload = safeJson<{
      recipe?: string | null;
      source?: string;
      items?: Partial<ShopPlanItem>[];
    }>(raw.slice("##PLAN ".length));
    if (!payload?.items) return null;
    const items: ShopPlanItem[] = payload.items.map((item) => ({
      concept: String(item.concept ?? "item"),
      quantity: item.quantity ?? null,
      via: String(item.via ?? "search"),
      status: "pending",
    }));
    return {
      kind: "plan",
      label: `Planned ${items.length} ingredient${items.length === 1 ? "" : "s"}`,
      detail: items.map((item) => item.concept).join(", "),
      plan: {
        recipe: payload.recipe ?? null,
        source: String(payload.source ?? ""),
        items,
      },
    };
  }

  if (raw.startsWith("##ITEM ")) {
    const payload = safeJson<
      Partial<ShopPlanItem> & {
        index?: number;
        total?: number;
        status?: string;
      }
    >(raw.slice("##ITEM ".length));
    if (!payload?.concept) return null;
    const status: ShopPlanItem["status"] =
      payload.status === "added" ||
      payload.status === "failed" ||
      payload.status === "adding"
        ? payload.status
        : "adding";
    const item: ShopPlanItem = {
      concept: String(payload.concept),
      quantity: payload.quantity ?? null,
      via: String(payload.via ?? ""),
      status,
      chosen: payload.chosen ?? null,
      note: payload.note ?? null,
      gate: payload.gate ?? null,
      confidence: payload.confidence ?? null,
    };
    const label =
      status === "adding"
        ? `Finding ${item.concept}`
        : status === "added"
          ? `Added ${item.chosen ?? item.concept}`
          : `Couldn't add ${item.concept}`;
    return {
      kind: "item",
      label,
      item,
      ...(payload.index ? { index: payload.index } : {}),
      ...(payload.total ? { total: payload.total } : {}),
    };
  }

  if (raw.startsWith("##SLOT ")) {
    const payload = safeJson<ShopSlot>(raw.slice("##SLOT ".length));
    if (!payload) return null;
    const price = payload.price === 0 ? "free" : `$${payload.price}`;
    return {
      kind: "info",
      label: `Delivery: ${payload.date} · ${payload.slot} · ${price}`,
      slot: payload,
    };
  }

  if (raw.startsWith("##VERIFY ")) {
    const payload = safeJson<ShopVerification>(raw.slice("##VERIFY ".length));
    if (!payload?.items) return null;
    const short = payload.items.filter((item) => item.ok < 0.5).length;
    return {
      kind: "info",
      label:
        short === 0
          ? "Final check passed"
          : `Final check: ${short} amount${short === 1 ? "" : "s"} look short`,
      verification: payload,
    };
  }

  if (raw.startsWith("##CART ")) {
    const payload = safeJson<{ count?: number; cleared?: boolean }>(
      raw.slice("##CART ".length),
    );
    if (!payload) return null;
    const cleared = payload.cleared === true;
    return {
      kind: cleared ? "info" : "error",
      label: cleared
        ? "Cart cleared"
        : `Cart still has ${payload.count ?? "?"} item(s)`,
      detail: cleared
        ? "Starting from an empty trolley"
        : "Stopping to avoid stacking orders",
      cart: { count: payload.count ?? 0, cleared },
    };
  }

  return null;
}

function safeJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Translate one line of the shop runner's human output into a calm, structured
 * status. Unknown lines return null and are ignored; the runner's stdout is the
 * only progress channel, so this stays deliberately forgiving.
 */
export function parseShopLine(raw: string): ParsedLine | null {
  const line = raw.trimEnd();
  if (!line.trim()) return null;

  if (line.startsWith("#")) {
    if (line.startsWith("##READY"))
      return { kind: "ready", label: "Browser ready" };
    if (line.startsWith("##DONE"))
      return { kind: "done", label: "Shopping complete" };
    return structured(line);
  }

  const item = itemLine.exec(line);
  if (item) {
    const index = item[1];
    const total = item[2];
    const concept = item[3];
    if (index && total && concept) {
      return {
        kind: "search",
        label: `Finding ${concept}`,
        detail: `item ${index} of ${total}`,
      };
    }
  }

  const success = successLine.exec(line);
  if (success?.[1]) return { kind: "add", label: `Added ${success[1]}` };

  const failure = failureLine.exec(line);
  if (failure?.[1])
    return { kind: "error", label: `Could not add ${failure[1]}` };

  if (line.startsWith("request:")) {
    const recipe = line.slice("request:".length).trim();
    return { kind: "info", label: `Shopping for ${recipe}` };
  }

  const plan = planLine.exec(line);
  if (plan) {
    const source = plan[1];
    const list = plan[2];
    if (source && list) {
      const items = list
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        kind: "info",
        label: `Planning ${items.length} ingredient${items.length === 1 ? "" : "s"}`,
        detail: items.join(", "),
      };
    }
  }

  if (line.startsWith("pantry (skipped):")) {
    return { kind: "info", label: "Skipped pantry staples" };
  }

  if (line.startsWith("cart at start:")) {
    return { kind: "info", label: "Checking the cart" };
  }

  const cartNow = cartNowLine.exec(line);
  if (cartNow?.[1]) return { kind: "info", label: `${cartNow[1]} in the cart` };

  const score = scoreLine.exec(line);
  if (score?.[1]) {
    return {
      kind: "done",
      label: "Shopping complete",
      detail: `score ${score[1]}`,
    };
  }

  if (line.startsWith("Nothing to buy")) {
    return { kind: "done", label: "Nothing to buy after the pantry check" };
  }

  return null;
}
