import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/database/schema";
import { executeRetentionMaintenance } from "../src/privacy/retention-core";
import { executeRetentionWorkerSchedule } from "../src/privacy/retention-worker-core";

interface ScheduledEvent {
  readonly scheduledTime: number;
}

const retentionWorker = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledEvent, env: RetentionWorkerEnv): Promise<void> {
    await executeRetentionWorkerSchedule(
      {
        scheduledTime: controller.scheduledTime,
        batchSize: env.RETENTION_BATCH_SIZE,
        orphanAuditRetentionDays: env.ORPHAN_AUDIT_RETENTION_DAYS,
        scanJobRetentionDays: env.SCAN_JOB_RETENTION_DAYS,
      },
      async (options) => {
        const client = postgres(env.MAINTENANCE_DATABASE.connectionString, {
          max: 1,
          connect_timeout: 10,
          idle_timeout: 20,
          prepare: true,
        });
        try {
          const database = drizzle(client, { schema });
          return await executeRetentionMaintenance(database, options);
        } finally {
          await client.end({ timeout: 5 });
        }
      },
    );
  },
};

export default retentionWorker;
