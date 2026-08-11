import "server-only";

import { getServerEnv } from "@/config/server-env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let database: Database | undefined;
let sqlClient: ReturnType<typeof postgres> | undefined;
let runtimeDatabase: Database | undefined;
let runtimeSqlClient: ReturnType<typeof postgres> | undefined;
let maintenanceDatabase: Database | undefined;
let maintenanceSqlClient: ReturnType<typeof postgres> | undefined;
let rotationDatabase: Database | undefined;
let rotationSqlClient: ReturnType<typeof postgres> | undefined;

export function getDatabase(): Database {
  if (!database) {
    sqlClient = postgres(getServerEnv().DATABASE_URL, {
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
    runtimeSqlClient = postgres(getServerEnv().RUNTIME_DATABASE_URL, {
      max: getServerEnv().APP_ENV === "local" ? 4 : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    runtimeDatabase = drizzle(runtimeSqlClient, { schema });
  }

  return runtimeDatabase;
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
