import { getServerEnv, resetServerEnvForTests } from "@/config/server-env";
import { afterEach, describe, expect, it, vi } from "vitest";

function configureRequiredEnvironment(): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_ENV", "preview");
  vi.stubEnv("AUTH_MODE", "local");
  vi.stubEnv("DATABASE_URL", "postgres://owner@example.test/database");
  vi.stubEnv("RUNTIME_DATABASE_URL", "postgres://runtime@example.test/database");
  vi.stubEnv("MAINTENANCE_DATABASE_URL", "postgres://maintenance@example.test/database");
  vi.stubEnv("ROTATION_DATABASE_URL", "postgres://rotation@example.test/database");
  vi.stubEnv("LOOKUP_ROTATION_DATABASE_URL", "postgres://lookup-rotation@example.test/database");
  vi.stubEnv("DELIVERY_DATABASE_URL", "postgres://delivery@example.test/database");
  vi.stubEnv("ENCRYPTION_KEY_ID", "test-v1");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 61).toString("base64"));
  vi.stubEnv("LOOKUP_KEY", Buffer.alloc(32, 67).toString("base64"));
  vi.stubEnv("LOOKUP_KEY_ID", "test-lookup-v1");
}

describe("database connection environment boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });

  it("accepts distinct owner and runtime connections", () => {
    configureRequiredEnvironment();
    resetServerEnvForTests();

    expect(getServerEnv().RUNTIME_DATABASE_URL).toBe("postgres://runtime@example.test/database");
  });

  it("rejects one shared privileged connection outside local development", () => {
    configureRequiredEnvironment();
    vi.stubEnv("RUNTIME_DATABASE_URL", "postgres://owner@example.test/database");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must use a restricted role distinct");
  });

  it("rejects a maintenance connection that reuses an application role", () => {
    configureRequiredEnvironment();
    vi.stubEnv("MAINTENANCE_DATABASE_URL", "postgres://runtime@example.test/database");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must use a role distinct");
  });

  it("rejects a rotation connection that reuses another privileged role", () => {
    configureRequiredEnvironment();
    vi.stubEnv("ROTATION_DATABASE_URL", "postgres://maintenance@example.test/database");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must use a role distinct");
  });

  it("rejects a lookup-rotation connection that reuses another privileged role", () => {
    configureRequiredEnvironment();
    vi.stubEnv("LOOKUP_ROTATION_DATABASE_URL", "postgres://rotation@example.test/database");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must use a role distinct");
  });

  it("rejects a delivery connection that reuses another privileged role", () => {
    configureRequiredEnvironment();
    vi.stubEnv("DELIVERY_DATABASE_URL", "postgres://lookup-rotation@example.test/database");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must use a role distinct");
  });

  it("requires previous lookup-key ID and material together", () => {
    configureRequiredEnvironment();
    vi.stubEnv("PREVIOUS_LOOKUP_KEY_ID", "test-lookup-v0");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must be set together");
  });

  it("rejects a previous lookup key identical to the current one", () => {
    configureRequiredEnvironment();
    vi.stubEnv("PREVIOUS_LOOKUP_KEY_ID", "test-lookup-v1");
    vi.stubEnv("PREVIOUS_LOOKUP_KEY", Buffer.alloc(32, 67).toString("base64"));
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must differ from LOOKUP_KEY_ID");
  });

  it("accepts a distinct previous lookup key", () => {
    configureRequiredEnvironment();
    vi.stubEnv("PREVIOUS_LOOKUP_KEY_ID", "test-lookup-v0");
    vi.stubEnv("PREVIOUS_LOOKUP_KEY", Buffer.alloc(32, 68).toString("base64"));
    resetServerEnvForTests();

    expect(getServerEnv().PREVIOUS_LOOKUP_KEY_ID).toBe("test-lookup-v0");
  });

  it("requires delivery encryption key ID and material together", () => {
    configureRequiredEnvironment();
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY_ID", "test-delivery-v1");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must be set together");
  });

  it("rejects a delivery encryption key ID identical to the envelope key ID", () => {
    configureRequiredEnvironment();
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY_ID", "test-v1");
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY", Buffer.alloc(32, 68).toString("base64"));
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must differ from ENCRYPTION_KEY_ID");
  });

  it("rejects delivery encryption key material identical to the envelope key", () => {
    configureRequiredEnvironment();
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY_ID", "test-delivery-v1");
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY", Buffer.alloc(32, 61).toString("base64"));
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("must differ from ENCRYPTION_KEY");
  });

  it("accepts a distinct delivery encryption key", () => {
    configureRequiredEnvironment();
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY_ID", "test-delivery-v1");
    vi.stubEnv("DELIVERY_ENCRYPTION_KEY", Buffer.alloc(32, 68).toString("base64"));
    resetServerEnvForTests();

    expect(getServerEnv().DELIVERY_ENCRYPTION_KEY_ID).toBe("test-delivery-v1");
  });

  it("permits disabled authentication for a production preview", () => {
    configureRequiredEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "disabled");
    resetServerEnvForTests();

    expect(getServerEnv().AUTH_MODE).toBe("disabled");
  });

  it("permits hosted Hyperdrive bindings without embedding database URLs", () => {
    configureRequiredEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "disabled");
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("RUNTIME_DATABASE_URL", undefined);
    vi.stubEnv("MAINTENANCE_DATABASE_URL", undefined);
    vi.stubEnv("ROTATION_DATABASE_URL", undefined);
    resetServerEnvForTests();

    const env = getServerEnv();
    expect(env.APP_ENV).toBe("preview");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("RUNTIME_DATABASE_URL");
  });

  it("requires a webhook signing secret with Clerk authentication", () => {
    configureRequiredEnvironment();
    vi.stubEnv("AUTH_MODE", "clerk");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", undefined);
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("webhook signing secret");

    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "whsec_example");
    resetServerEnvForTests();
    expect(getServerEnv().CLERK_WEBHOOK_SIGNING_SECRET).toBe("whsec_example");
  });

  it("defaults to a fully disabled breach-provider configuration", () => {
    configureRequiredEnvironment();
    vi.stubEnv("BREACH_PROVIDER", undefined);
    vi.stubEnv("BREACH_PROVIDER_KILL_SWITCH", undefined);
    vi.stubEnv("FEATURE_BREACH_SCAN", undefined);
    vi.stubEnv("BREACH_API_KEY", undefined);
    resetServerEnvForTests();

    expect(getServerEnv()).toMatchObject({
      BREACH_PROVIDER: "disabled",
      BREACH_PROVIDER_KILL_SWITCH: true,
      FEATURE_BREACH_SCAN: false,
    });
  });

  it("accepts only the exact local synthetic breach-provider configuration", () => {
    configureRequiredEnvironment();
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("BREACH_PROVIDER", "synthetic");
    vi.stubEnv("BREACH_PROVIDER_KILL_SWITCH", "false");
    vi.stubEnv("FEATURE_BREACH_SCAN", "true");
    resetServerEnvForTests();

    expect(getServerEnv()).toMatchObject({
      BREACH_PROVIDER: "synthetic",
      BREACH_PROVIDER_KILL_SWITCH: false,
      FEATURE_BREACH_SCAN: true,
    });
  });

  it("rejects mixed or hosted synthetic breach-provider configurations", () => {
    configureRequiredEnvironment();
    vi.stubEnv("BREACH_PROVIDER", "synthetic");
    vi.stubEnv("BREACH_PROVIDER_KILL_SWITCH", "false");
    vi.stubEnv("FEATURE_BREACH_SCAN", "true");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow("explicitly enabled local synthetic configuration");

    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("BREACH_PROVIDER_KILL_SWITCH", "true");
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow("fully disabled");
  });

  it("rejects every live breach-provider credential during synthetic-only Phase 2", () => {
    configureRequiredEnvironment();
    vi.stubEnv("BREACH_API_KEY", "synthetic-provider-key-must-not-be-accepted");
    resetServerEnvForTests();

    expect(() => getServerEnv()).toThrow(
      "live breach-provider credentials are forbidden in synthetic-only Phase 2",
    );
  });
});
