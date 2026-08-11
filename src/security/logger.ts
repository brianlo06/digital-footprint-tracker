export type SafeLogValue = string | number | boolean | null;

const SAFE_FIELDS = new Set([
  "event",
  "environment",
  "serviceVersion",
  "requestId",
  "correlationId",
  "userId",
  "identityId",
  "identifierId",
  "targetId",
  "outcome",
  "errorCode",
  "durationBucket",
]);

export function serializeSafeLog(fields: Record<string, SafeLogValue>): string {
  const safeEntries = Object.entries(fields).filter(([key]) => SAFE_FIELDS.has(key));
  return JSON.stringify(Object.fromEntries(safeEntries));
}

export function logSafeEvent(fields: Record<string, SafeLogValue>): void {
  process.stdout.write(`${serializeSafeLog(fields)}\n`);
}
