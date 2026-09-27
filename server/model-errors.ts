import type { ModelErrorCode } from "../shared/schema";

export interface ModelFailure {
  code: ModelErrorCode;
  error: string;
  httpStatus: number;
  providerStatus?: number;
}

// Never serialize an SDK error: its message, cause, request and response can
// contain credentials or user content. Read only a numeric status and known
// error names/codes, then return fixed messages we control.
export function classifyModelError(err: unknown): ModelFailure {
  const obj = err && typeof err === "object" ? err as Record<string, unknown> : {};
  const status = [obj.status, obj.statusCode].find(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599,
  );
  const failure = (code: ModelErrorCode, error: string, httpStatus = 502): ModelFailure => ({
    code, error, httpStatus, ...(status !== undefined ? { providerStatus: status } : {}),
  });
  if (status === 402) return failure("MODEL_BILLING_ERROR", "Gemini billing requires attention. Ask the project owner to check the API credit balance.");
  if (status === 429) return failure("MODEL_RATE_LIMIT", "The model is rate limited. Wait a few seconds and try again.", 429);
  if (status === 401 || status === 403) return failure("MODEL_AUTH_ERROR", "Gemini access is unavailable. Ask the project owner to check the API configuration.");
  if (status === 404) return failure("MODEL_NOT_FOUND", "The configured Gemini model or endpoint is unavailable.");
  if (status !== undefined && status >= 500) return failure("MODEL_UPSTREAM_ERROR", "Gemini is temporarily unavailable. Try again shortly.");
  if (status !== undefined) return failure("MODEL_REQUEST_ERROR", "Gemini rejected the model request. Ask the project owner to check the configuration.");
  if (err instanceof SyntaxError) return failure("MODEL_PARSE_ERROR", "Gemini returned a response Pathfinder could not read. Try again.");
  const cause = obj.cause && typeof obj.cause === "object" ? obj.cause as Record<string, unknown> : {};
  const networkCodes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"];
  if (["APIConnectionError", "APIConnectionTimeoutError", "AbortError", "TimeoutError"].includes(String(obj.name)) ||
      networkCodes.includes(String(obj.code)) || networkCodes.includes(String(cause.code))) {
    return failure("MODEL_NETWORK_ERROR", "Pathfinder could not reach Gemini. Check the connection and try again.");
  }
  return failure("MODEL_UNKNOWN_ERROR", "The model call failed. Try again or ask the project owner to check the server diagnostics.");
}
