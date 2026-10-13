import postgres from "postgres";

/** Retention sweeps all tenants. Hold this across fixture setup, sweep and assertions
 * in each retention suite so another sweep cannot consume its expected deletions.
 * This coordinates tests only; production maintenance still uses SKIP LOCKED.
 */
export function retentionTestLock(databaseUrl: string) {
  const connection = postgres(databaseUrl, { max: 1, prepare: false });
  return {
    async acquire() {
      await connection`select pg_advisory_lock(731904, 24)`;
    },
    async release() {
      try {
        await connection`select pg_advisory_unlock(731904, 24)`;
      } finally {
        await connection.end({ timeout: 5 });
      }
    },
  };
}
