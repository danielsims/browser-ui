"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext } from "react";

import type {
  BrowserControlState,
  BrowserPrincipal,
  BrowserSessionAccess,
  BrowserSessionPolicy,
  BrowserSessionVisibility,
} from "@browser-ui/core";
import { browserControlState } from "@browser-ui/core";

interface BrowserAccessContextValue {
  access: BrowserSessionAccess;
  controlState: BrowserControlState;
  onReleaseControl?: () => void;
  onRequestControl?: () => void;
}

const BrowserAccessContext = createContext<BrowserAccessContextValue | null>(
  null,
);
const BrowserPolicyContext = createContext<{
  policy: BrowserSessionPolicy;
  setPolicy: (policy: BrowserSessionPolicy) => void;
} | null>(null);

export interface BrowserAccessRootProps extends HTMLAttributes<HTMLDivElement> {
  access: BrowserSessionAccess;
  controlState?: BrowserControlState;
  onReleaseControl?: () => void;
  onRequestControl?: () => void;
}

/**
 * Headless access-control projection for browser session chrome.
 * The stream gateway must enforce the same state for every input message.
 */
export function BrowserAccessRoot({
  access,
  children,
  controlState = browserControlState(access),
  onReleaseControl,
  onRequestControl,
  ...props
}: BrowserAccessRootProps) {
  return (
    <BrowserAccessContext.Provider
      value={{
        access,
        controlState,
        onReleaseControl,
        onRequestControl,
      }}
    >
      <div
        {...props}
        data-browser-sensitive={access.sensitive ? "true" : undefined}
        data-browser-visibility={access.visibility}
        data-control-state={controlState}
      >
        {children}
      </div>
    </BrowserAccessContext.Provider>
  );
}

export function useBrowserAccess(): BrowserAccessContextValue {
  const value = useContext(BrowserAccessContext);
  if (!value)
    throw new Error(
      "Browser access primitives must be inside BrowserAccessRoot.",
    );
  return value;
}

export interface BrowserControlTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  labels?: Partial<Record<BrowserControlState, string>>;
}

const defaultControlLabels: Record<BrowserControlState, string> = {
  unavailable: "View only",
  available: "Request control",
  requesting: "Requesting control",
  controlling: "Release control",
  "controlled-by-other": "Request control",
};

/** Headless control-lease action with stable state data attributes. */
export function BrowserControlTrigger({
  children,
  disabled,
  labels,
  onClick,
  type = "button",
  ...props
}: BrowserControlTriggerProps) {
  const context = useBrowserAccess();
  const state = context.controlState;
  const unavailable = state === "unavailable" || state === "requesting";
  return (
    <button
      {...props}
      type={type}
      data-control-state={state}
      disabled={disabled ? true : unavailable}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (state === "controlling") context.onReleaseControl?.();
        else context.onRequestControl?.();
      }}
    >
      {children ?? labels?.[state] ?? defaultControlLabels[state]}
    </button>
  );
}

export interface BrowserControlStatusProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
}

/** Announces who currently holds the server-issued control lease. */
export function BrowserControlStatus({
  children,
  ...props
}: BrowserControlStatusProps) {
  const { access, controlState } = useBrowserAccess();
  const controller = access.controller;
  const copy =
    controlState === "controlling"
      ? "You have control"
      : controller
        ? `${controller.displayName} has control`
        : "No one has control";
  return (
    <span {...props} data-control-state={controlState}>
      {children ?? copy}
    </span>
  );
}

export interface BrowserObserverListProps extends HTMLAttributes<HTMLUListElement> {
  renderObserver?: (observer: BrowserPrincipal) => ReactNode;
}

/** Optional observer projection. Membership remains a host concern. */
export function BrowserObserverList({
  renderObserver,
  ...props
}: BrowserObserverListProps) {
  const { access } = useBrowserAccess();
  return (
    <ul {...props} data-observer-count={access.observers?.length ?? 0}>
      {access.observers?.map((observer) => (
        <li key={observer.id}>
          {renderObserver?.(observer) ?? observer.displayName}
        </li>
      ))}
    </ul>
  );
}

export interface BrowserPolicyRootProps extends HTMLAttributes<HTMLDivElement> {
  policy: BrowserSessionPolicy;
  onPolicyChange: (policy: BrowserSessionPolicy) => void;
}

/** Headless policy editor root for observation and control audiences. */
export function BrowserPolicyRoot({
  children,
  policy,
  onPolicyChange,
  ...props
}: BrowserPolicyRootProps) {
  return (
    <BrowserPolicyContext.Provider
      value={{ policy, setPolicy: onPolicyChange }}
    >
      <div
        {...props}
        data-control-scope={policy.control.scope}
        data-observe-scope={policy.observe.scope}
      >
        {children}
      </div>
    </BrowserPolicyContext.Provider>
  );
}

export interface BrowserAudienceOptionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  audience: "observe" | "control";
  scope: BrowserSessionVisibility;
}

/** Selects owner-only, channel, or explicit access for one audience. */
export function BrowserAudienceOption({
  audience,
  children,
  onClick,
  scope,
  type = "button",
  ...props
}: BrowserAudienceOptionProps) {
  const context = useBrowserPolicy();
  const selected = context.policy[audience].scope === scope;
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      data-audience={audience}
      data-scope={scope}
      data-selected={selected ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        context.setPolicy({
          ...context.policy,
          [audience]: {
            scope,
            ...(scope === "explicit"
              ? { principalIds: context.policy[audience].principalIds ?? [] }
              : {}),
          },
        });
      }}
    >
      {children ?? scope}
    </button>
  );
}

export interface BrowserPrincipalGrantTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  audience: "observe" | "control";
  principalId: string;
}

/** Adds or removes one host-authenticated principal from an explicit audience. */
export function BrowserPrincipalGrantTrigger({
  audience,
  children,
  onClick,
  principalId,
  type = "button",
  ...props
}: BrowserPrincipalGrantTriggerProps) {
  const context = useBrowserPolicy();
  const ids = context.policy[audience].principalIds ?? [];
  const selected = ids.includes(principalId);
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      data-audience={audience}
      data-principal-id={principalId}
      data-selected={selected ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const principalIds = selected
          ? ids.filter((id) => id !== principalId)
          : [...ids, principalId];
        context.setPolicy({
          ...context.policy,
          [audience]: { scope: "explicit", principalIds },
        });
      }}
    >
      {children ?? principalId}
    </button>
  );
}

function useBrowserPolicy() {
  const value = useContext(BrowserPolicyContext);
  if (!value)
    throw new Error(
      "Browser policy primitives must be inside BrowserPolicyRoot.",
    );
  return value;
}
