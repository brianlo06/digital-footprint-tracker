import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerEnv } from "@/config/server-env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseOperation<T> = (database: Database) => Promise<T>;

let database: Database | undefined;
let sqlClient: ReturnType<typeof postgres> | undefined;
let runtimeDatabase: Database | undefined;
let runtimeSqlClient: ReturnType<typeof postgres> | undefined;
let maintenanceDatabase: Database | undefined;
let maintenanceSqlClient: ReturnType<typeof postgres> | undefined;
let rotationDatabase: Database | undefined;
let rotationSqlClient: ReturnType<typeof postgres> | undefined;

interface HyperdriveBinding {
  readonly connectionString: string;
}

function openDatabase(connectionString: string, max: number) {
  const client = postgres(connectionString, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  });
  return { client, database: drizzle(client, { schema }) };
}

function requiredUrl(url: string | undefined, code: string): string {
  if (!url) throw new Error(code);
  return url;
}

function hostedHyperdriveConnectionString(bindingName: string): string | undefined {
  if (getServerEnv().APP_ENV === "local") return undefined;

  try {
    // OpenNext makes non-text Worker bindings available through request context.
    // The structural type keeps local Next builds independent of a provisioned binding.
    // A missing binding fails closed below instead of falling back to an owner credential.
    const environment = getCloudflareContext().env as unknown as Record<string, unknown>;
    const candidate = environment[bindingName] as HyperdriveBinding | undefined;
    return candidate?.connectionString;
  } catch {
    return undefined;
  }
}

async function withEphemeralDatabase<T>(
  connectionString: string,
  max: number,
  operation: DatabaseOperation<T>,
): Promise<T> {
  const connection = openDatabase(connectionString, max);
  try {
    return await operation(connection.database);
  } finally {
    await connection.client.end({ timeout: 5 });
  }
}

export function getDatabase(): Database {
  if (!database) {
    sqlClient = postgres(requiredUrl(getServerEnv().DATABASE_URL, "DATABASE_URL_REQUIRED"), {
      max: getServerEnv().APP_ENV === "local" ? 4 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    database = drizzle(sqlClient, { schema });
  }

  return database;
}

export function getRuntimeDatabase(): Database {
  if (!runtimeDatabase) {
    runtimeSqlClient = postgres(
      requiredUrl(getServerEnv().RUNTIME_DATABASE_URL, "RUNTIME_DATABASE_URL_REQUIRED"),
      {
        max: getServerEnv().APP_ENV === "local" ? 4 : 10,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
      },
    );
    runtimeDatabase = drizzle(runtimeSqlClient, { schema });
  }

  return runtimeDatabase;
}

export async function withRuntimeDatabase<T>(operation: DatabaseOperation<T>): Promise<T> {
  const env = getServerEnv();
  if (env.APP_ENV === "local") return operation(getRuntimeDatabase());

  const connectionString = hostedHyperdriveConnectionString("RUNTIME_DATABASE");
  return withEphemeralDatabase(
    requiredUrl(connectionString, "RUNTIME_DATABASE_BINDING_REQUIRED"),
    5,
    operation,
  );
}

export function getMaintenanceDatabase(): Database {
  if (!maintenanceDatabase) {
    const url = getServerEnv().MAINTENANCE_DATABASE_URL;
    if (!url) throw new Error("MAINTENANCE_DATABASE_URL_REQUIRED");

    maintenanceSqlClient = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    maintenanceDatabase = drizzle(maintenanceSqlClient, { schema });
  }

  return maintenanceDatabase;
}

export async function withMaintenanceDatabase<T>(operation: DatabaseOperation<T>): Promise<T> {
  const env = getServerEnv();
  if (env.APP_ENV === "local") return operation(getMaintenanceDatabase());

  const connectionString = hostedHyperdriveConnectionString("MAINTENANCE_DATABASE");
  return withEphemeralDatabase(
    requiredUrl(connectionString, "MAINTENANCE_DATABASE_BINDING_REQUIRED"),
    1,
    operation,
  );
}

export function getRotationDatabase(): Database {
  if (!rotationDatabase) {
    const url = getServerEnv().ROTATION_DATABASE_URL;
    if (!url) throw new Error("ROTATION_DATABASE_URL_REQUIRED");

    rotationSqlClient = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    rotationDatabase = drizzle(rotationSqlClient, { schema });
  }

  return rotationDatabase;
}

export async function withRotationDatabase<T>(operation: DatabaseOperation<T>): Promise<T> {
  const env = getServerEnv();
  if (env.APP_ENV === "local") return operation(getRotationDatabase());

  const connectionString = hostedHyperdriveConnectionString("ROTATION_DATABASE");
  return withEphemeralDatabase(
    requiredUrl(connectionString, "ROTATION_DATABASE_BINDING_REQUIRED"),
    1,
    operation,
  );
}

export async function closeDatabase(): Promise<void> {
  await Promise.all([
    sqlClient?.end({ timeout: 5 }),
    runtimeSqlClient?.end({ timeout: 5 }),
    maintenanceSqlClient?.end({ timeout: 5 }),
    rotationSqlClient?.end({ timeout: 5 }),
  ]);
  database = undefined;
  sqlClient = undefined;
  runtimeDatabase = undefined;
  runtimeSqlClient = undefined;
  maintenanceDatabase = undefined;
  maintenanceSqlClient = undefined;
  rotationDatabase = undefined;
  rotationSqlClient = undefined;
}
