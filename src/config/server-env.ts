import { z } from "zod";

const optionalBase64Key = z.string().refine(
  (value) => {
    if (!value) return true;
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "must be a base64-encoded 32-byte key" },
);

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const environmentBoolean = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
    APP_DOMAIN: z.string().default("localhost:3000"),
    AUTH_MODE: z.enum(["disabled", "local", "clerk"]).default("local"),
    LOCAL_AUTH_SUBJECT: z.string().min(3).max(128).default("local_developer"),
    DATABASE_URL: z.string().min(1).optional(),
    RUNTIME_DATABASE_URL: z.string().min(1).optional(),
    MAINTENANCE_DATABASE_URL: z.string().min(1).optional(),
    ROTATION_DATABASE_URL: z.string().min(1).optional(),
    LOOKUP_ROTATION_DATABASE_URL: z.string().min(1).optional(),
    DELIVERY_DATABASE_URL: z.string().min(1).optional(),
    TRUSTED_CLIENT_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .transform((value) => value.toLowerCase())
      .optional(),
    ENCRYPTION_KEY_ID: z.string().min(1).max(64),
    ENCRYPTION_KEY: optionalBase64Key,
    LOOKUP_KEY: optionalBase64Key,
    LOOKUP_KEY_ID: z.string().min(1).max(64),
    PREVIOUS_LOOKUP_KEY_ID: z.string().min(1).max(64).optional(),
    PREVIOUS_LOOKUP_KEY: optionalBase64Key.optional(),
    DELIVERY_ENCRYPTION_KEY_ID: z.string().min(1).max(64).optional(),
    DELIVERY_ENCRYPTION_KEY: optionalBase64Key.optional(),
    LOCAL_VERIFICATION_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .default("000000"),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    BREACH_PROVIDER: z.enum(["disabled", "synthetic"]).default("disabled"),
    BREACH_PROVIDER_KILL_SWITCH: environmentBoolean("true"),
    FEATURE_BREACH_SCAN: environmentBoolean("false"),
    BREACH_API_KEY: optionalNonEmptyString,
  })
  .superRefine((env, context) => {
    const breachProviderDisabled =
      env.BREACH_PROVIDER === "disabled" &&
      !env.FEATURE_BREACH_SCAN &&
      env.BREACH_PROVIDER_KILL_SWITCH;
    const localSyntheticBreachProvider =
      env.APP_ENV === "local" &&
      env.BREACH_PROVIDER === "synthetic" &&
      env.FEATURE_BREACH_SCAN &&
      !env.BREACH_PROVIDER_KILL_SWITCH;

    if (!breachProviderDisabled && !localSyntheticBreachProvider) {
      context.addIssue({
        code: "custom",
        path: ["BREACH_PROVIDER"],
        message:
          "must be fully disabled or use the explicitly enabled local synthetic configuration",
      });
    }

    if (env.BREACH_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["BREACH_API_KEY"],
        message: "live breach-provider credentials are forbidden in synthetic-only Phase 2",
      });
    }

    if (env.NODE_ENV === "production" && env.AUTH_MODE === "local") {
      context.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "local authentication is forbidden in production",
      });
    }

    if (!env.ENCRYPTION_KEY) {
      context.addIssue({ code: "custom", path: ["ENCRYPTION_KEY"], message: "is required" });
    }

    if (!env.LOOKUP_KEY) {
      context.addIssue({ code: "custom", path: ["LOOKUP_KEY"], message: "is required" });
    }

    if (Boolean(env.PREVIOUS_LOOKUP_KEY_ID) !== Boolean(env.PREVIOUS_LOOKUP_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["PREVIOUS_LOOKUP_KEY_ID"],
        message:
          "PREVIOUS_LOOKUP_KEY_ID and PREVIOUS_LOOKUP_KEY must be set together or not at all",
      });
    }

    if (
      env.PREVIOUS_LOOKUP_KEY_ID &&
      env.PREVIOUS_LOOKUP_KEY &&
      env.PREVIOUS_LOOKUP_KEY_ID === env.LOOKUP_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        path: ["PREVIOUS_LOOKUP_KEY_ID"],
        message: "must differ from LOOKUP_KEY_ID",
      });
    }

    if (
      env.PREVIOUS_LOOKUP_KEY_ID &&
      env.PREVIOUS_LOOKUP_KEY &&
      env.PREVIOUS_LOOKUP_KEY === env.LOOKUP_KEY
    ) {
      context.addIssue({
        code: "custom",
        path: ["PREVIOUS_LOOKUP_KEY"],
        message: "must differ from LOOKUP_KEY",
      });
    }

    if (Boolean(env.DELIVERY_ENCRYPTION_KEY_ID) !== Boolean(env.DELIVERY_ENCRYPTION_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["DELIVERY_ENCRYPTION_KEY_ID"],
        message:
          "DELIVERY_ENCRYPTION_KEY_ID and DELIVERY_ENCRYPTION_KEY must be set together or not at all",
      });
    }

    if (
      env.DELIVERY_ENCRYPTION_KEY_ID &&
      env.DELIVERY_ENCRYPTION_KEY &&
      env.DELIVERY_ENCRYPTION_KEY_ID === env.ENCRYPTION_KEY_ID
    ) {
      context.addIssue({
        code: "custom",
        path: ["DELIVERY_ENCRYPTION_KEY_ID"],
        message: "must differ from ENCRYPTION_KEY_ID",
      });
    }

    if (
      env.DELIVERY_ENCRYPTION_KEY_ID &&
      env.DELIVERY_ENCRYPTION_KEY &&
      env.DELIVERY_ENCRYPTION_KEY === env.ENCRYPTION_KEY
    ) {
      context.addIssue({
        code: "custom",
        path: ["DELIVERY_ENCRYPTION_KEY"],
        message: "must differ from ENCRYPTION_KEY",
      });
    }

    if (env.APP_ENV === "local" && !env.DATABASE_URL) {
      context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "is required locally" });
    }

    if (env.APP_ENV === "local" && !env.RUNTIME_DATABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["RUNTIME_DATABASE_URL"],
        message: "is required locally",
      });
    }

    if (
      env.APP_ENV !== "local" &&
      env.RUNTIME_DATABASE_URL &&
      env.DATABASE_URL &&
      env.RUNTIME_DATABASE_URL === env.DATABASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["RUNTIME_DATABASE_URL"],
        message: "must use a restricted role distinct from DATABASE_URL outside local development",
      });
    }

    if (
      env.MAINTENANCE_DATABASE_URL &&
      [env.DATABASE_URL, env.RUNTIME_DATABASE_URL].includes(env.MAINTENANCE_DATABASE_URL)
    ) {
      context.addIssue({
        code: "custom",
        path: ["MAINTENANCE_DATABASE_URL"],
        message: "must use a role distinct from owner and runtime connections",
      });
    }

    if (
      env.ROTATION_DATABASE_URL &&
      [env.DATABASE_URL, env.RUNTIME_DATABASE_URL, env.MAINTENANCE_DATABASE_URL].includes(
        env.ROTATION_DATABASE_URL,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["ROTATION_DATABASE_URL"],
        message: "must use a role distinct from owner, runtime, and maintenance connections",
      });
    }

    if (
      env.LOOKUP_ROTATION_DATABASE_URL &&
      [
        env.DATABASE_URL,
        env.RUNTIME_DATABASE_URL,
        env.MAINTENANCE_DATABASE_URL,
        env.ROTATION_DATABASE_URL,
      ].includes(env.LOOKUP_ROTATION_DATABASE_URL)
    ) {
      context.addIssue({
        code: "custom",
        path: ["LOOKUP_ROTATION_DATABASE_URL"],
        message:
          "must use a role distinct from owner, runtime, maintenance, and rotation connections",
      });
    }

    if (
      env.DELIVERY_DATABASE_URL &&
      [
        env.DATABASE_URL,
        env.RUNTIME_DATABASE_URL,
        env.MAINTENANCE_DATABASE_URL,
        env.ROTATION_DATABASE_URL,
        env.LOOKUP_ROTATION_DATABASE_URL,
      ].includes(env.DELIVERY_DATABASE_URL)
    ) {
      context.addIssue({
        code: "custom",
        path: ["DELIVERY_DATABASE_URL"],
        message:
          "must use a role distinct from owner, runtime, maintenance, rotation, and lookup-rotation connections",
      });
    }

    if (
      env.AUTH_MODE === "clerk" &&
      (!env.CLERK_SECRET_KEY ||
        !env.CLERK_WEBHOOK_SIGNING_SECRET ||
        !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "Clerk keys and webhook signing secret are required when AUTH_MODE=clerk",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    cachedEnv = serverEnvSchema.parse(process.env);
  }

  return cachedEnv;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
