import type {
  ShopPlan,
  ShopPlanItem,
  ShopProgressEvent,
  ShopSlot,
  ShopVerification,
} from "./events";

export interface PlanState {
  items: ShopPlanItem[];
  recipe: string | null;
  source: string | null;
  added: number;
  failed: number;
  total: number;
  cartCleared: boolean | null;
  verification: ShopVerification | null;
  slot: ShopSlot | null;
}

/**
 * Fold the ordered progress log into the current plan and each item's latest
 * state. Pure, so the same result comes from a live stream or a replayed log.
 */
export function derivePlan(events: ShopProgressEvent[]): PlanState {
  let plan: ShopPlan | null = null;
  let cartCleared: boolean | null = null;
  let verification: ShopVerification | null = null;
  let slot: ShopSlot | null = null;

  for (const event of events) {
    if (event.cart) cartCleared = event.cart.cleared;
    if (event.verification) verification = event.verification;
    if (event.slot) slot = event.slot;
    if (event.kind === "plan" && event.plan) {
      // A second plan event is a top-up, not a reset: keep the status of items
      // already added, and append the new ones.
      const priorItems: ShopPlanItem[] = plan ? [...plan.items] : [];
      const priorByConcept = new Map<string, ShopPlanItem>();
      for (const existing of priorItems)
        priorByConcept.set(existing.concept, existing);
      plan = {
        ...event.plan,
        items: event.plan.items.map((item) => {
          const prior: ShopPlanItem | undefined = priorByConcept.get(
            item.concept,
          );
          return prior
            ? {
                ...item,
                status: prior.status,
                ...(prior.chosen ? { chosen: prior.chosen } : {}),
              }
            : { ...item };
        }),
      };
      continue;
    }
    if (event.kind === "item" && event.item && plan) {
      const index = event.index
        ? event.index - 1
        : plan.items.findIndex((item) => item.concept === event.item?.concept);
      const current = plan.items[index];
      if (index >= 0 && current) {
        // An item update carries only what changed; keep the plan's quantity/via.
        plan.items[index] = {
          ...current,
          ...event.item,
          quantity: event.item.quantity ?? current.quantity,
          via: event.item.via || current.via,
          status: event.item.status,
        };
      }
    }
  }

  const items = plan?.items ?? [];
  return {
    items,
    recipe: plan?.recipe ?? null,
    source: plan?.source ?? null,
    added: items.filter((item) => item.status === "added").length,
    failed: items.filter((item) => item.status === "failed").length,
    total: items.length,
    cartCleared,
    verification,
    slot,
  };
}
