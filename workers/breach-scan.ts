import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/database/schema";
import { claimBreachScanJobs } from "../src/providers/breach/breach-scan-job-core";
import {
  executeBreachScanWorkerSchedule,
  type BreachScanWorkerSummary,
} from "../src/providers/breach/breach-scan-worker-core";
import { processClaimedPostgresSyntheticBreachScan } from "../src/providers/breach/postgres-breach-scan-worker-core";
import { createSyntheticBreachProvider } from "../src/providers/breach/synthetic-breach-provider";
import type { BreachProviderSelection } from "../src/providers/provider-registry";
import { logSafeEvent } from "../src/security/logger";

const syntheticSelection: BreachProviderSelection = {
  status: "ENABLED_SYNTHETIC",
  provider: createSyntheticBreachProvider(),
};

interface ScheduledEvent {
  readonly scheduledTime: number;
}

function logSummary(summary: BreachScanWorkerSummary): void {
  logSafeEvent({
    event: "BREACH_SCAN_SCHEDULE",
    outcome: summary.status,
    ...(summary.systemFailures > 0 ? { errorCode: "SCAN_JOB_SYSTEM_FAILURE" } : {}),
  });
}

const breachScanWorker = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledEvent, env: BreachScanWorkerEnv): Promise<void> {
    let client: ReturnType<typeof postgres> | undefined;
    const getClient = (): ReturnType<typeof postgres> => {
      client ??= postgres(env.SCAN_DATABASE.connectionString, {
        max: 1,
        connect_timeout: 10,
        idle_timeout: 20,
        prepare: true,
      });
      return client;
    };
    try {
      const summary = await executeBreachScanWorkerSchedule(
        {
          scheduledTime: controller.scheduledTime,
          invocationTime: Date.now(),
          killSwitch: env.SCAN_KILL_SWITCH,
          syntheticEnabled: env.SCAN_SYNTHETIC_ENABLED,
          batchSize: env.SCAN_CLAIM_BATCH_SIZE,
          leaseSeconds: env.SCAN_CLAIM_LEASE_SECONDS,
        },
        {
          claim: async (options) => {
            const database = drizzle(getClient(), { schema });
            return claimBreachScanJobs(database, options);
          },
          process: async (job, now) => {
            const database = drizzle(getClient(), { schema });
            return processClaimedPostgresSyntheticBreachScan({
              database,
              job,
              now,
              providerSelection: syntheticSelection,
            });
          },
          reportSystemFailure: ({ jobId }) => {
            logSafeEvent({
              event: "BREACH_SCAN_JOB_PROCESS",
              targetId: jobId,
              outcome: "FAILED",
              errorCode: "SCAN_JOB_SYSTEM_FAILURE",
            });
          },
        },
      );
      logSummary(summary);
    } finally {
      if (client) await client.end({ timeout: 5 });
    }
  },
};

export default breachScanWorker;
