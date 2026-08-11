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

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
    APP_DOMAIN: z.string().default("localhost:3000"),
    AUTH_MODE: z.enum(["disabled", "local", "clerk"]).default("local"),
    LOCAL_AUTH_SUBJECT: z.string().min(3).max(128).default("local_developer"),
    DATABASE_URL: z.string().min(1),
    RUNTIME_DATABASE_URL: z.string().min(1),
    MAINTENANCE_DATABASE_URL: z.string().min(1).optional(),
    ROTATION_DATABASE_URL: z.string().min(1).optional(),
    TRUSTED_CLIENT_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .transform((value) => value.toLowerCase())
      .optional(),
    ENCRYPTION_KEY_ID: z.string().min(1).max(64),
    ENCRYPTION_KEY: optionalBase64Key,
    LOOKUP_KEY: optionalBase64Key,
    LOCAL_VERIFICATION_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .default("000000"),
    CLERK_SECRET_KEY: z.string().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  })
  .superRefine((env, context) => {
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

    if (env.APP_ENV !== "local" && env.RUNTIME_DATABASE_URL === env.DATABASE_URL) {
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
      env.AUTH_MODE === "clerk" &&
      (!env.CLERK_SECRET_KEY || !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "Clerk keys are required when AUTH_MODE=clerk",
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
