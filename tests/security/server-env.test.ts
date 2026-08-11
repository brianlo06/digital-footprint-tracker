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
  vi.stubEnv("ENCRYPTION_KEY_ID", "test-v1");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 61).toString("base64"));
  vi.stubEnv("LOOKUP_KEY", Buffer.alloc(32, 67).toString("base64"));
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

  it("permits disabled authentication for a production preview", () => {
    configureRequiredEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "disabled");
    resetServerEnvForTests();

    expect(getServerEnv().AUTH_MODE).toBe("disabled");
  });
});
