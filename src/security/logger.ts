export interface SafeLogFields extends Record<string, unknown> {
  readonly event: string;
  readonly environment?: string;
  readonly serviceVersion?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly userId?: string;
  readonly identityId?: string;
  readonly identifierId?: string;
  readonly targetId?: string;
  readonly outcome?: string;
  readonly errorCode?: string;
  readonly durationBucket?: string;
}

type SerializedLogValue = string | boolean;
type FieldValidator = (value: unknown) => value is string;

const STABLE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^(?:v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|[0-9a-f]{7,40})$/i;
const DURATION_BUCKET_PATTERN = /^(?:(?:lt|gte)_\d+(?:ms|s|m)|\d+_\d+(?:ms|s|m))$/;

function isStringMatching(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isOpaqueId(value: unknown, prefixes: readonly string[]): value is string {
  if (typeof value !== "string") return false;
  if (UUID_PATTERN.test(value)) return true;

  return prefixes.some((prefix) => {
    if (!value.startsWith(`${prefix}_`)) return false;
    const suffix = value.slice(prefix.length + 1);
    return (
      suffix.length >= 16 &&
      suffix.length <= 96 &&
      /^[A-Za-z0-9_-]+$/.test(suffix) &&
      /[A-Za-z]/.test(suffix) &&
      /\d/.test(suffix)
    );
  });
}

const FIELD_VALIDATORS: Readonly<Record<string, FieldValidator>> = {
  event: (value): value is string => isStringMatching(value, /^[A-Z][A-Z0-9_]{1,63}$/),
  environment: (value): value is string =>
    typeof value === "string" &&
    ["local", "test", "preview", "staging", "production"].includes(value),
  serviceVersion: (value): value is string => isStringMatching(value, VERSION_PATTERN),
  requestId: (value): value is string => isOpaqueId(value, ["req", "cf"]),
  correlationId: (value): value is string => isOpaqueId(value, ["corr", "correlation"]),
  userId: (value): value is string => isOpaqueId(value, ["usr", "user"]),
  identityId: (value): value is string => isOpaqueId(value, ["identity", "ident"]),
  identifierId: (value): value is string => isOpaqueId(value, ["identifier", "id"]),
  targetId: (value): value is string => isOpaqueId(value, ["target", "tgt"]),
  outcome: (value): value is string => isStringMatching(value, STABLE_CODE_PATTERN),
  errorCode: (value): value is string => isStringMatching(value, STABLE_CODE_PATTERN),
  durationBucket: (value): value is string => isStringMatching(value, DURATION_BUCKET_PATTERN),
};

export function serializeSafeLog(fields: SafeLogFields): string {
  const sanitized: Record<string, SerializedLogValue> = {};
  let redacted = false;

  for (const [key, value] of Object.entries(fields)) {
    const validator = FIELD_VALIDATORS[key];
    if (!validator || !validator(value)) {
      redacted = true;
      continue;
    }
    sanitized[key] = value;
  }

  if (!("event" in sanitized)) {
    sanitized.event = "TELEMETRY_REDACTED";
    redacted = true;
  }
  if (redacted) sanitized.redacted = true;

  return JSON.stringify(sanitized);
}

export function logSafeEvent(fields: SafeLogFields): void {
  console.log(serializeSafeLog(fields));
}
