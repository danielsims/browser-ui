"use client";

import type { FormEvent, FormHTMLAttributes } from "react";

export interface BrowserToolbarProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  value: string;
  onValueChange?: (value: string) => void;
  onNavigate?: (url: string) => void;
  onReload?: () => void;
}

/** Optional address header for hosts that do not already provide navigation. */
export function BrowserToolbar({ className, onNavigate, onReload, onValueChange, value, ...props }: BrowserToolbarProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = value.trim();
    if (next) onNavigate?.(next);
  };
  return <form {...props} className={["bui-toolbar", className].filter(Boolean).join(" ")} onSubmit={submit}>
    <button type="button" aria-label="Reload page" disabled={!onReload} onClick={onReload}>↻</button>
    <div><span aria-hidden="true">●</span><input aria-label="Browser address" value={value} placeholder="Enter URL" onChange={(event) => onValueChange?.(event.target.value)} readOnly={!onValueChange} spellCheck={false} /></div>
    {onNavigate ? <button type="submit" aria-label="Open address">↗</button> : null}
  </form>;
}
