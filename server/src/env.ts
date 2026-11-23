import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { serverRoot } from "./paths";

/**
 * Process configuration, validated once at startup. A `.env` file at the
 * repository root is loaded when present (never in production, where the
 * platform sets the variables); values already in the environment win.
 */
const envFile = resolve(serverRoot(), "..", ".env");
if (process.env.NODE_ENV !== "production" && existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // An unreadable .env is the same as no .env.
  }
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === "boolean" ? value : /^(1|true|yes)$/i.test(value)));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value.trim()));

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_TEST: optionalString,
  // The request pool's connection (role mest_request). Required in production;
  // locally it is derived from DATABASE_URL with the user swapped.
  REQUEST_DATABASE_URL: optionalString,
  APP_ORIGIN: z.string().url("APP_ORIGIN must be a URL such as http://127.0.0.1:8787"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().min(1, "EMAIL_FROM is required"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JOBS_ENABLED: bool.default(false),
  TRUST_PROXY: bool.default(false),
  // How many trusted proxies append to X-Forwarded-For (Railway's edge: 1).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
