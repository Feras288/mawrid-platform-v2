import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

export const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3100"),
  BRAND_NAME_AR: z.string().default("مَوْرِد"),
  BRAND_NAME_EN: z.string().default("Mawrid"),
  // Database: runtime connects as non-owner app role (RLS enforced).
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: optionalStr,
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().default("redis://localhost:6390"),
  // Auth
  AUTH_SECRET: z.string().min(32),
  APP_ENCRYPTION_KEY: z.string().min(32),
  // Storage
  S3_ENDPOINT: optionalStr,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("platform-private"),
  S3_ACCESS_KEY: optionalStr,
  S3_SECRET_KEY: optionalStr,
  S3_FORCE_PATH_STYLE: bool,
  // Email
  SMTP_HOST: optionalStr,
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: optionalStr,
  SMTP_PASS: optionalStr,
  SMTP_FROM: optionalStr,
  SMTP_SECURE: bool,
  // AI
  AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: optionalStr,
  AI_MODEL_EXTRACTION: z.string().default("claude-opus-5-5"),
  AI_MODEL_FAST: z.string().default("claude-haiku-5-5"),
  // Payments
  PAYMENT_PROVIDER: z.enum(["test", "moyasar", "none"]).default("none"),
  MOYASAR_SECRET_KEY: optionalStr,
  MOYASAR_PUBLISHABLE_KEY: optionalStr,
  MOYASAR_WEBHOOK_SECRET: optionalStr,
  TEST_PAYMENT_WEBHOOK_SECRET: optionalStr,
  // Observability
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SENTRY_DSN: optionalStr,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  if (env.APP_ENV === "production") {
    if (env.PAYMENT_PROVIDER === "test") throw new Error("Test payment provider is not allowed in production");
    if (env.AUTH_SECRET.includes("dev") || env.APP_ENCRYPTION_KEY.includes("dev")) {
      throw new Error("Development secrets are not allowed in production");
    }
  }
  return env;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** For tests only. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const isProduction = () => env().APP_ENV === "production";
export const isNonProd = () => env().APP_ENV === "development" || env().APP_ENV === "test";
