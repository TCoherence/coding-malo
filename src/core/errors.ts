/**
 * Error kinds mirror oh-my-agent's AgentResponse.error_kind exactly, so the Python
 * adapter can trust OMCB's classification without re-deriving it.
 */
export type ErrorKind =
  | "max_turns"
  | "timeout"
  | "rate_limit"
  | "api_5xx"
  | "auth"
  | "cli_error";

export class OmcbError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OmcbError";
    this.kind = kind;
  }
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === "number") return anyErr.status;
  const response = anyErr.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Ensure the human-readable message still CONTAINS a substring oh-my-agent's
 * `classify_cli_error_kind` recognises, even though we also set error_kind. Belt and braces.
 */
function ensureMarker(message: string, status: number, marker: string): string {
  const lower = message.toLowerCase();
  const hasStatus = lower.includes(String(status));
  const hasMarker = lower.includes(marker);
  if (hasStatus && hasMarker) return message;
  return `${status} ${marker}: ${message}`;
}

/** Map any thrown provider/HTTP error onto an ErrorKind + a classifiable message. */
export function classifyApiError(err: unknown): { kind: ErrorKind; message: string } {
  if (err instanceof OmcbError) return { kind: err.kind, message: err.message };

  const status = extractStatus(err);
  const raw = errMessage(err);
  const lower = raw.toLowerCase();

  // The HTTP status is authoritative when present — a 5xx body can literally contain the words
  // "rate limit", so message-pattern matching must only be a fallback for status-less errors.
  if (status !== undefined) {
    if (status === 429) return { kind: "rate_limit", message: ensureMarker(raw, 429, "rate limit") };
    if (status === 401 || status === 403) return { kind: "auth", message: ensureMarker(raw, status, "unauthorized") };
    if (status >= 500 && status <= 599) return { kind: "api_5xx", message: ensureMarker(raw, status, "server error") };
    if (status >= 400) return { kind: "cli_error", message: ensureMarker(raw, status, "client error") };
  }

  if (/unauthorized|invalid api key|invalid x-api-key|authentication|not authenticated/.test(lower)) {
    return { kind: "auth", message: ensureMarker(raw, 401, "unauthorized") };
  }
  if (/rate.?limit|too many requests|quota|overloaded/.test(lower)) {
    return { kind: "rate_limit", message: ensureMarker(raw, 429, "rate limit") };
  }
  if (/internal server error|bad gateway|service unavailable|gateway timeout|\b50[0-9]\b/.test(lower)) {
    return { kind: "api_5xx", message: ensureMarker(raw, 500, "server error") };
  }
  if (/timed out|timeout|etimedout|aborted|abort/.test(lower)) {
    return { kind: "timeout", message: raw };
  }
  return { kind: "cli_error", message: raw };
}
