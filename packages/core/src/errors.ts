export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "INTEGRATION_UNAVAILABLE"
  | "INTEGRATION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "INTERNAL";

const HTTP: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTEGRATION_UNAVAILABLE: 503,
  INTEGRATION_FAILED: 502,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  INTERNAL: 500,
};

/**
 * Application error with a stable code. `messageKey` is an i18n key under `errors.*`; `message` is an
 * English developer message (never shown with secrets).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, opts: { key?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.messageKey = opts.key ?? code.toLowerCase();
    this.details = opts.details;
  }
  get status(): number {
    return HTTP[this.code];
  }
  toJSON() {
    return { code: this.code, key: this.messageKey, message: this.message, details: this.details };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Helpers accept an optional `key` inside details to set a specific i18n message key. */
function split(details?: Record<string, unknown>): { key?: string; details?: Record<string, unknown> } {
  if (!details) return {};
  const { key, ...rest } = details;
  return { key: typeof key === "string" ? key : undefined, details: Object.keys(rest).length ? rest : undefined };
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`, { key: "not_found" });
export const forbidden = (why = "Forbidden") => new AppError("FORBIDDEN", why, { key: "forbidden" });
export const invalidState = (msg: string, details?: Record<string, unknown>) => {
  const s = split(details);
  return new AppError("INVALID_STATE", msg, { key: s.key ?? "invalid_state", details: s.details });
};
export const conflict = (msg: string, details?: Record<string, unknown>) => {
  const s = split(details);
  return new AppError("CONFLICT", msg, { key: s.key ?? "conflict", details: s.details });
};
export const validation = (msg: string, details?: Record<string, unknown>) => {
  const s = split(details);
  return new AppError("VALIDATION", msg, { key: s.key ?? "validation", details: s.details });
};
