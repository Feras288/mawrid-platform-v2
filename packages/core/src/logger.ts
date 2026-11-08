import pino from "pino";

const REDACT = [
  "password",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "*.SMTP_PASS",
  "*.smtpPass",
  "*.cardNumber",
  "*.cvc",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.APP_ENV === "test" ? "warn" : "info"),
  base: { service: process.env.SERVICE_NAME ?? "platform" },
  redact: { paths: REDACT, censor: "[REDACTED]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
export const childLogger = (bindings: Record<string, unknown>) => logger.child(bindings);
