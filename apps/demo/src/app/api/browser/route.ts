import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { workflows, type DemoWorkflow, type WorkflowStep } from "../../../workflows";

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();
type Subscriber = ReadableStreamDefaultController<Uint8Array>;
type WorkflowEvent = Record<string, unknown> & { type: string };
interface DemoRuntime { generation: number; subscribers: Set<Subscriber>; abortController?: AbortController }

const runtimeGlobal = globalThis as typeof globalThis & { __browserUiDemoRuntime?: DemoRuntime };
const runtime = runtimeGlobal.__browserUiDemoRuntime ??= { generation: 0, subscribers: new Set() };

function publish(event: WorkflowEvent) {
  const payload = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const subscriber of runtime.subscribers) {
    try { subscriber.enqueue(payload); }
    catch { runtime.subscribers.delete(subscriber); }
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function command<T extends Record<string, unknown> = Record<string, unknown>>(args: string[], timeout = 30_000) {
  const entry = process.env.AGENT_BROWSER_ENTRY;
  const sessionId = process.env.AGENT_BROWSER_SESSION_ID;
  const downloadPath = process.env.AGENT_BROWSER_DOWNLOAD_PATH;
  if (!entry || !sessionId || !downloadPath) throw new Error("The live demo browser is available through `pnpm dev` only.");
  const { stdout } = await execFileAsync(process.execPath, [
    entry,
    "--session", sessionId,
    "--json",
    "--download-path", downloadPath,
    ...args,
  ], { timeout, maxBuffer: 10 * 1024 * 1024, signal: runtime.abortController?.signal });
  const envelope = JSON.parse(stdout.trim()) as { success?: boolean; data?: T; error?: string };
  if (envelope.success === false) throw new Error(envelope.error ?? "agent-browser command failed");
  return (envelope.data ?? {}) as T;
}

function assertActive(generation: number) {
  if (generation !== runtime.generation) throw new DOMException("Workflow cancelled", "AbortError");
}

async function moveCursor(workflow: DemoWorkflow, selector: string, generation: number, typing = false) {
  assertActive(generation);
  const box = await command<{ x: number; y: number; width: number; height: number }>(["get", "box", selector]);
  const viewportState = await command<{ result: { width: number; height: number } }>(["eval", "({ width: window.innerWidth, height: window.innerHeight })"]);
  const viewport = viewportState.result;
  publish({
    type: "cursor",
    workflowId: workflow.id,
    cursor: {
      x: Math.max(0, Math.min(1, (box.x + box.width / 2) / viewport.width)),
      y: Math.max(0, Math.min(1, (box.y + box.height / 2) / viewport.height)),
      pressed: false,
      typing,
      variant: "dark",
      visible: true,
    },
  });
  await wait(780);
  assertActive(generation);
}

function setCursorPressed(workflow: DemoWorkflow, pressed: boolean, typing = false) {
  publish({ type: "cursor-state", workflowId: workflow.id, pressed, typing });
}

async function scrollTarget(selector: string, generation: number, always = false) {
  const source = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Target not found");
    const bounds = element.getBoundingClientRect();
    const outsideViewport = bounds.top < 72 || bounds.bottom > window.innerHeight - 72;
    if (${always} || outsideViewport) element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    return outsideViewport;
  })()`;
  await command(["eval", source]);
  await wait(always ? 720 : 560);
  assertActive(generation);
}

async function waitForSelector(selector: string, generation: number, timeout: number) {
  const deadline = Date.now() + timeout;
  const source = `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
  while (Date.now() < deadline) {
    assertActive(generation);
    const state = await command<{ result: boolean }>(["eval", source]);
    if (state.result) return;
    await wait(650);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function indexedSelector(selector: string, index: number, generation: number) {
  const marker = `browser-ui-${generation}-${index}`;
  const source = `(() => {
    document.querySelectorAll("[data-browser-ui-target]").forEach((element) => element.removeAttribute("data-browser-ui-target"));
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!element) throw new Error("Indexed target not found");
    element.setAttribute("data-browser-ui-target", ${JSON.stringify(marker)});
    return true;
  })()`;
  await command(["eval", source]);
  return `[data-browser-ui-target=${JSON.stringify(marker)}]`;
}

async function textSelector(role: string, text: string, generation: number) {
  const marker = `browser-ui-${generation}-text`;
  const source = `(() => {
    document.querySelectorAll("[data-browser-ui-target]").forEach((element) => element.removeAttribute("data-browser-ui-target"));
    const normalize = (value) => value.replace(/\\s+/g, " ").trim();
    const element = Array.from(document.querySelectorAll(${JSON.stringify(`[role="${role}"]`)}))
      .find((candidate) => normalize(candidate.textContent || "").includes(${JSON.stringify(text)}));
    if (!element) throw new Error("Text target not found");
    element.setAttribute("data-browser-ui-target", ${JSON.stringify(marker)});
    return true;
  })()`;
  await command(["eval", source]);
  return `[data-browser-ui-target=${JSON.stringify(marker)}]`;
}

async function clickTarget(workflow: DemoWorkflow, selector: string, generation: number, activation: "pointer" | "programmatic" | "same-tab" = "pointer", index?: number) {
  const resolvedSelector = index === undefined ? selector : await indexedSelector(selector, index, generation);
  await scrollTarget(resolvedSelector, generation);
  await moveCursor(workflow, resolvedSelector, generation);
  setCursorPressed(workflow, true);
  await wait(150);
  assertActive(generation);
  if (activation === "programmatic") {
    await command(["eval", `document.querySelector(${JSON.stringify(resolvedSelector)})?.click(); true`]);
  } else if (activation === "same-tab") {
    await command(["eval", `(() => {
      const element = document.querySelector(${JSON.stringify(resolvedSelector)});
      if (!(element instanceof HTMLAnchorElement) || !element.href) throw new Error("Navigation target not found");
      location.assign(element.href);
      return true;
    })()`]);
  } else {
    await command(["click", resolvedSelector]);
  }
  setCursorPressed(workflow, false);
}

async function selectRelativeDates(workflow: DemoWorkflow, leadDays: number, nights: number, generation: number) {
  const availableCheckIns = await command<{ result: string[] }>(["eval", `Array.from(document.querySelectorAll('button[aria-label*="Available Select as check-in date"]')).map((element) => element.getAttribute("aria-label")).filter(Boolean)`]);
  const checkInLabels = availableCheckIns.result;
  const checkInIndex = Math.min(Math.max(0, leadDays), checkInLabels.length - nights - 1);
  const checkInLabel = checkInLabels[checkInIndex];
  if (!checkInLabel) throw new Error("No future Airbnb check-in date available");
  await clickTarget(workflow, `button[aria-label=${JSON.stringify(checkInLabel)}]`, generation);
  await wait(420);
  assertActive(generation);

  const availableCheckOuts = await command<{ result: string[] }>(["eval", `Array.from(document.querySelectorAll('button[aria-label*="Available Select as checkout date"]')).map((element) => element.getAttribute("aria-label")).filter(Boolean)`]);
  const checkOutLabel = availableCheckOuts.result[Math.max(0, nights - 1)];
  if (!checkOutLabel) throw new Error("No Airbnb checkout date available");
  await clickTarget(workflow, `button[aria-label=${JSON.stringify(checkOutLabel)}]`, generation);
}

async function typeInto(workflow: DemoWorkflow, selector: string, value: string, generation: number) {
  await scrollTarget(selector, generation);
  await moveCursor(workflow, selector, generation, true);
  setCursorPressed(workflow, true, true);
  await wait(100);
  await command(["eval", `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Editable target not found");
    element.focus();
    element.select();
    return true;
  })()`]);
  setCursorPressed(workflow, false, true);
  assertActive(generation);
  await command(["fill", selector, value]);
  await wait(180);
  setCursorPressed(workflow, false, false);
}

async function smoothScroll(workflow: DemoWorkflow, direction: "up" | "down", amount: number, generation: number) {
  publish({ type: "cursor", workflowId: workflow.id, cursor: { x: .91, y: .8, variant: "dark", visible: true } });
  const signedAmount = direction === "down" ? amount : -amount;
  const increments = 7;
  for (let index = 0; index < increments; index += 1) {
    assertActive(generation);
    await command(["mouse", "wheel", String(Math.round(signedAmount / increments))]);
    await wait(80);
  }
}

async function executeStep(workflow: DemoWorkflow, step: WorkflowStep, generation: number) {
  if (step.action === "open") {
    publish({ type: "cursor", workflowId: workflow.id, cursor: { x: .5, y: .48, visible: false } });
    await command(["open", step.url]);
  } else if (step.action === "reset-page") {
    await command(["eval", "localStorage.clear(); sessionStorage.clear(); location.reload(); true"]);
  } else if (step.action === "click") {
    try {
      await clickTarget(workflow, step.selector, generation, step.activation, step.index);
      if (step.waitFor) {
        try { await waitForSelector(step.waitFor, generation, step.waitTimeout ?? 10_000); }
        catch (error) {
          if (!step.fallbackUrl) throw error;
          await command(["open", step.fallbackUrl]);
          await waitForSelector(step.waitFor, generation, 15_000);
        }
      }
    }
    catch (error) { if (!step.optional) throw error; }
  } else if (step.action === "click-text") {
    try {
      const selector = await textSelector(step.role, step.text, generation);
      await clickTarget(workflow, selector, generation);
    }
    catch (error) { if (!step.optional) throw error; }
  } else if (step.action === "select-dates") {
    await selectRelativeDates(workflow, step.leadDays, step.nights, generation);
  } else if (step.action === "type") {
    await typeInto(workflow, step.selector, step.text, generation);
  } else if (step.action === "press") {
    await command(["press", step.key]);
  } else if (step.action === "scroll-into-view") {
    await scrollTarget(step.selector, generation, true);
    await moveCursor(workflow, step.selector, generation);
  } else {
    await smoothScroll(workflow, step.direction, step.amount, generation);
  }
  if (step.wait) await wait(step.wait);
  assertActive(generation);
}

async function runWorkflow(workflowId: string) {
  const workflow = workflows.find((candidate) => candidate.id === workflowId);
  if (!workflow) throw new Error("Unknown demo workflow");
  runtime.abortController?.abort();
  const abortController = new AbortController();
  runtime.abortController = abortController;
  const generation = ++runtime.generation;
  publish({ type: "start", workflowId: workflow.id, total: workflow.steps.length });
  try {
    for (let index = 0; index < workflow.steps.length; index += 1) {
      const step = workflow.steps[index];
      assertActive(generation);
      publish({ type: "step", workflowId: workflow.id, index, total: workflow.steps.length, label: step.label });
      await executeStep(workflow, step, generation);
    }
    publish({ type: "cursor", workflowId: workflow.id, cursor: { x: .5, y: .5, visible: false } });
    publish({ type: "complete", workflowId: workflow.id, outcome: workflow.outcome });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    publish({ type: "error", workflowId: workflow.id, message: error instanceof Error ? error.message : "Workflow failed" });
    throw error;
  } finally {
    if (runtime.abortController === abortController) runtime.abortController = undefined;
  }
}

export async function GET(request: Request) {
  let controller: Subscriber | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (ping) clearInterval(ping);
    if (controller) runtime.subscribers.delete(controller);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
      runtime.subscribers.add(nextController);
      nextController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ready" })}\n\n`));
      ping = setInterval(() => {
        try { nextController.enqueue(encoder.encode(": keepalive\n\n")); }
        catch { cleanup(); }
      }, 15_000);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel: cleanup,
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; workflowId?: string; url?: string; width?: number; height?: number };
    if (body.action === "run-workflow" && body.workflowId) await runWorkflow(body.workflowId);
    else if (body.action === "cancel-workflow") {
      runtime.abortController?.abort();
      runtime.abortController = undefined;
      runtime.generation += 1;
      publish({ type: "cancel" });
    } else if (body.action === "navigate" && body.url) {
      runtime.abortController?.abort();
      runtime.abortController = undefined;
      runtime.generation += 1;
      await command(["open", body.url]);
    } else if (body.action === "reload") {
      runtime.abortController?.abort();
      runtime.abortController = undefined;
      runtime.generation += 1;
      await command(["reload"]);
    } else if (body.action === "resize" && body.width && body.height) {
      await command(["set", "viewport", String(Math.max(320, Math.round(body.width))), String(Math.max(240, Math.round(body.height)))]);
    } else return NextResponse.json({ error: "Unsupported browser command" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Browser command failed" }, { status: 500 });
  }
}
