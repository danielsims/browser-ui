"use client";

import type { PlanState } from "../lib/plan";

/** The visible shopping list: what's being bought, and what's been ticked off. */
export function PlanList({ plan }: { plan: PlanState }) {
  if (plan.total === 0) return null;
  const settled = plan.added + plan.failed;
  return (
    <aside className="list" data-settled={settled === plan.total}>
      <header className="list-head">
        <span className="list-title">Your list</span>
        <span className="list-count">
          {plan.added} of {plan.total}
        </span>
      </header>
      {plan.cartCleared === false ? (
        <p className="list-warn">
          Your trolley wasn&rsquo;t empty, so we stopped rather than double up.
        </p>
      ) : null}
      <ul>
        {plan.items.map((item, index) => (
          <li
            key={`${item.concept}-${index}`}
            data-status={item.status}
            style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}
          >
            <span className="list-mark" aria-hidden>
              {item.status === "added"
                ? "✓"
                : item.status === "failed"
                  ? "✕"
                  : ""}
            </span>
            <span className="list-body">
              <span className="list-name">
                {item.concept}
                {item.quantity ? <em> · {item.quantity}</em> : null}
              </span>
              {item.status === "added" && item.chosen ? (
                <span className="list-chosen">{item.chosen}</span>
              ) : null}
              {item.status === "failed" ? (
                <span className="list-note">
                  Couldn&rsquo;t add this one automatically
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {plan.verification && plan.verification.overall >= 0.5 ? (
        <div className="verify">
          <p className="verify-line">You’ve got everything to make this.</p>
        </div>
      ) : null}
      {plan.slot ? (
        <div className="verify">
          <p className="verify-line">
            {plan.slot.method === "direct-to-boot"
              ? "Direct to boot"
              : "Delivery"}
            {plan.slot.date ? ` · ${plan.slot.date}` : ""} · {plan.slot.slot} ·{" "}
            {plan.slot.price === 0 ? "Free" : `$${plan.slot.price}`}
          </p>
        </div>
      ) : null}
    </aside>
  );
}
