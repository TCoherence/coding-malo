import { OmcbError } from "./errors";

/**
 * A timeout signal that aborts with an OmcbError("timeout", ...) and also aborts if the
 * (optional) parent signal aborts. Call cancel() to clear the timer when the work finishes.
 */
export function timeoutSignal(
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new OmcbError("timeout", `operation timed out after ${ms}ms`));
  }, ms);
  // Node keeps the event loop alive for pending timers; let it not block process exit.
  if (typeof timer.unref === "function") timer.unref();

  const onParentAbort = () => ctrl.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) ctrl.abort(parent.reason);
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** Combine multiple signals into one that aborts when any of them aborts. */
export function linkSignals(...signals: AbortSignal[]): AbortSignal {
  // Node >= 20.3 has AbortSignal.any.
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
