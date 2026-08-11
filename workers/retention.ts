import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/database/schema";
import { executeRetentionMaintenance } from "../src/privacy/retention-core";

interface RetentionWorkerEnv {
  readonly MAINTENANCE_DATABASE: { readonly connectionString: string };
  readonly RETENTION_BATCH_SIZE: string;
  readonly ORPHAN_AUDIT_RETENTION_DAYS: string;
}

interface ScheduledEvent {
  readonly scheduledTime: number;
}

function integerSetting(value: string, code: string): number {
  if (!/^\d+$/.test(value)) throw new Error(code);
  return Number(value);
}

const retentionWorker = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledEvent, env: RetentionWorkerEnv): Promise<void> {
    const client = postgres(env.MAINTENANCE_DATABASE.connectionString, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      prepare: true,
    });
    try {
      const database = drizzle(client, { schema });
      await executeRetentionMaintenance(database, {
        now: new Date(controller.scheduledTime),
        batchSize: integerSetting(env.RETENTION_BATCH_SIZE, "RETENTION_BATCH_SIZE_INVALID"),
        orphanAuditRetentionDays: integerSetting(
          env.ORPHAN_AUDIT_RETENTION_DAYS,
          "AUDIT_RETENTION_DAYS_INVALID",
        ),
      });
    } finally {
      await client.end({ timeout: 5 });
    }
  },
};

export default retentionWorker;
