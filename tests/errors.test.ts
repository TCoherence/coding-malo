import { describe, expect, it } from "vitest";

import { classifyApiError, OmcbError } from "../src/core/errors";

describe("classifyApiError", () => {
  it("maps 429 to rate_limit with a classifiable message", () => {
    const out = classifyApiError(Object.assign(new Error("slow down"), { status: 429 }));
    expect(out.kind).toBe("rate_limit");
    expect(out.message.toLowerCase()).toContain("rate limit");
    expect(out.message).toContain("429");
  });

  it("maps 401 to auth", () => {
    expect(classifyApiError(Object.assign(new Error("bad key"), { status: 401 })).kind).toBe("auth");
    expect(classifyApiError(new Error("invalid api key")).kind).toBe("auth");
  });

  it("maps 5xx to api_5xx", () => {
    expect(classifyApiError(Object.assign(new Error("oops"), { status: 503 })).kind).toBe("api_5xx");
    expect(classifyApiError(new Error("502 Bad Gateway")).kind).toBe("api_5xx");
  });

  it("maps abort/timeout text to timeout", () => {
    expect(classifyApiError(new Error("The operation was aborted")).kind).toBe("timeout");
  });

  it("preserves an OmcbError's own kind", () => {
    expect(classifyApiError(new OmcbError("max_turns", "done")).kind).toBe("max_turns");
  });

  it("falls back to cli_error", () => {
    expect(classifyApiError(new Error("something weird")).kind).toBe("cli_error");
  });
});
