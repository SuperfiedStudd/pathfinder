import { describe, expect, it } from "vitest";
import { classifyModelError } from "../server/model-errors";

describe("safe model diagnostics", () => {
  it.each([
    [402, "MODEL_BILLING_ERROR", 502],
    [429, "MODEL_RATE_LIMIT", 429],
    [401, "MODEL_AUTH_ERROR", 502],
    [403, "MODEL_AUTH_ERROR", 502],
    [404, "MODEL_NOT_FOUND", 502],
    [400, "MODEL_REQUEST_ERROR", 502],
    [500, "MODEL_UPSTREAM_ERROR", 502],
    [503, "MODEL_UPSTREAM_ERROR", 502],
  ])("classifies SDK status %s without leaking provider content", (status, code, httpStatus) => {
    const failure = classifyModelError(Object.assign(new Error("SECRET transcript and credentials"), {
      status, request: { apiKey: "SECRET" }, response: { body: "SECRET" },
    }));
    expect(failure).toMatchObject({ code, httpStatus, providerStatus: status });
    expect(JSON.stringify(failure)).not.toContain("SECRET");
  });

  it("supports the SDK statusCode field", () => {
    expect(classifyModelError({ statusCode: 402 }).code).toBe("MODEL_BILLING_ERROR");
  });

  it("distinguishes local JSON parsing errors from upstream errors", () => {
    expect(classifyModelError(new SyntaxError("SECRET response")).code).toBe("MODEL_PARSE_ERROR");
  });

  it("recognizes connection failures without forwarding their details", () => {
    const err = Object.assign(new TypeError("fetch failed with SECRET"), { cause: { code: "ECONNRESET" } });
    expect(classifyModelError(err).code).toBe("MODEL_NETWORK_ERROR");
    expect(JSON.stringify(classifyModelError(err))).not.toContain("SECRET");
    expect(classifyModelError({ name: "APIConnectionTimeoutError" }).code).toBe("MODEL_NETWORK_ERROR");
  });

  it("does not infer status from untrusted error messages or serialize unknown errors", () => {
    for (const err of [null, "SECRET 429", new Error("SECRET 503"), { status: "SECRET", statusCode: 999 }]) {
      expect(classifyModelError(err).code).toBe("MODEL_UNKNOWN_ERROR");
      expect(JSON.stringify(classifyModelError(err))).not.toContain("SECRET");
    }
  });
});
