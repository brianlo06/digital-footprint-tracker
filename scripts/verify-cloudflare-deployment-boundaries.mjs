import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const previewPath = "wrangler.jsonc";
const retentionPath = "wrangler.retention.example.jsonc";
const verificationDeliveryPath = "wrangler.verification-delivery.example.jsonc";
const breachScanPath = "wrangler.breach-scan.example.jsonc";

const forbiddenBindingKeys = [
  "ai",
  "analytics_engine_datasets",
  "browser",
  "containers",
  "d1_databases",
  "dispatch_namespaces",
  "durable_objects",
  "hyperdrive",
  "images",
  "kv_namespaces",
  "logfwdr",
  "mtls_certificates",
  "pipelines",
  "queues",
  "r2_buckets",
  "secrets_store_secrets",
  "send_email",
  "services",
  "tail_consumers",
  "vectorize",
  "workflows",
];

function fail(code) {
  throw new Error(`CLOUDFLARE_DEPLOYMENT_BOUNDARY_INVALID:${code}`);
}

function normalizeCommentFreeJsonc(source, path) {
  let normalized = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }

    if (character === "/" && ["/", "*"].includes(source[index + 1])) {
      fail(`${path}:COMMENTS_FORBIDDEN`);
    }

    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (["}", "]"].includes(source[next])) continue;
    }

    normalized += character;
  }

  expect(!inString, `${path}:UNTERMINATED_STRING`);
  return normalized;
}

function parseConfiguration(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    fail(`${path}:READ_FAILED`);
  }

  const normalized = normalizeCommentFreeJsonc(source, path);
  try {
    return JSON.parse(normalized);
  } catch {
    fail(`${path}:BOUNDED_JSONC_REQUIRED`);
  }
}

function expect(condition, code) {
  if (!condition) fail(code);
}

function expectExactKeys(value, expectedKeys, code) {
  expect(value && typeof value === "object" && !Array.isArray(value), `${code}:OBJECT`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  expect(JSON.stringify(actual) === JSON.stringify(expected), `${code}:KEYS`);
}

function verifyCommonWorkerBoundary(configuration, path) {
  expect(configuration.$schema === "./node_modules/wrangler/config-schema.json", `${path}:SCHEMA`);
  expect(configuration.workers_dev === false, `${path}:WORKERS_DEV_DISABLED`);
  expect(configuration.preview_urls === false, `${path}:PREVIEW_URLS_DISABLED`);
  expect(
    Array.isArray(configuration.compatibility_flags) &&
      configuration.compatibility_flags.length === 1 &&
      configuration.compatibility_flags[0] === "nodejs_compat",
    `${path}:COMPATIBILITY_FLAGS`,
  );
  expect(configuration.compatibility_date === "2026-08-11", `${path}:DATE`);
  expectExactKeys(
    configuration.observability,
    ["enabled", "logs", "traces"],
    `${path}:OBSERVABILITY`,
  );
  expectExactKeys(
    configuration.observability.logs,
    ["enabled", "head_sampling_rate", "invocation_logs"],
    `${path}:OBSERVABILITY_LOGS`,
  );
  expectExactKeys(configuration.observability.traces, ["enabled"], `${path}:OBSERVABILITY_TRACES`);
  expect(configuration.observability?.enabled === true, `${path}:OBSERVABILITY`);
  expect(configuration.observability?.logs?.enabled === true, `${path}:LOGS`);
  expect(configuration.observability?.logs?.head_sampling_rate === 1, `${path}:LOG_SAMPLING`);
  expect(configuration.observability?.logs?.invocation_logs === false, `${path}:INVOCATION_LOGS`);
  expect(configuration.observability?.traces?.enabled === false, `${path}:TRACES`);
  expect(!("env" in configuration), `${path}:UNVERIFIED_ENVIRONMENTS`);
  expect(!("unsafe" in configuration), `${path}:UNSAFE_CONFIGURATION`);

  for (const [name, value] of Object.entries(configuration.vars ?? {})) {
    expect(typeof value === "string", `${path}:VAR_${name}_STRING`);
    expect(
      !/(SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|CONNECTION_STRING)/i.test(name),
      `${path}:SECRET_LIKE_VAR_${name}`,
    );
  }
}

function verifyPreviewBoundary(configuration, path) {
  verifyCommonWorkerBoundary(configuration, path);
  for (const key of forbiddenBindingKeys) {
    expect(!(key in configuration), `PREVIEW:FORBIDDEN_BINDING_${key}`);
  }
  expectExactKeys(
    configuration,
    [
      "$schema",
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "workers_dev",
      "preview_urls",
      "routes",
      "assets",
      "observability",
      "vars",
    ],
    "PREVIEW:ROOT",
  );
  expect(configuration.name === "digital-footprint-tracker-preview", "PREVIEW:NAME");
  expect(configuration.main === ".open-next/worker.js", "PREVIEW:MAIN");
  expect(
    JSON.stringify(configuration.routes) ===
      JSON.stringify([{ pattern: "dft.jarvisworlds.com", custom_domain: true }]),
    "PREVIEW:ROUTE",
  );
  expect(
    JSON.stringify(configuration.assets) ===
      JSON.stringify({ directory: ".open-next/assets", binding: "ASSETS" }),
    "PREVIEW:ASSETS",
  );
  expectExactKeys(
    configuration.vars,
    ["APP_ENV", "APP_DOMAIN", "AUTH_MODE", "TRUSTED_CLIENT_IP_HEADER"],
    "PREVIEW:VARS",
  );
  expect(configuration.vars.APP_ENV === "preview", "PREVIEW:APP_ENV");
  expect(configuration.vars.APP_DOMAIN === "dft.jarvisworlds.com", "PREVIEW:APP_DOMAIN");
  expect(configuration.vars.AUTH_MODE === "disabled", "PREVIEW:AUTH_MODE");
  expect(
    configuration.vars.TRUSTED_CLIENT_IP_HEADER === "cf-connecting-ip",
    "PREVIEW:TRUSTED_IP_HEADER",
  );
  expect(!("triggers" in configuration), "PREVIEW:TRIGGERS");
}

function verifyRetentionTemplateBoundary(configuration, path) {
  verifyCommonWorkerBoundary(configuration, path);
  for (const key of forbiddenBindingKeys) {
    if (key === "hyperdrive") continue;
    expect(!(key in configuration), `RETENTION:FORBIDDEN_BINDING_${key}`);
  }
  expectExactKeys(
    configuration,
    [
      "$schema",
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "workers_dev",
      "preview_urls",
      "placement",
      "triggers",
      "hyperdrive",
      "observability",
      "vars",
    ],
    "RETENTION:ROOT",
  );
  expect(configuration.name === "digital-footprint-tracker-retention-preview", "RETENTION:NAME");
  expect(configuration.main === "workers/retention.ts", "RETENTION:MAIN");
  expect(
    JSON.stringify(configuration.placement) === JSON.stringify({ mode: "smart" }),
    "RETENTION:PLACEMENT",
  );
  expect(
    JSON.stringify(configuration.triggers) === JSON.stringify({ crons: ["0 4 * * *"] }),
    "RETENTION:CRON",
  );
  expect(!("routes" in configuration), "RETENTION:ROUTES");
  expect(!("assets" in configuration), "RETENTION:ASSETS");
  expect(
    JSON.stringify(configuration.hyperdrive) ===
      JSON.stringify([
        {
          binding: "MAINTENANCE_DATABASE",
          id: "00000000000000000000000000000000",
        },
      ]),
    "RETENTION:MAINTENANCE_BINDING_TEMPLATE",
  );
  expectExactKeys(
    configuration.vars,
    ["RETENTION_BATCH_SIZE", "ORPHAN_AUDIT_RETENTION_DAYS", "SCAN_JOB_RETENTION_DAYS"],
    "RETENTION:VARS",
  );
  expect(configuration.vars.RETENTION_BATCH_SIZE === "100", "RETENTION:BATCH_SIZE");
  expect(configuration.vars.ORPHAN_AUDIT_RETENTION_DAYS === "365", "RETENTION:AUDIT_DAYS");
  expect(configuration.vars.SCAN_JOB_RETENTION_DAYS === "90", "RETENTION:SCAN_JOB_DAYS");
}

function verifyVerificationDeliveryTemplateBoundary(configuration, path) {
  verifyCommonWorkerBoundary(configuration, path);
  for (const key of forbiddenBindingKeys) {
    if (key === "hyperdrive" || key === "secrets_store_secrets") continue;
    expect(!(key in configuration), `DELIVERY:FORBIDDEN_BINDING_${key}`);
  }
  expectExactKeys(
    configuration,
    [
      "$schema",
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "workers_dev",
      "preview_urls",
      "placement",
      "triggers",
      "hyperdrive",
      "secrets_store_secrets",
      "observability",
      "vars",
    ],
    "DELIVERY:ROOT",
  );
  expect(
    configuration.name === "digital-footprint-tracker-verification-delivery-preview",
    "DELIVERY:NAME",
  );
  expect(configuration.main === "workers/verification-delivery.ts", "DELIVERY:MAIN");
  expect(
    JSON.stringify(configuration.placement) === JSON.stringify({ mode: "smart" }),
    "DELIVERY:PLACEMENT",
  );
  expect(
    JSON.stringify(configuration.triggers) === JSON.stringify({ crons: ["* * * * *"] }),
    "DELIVERY:CRON",
  );
  expect(!("routes" in configuration), "DELIVERY:ROUTES");
  expect(!("assets" in configuration), "DELIVERY:ASSETS");
  expect(
    JSON.stringify(configuration.hyperdrive) ===
      JSON.stringify([
        {
          binding: "DELIVERY_DATABASE",
          id: "00000000000000000000000000000000",
        },
      ]),
    "DELIVERY:DATABASE_BINDING_TEMPLATE",
  );
  expect(
    JSON.stringify(configuration.secrets_store_secrets) ===
      JSON.stringify([
        {
          binding: "DELIVERY_ENCRYPTION_KEY",
          store_id: "00000000000000000000000000000000",
          secret_name: "delivery-encryption-key",
        },
      ]),
    "DELIVERY:ENCRYPTION_KEY_SECRET_TEMPLATE",
  );
  expectExactKeys(
    configuration.vars,
    [
      "DELIVERY_ENCRYPTION_KEY_ID",
      "DELIVERY_KILL_SWITCH",
      "DELIVERY_CLAIM_BATCH_SIZE",
      "DELIVERY_CLAIM_LEASE_SECONDS",
    ],
    "DELIVERY:VARS",
  );
  // The kill switch must ship default-on: only an explicit "false" enables
  // claiming, so a missing or mistyped variable fails closed.
  expect(configuration.vars.DELIVERY_KILL_SWITCH === "true", "DELIVERY:KILL_SWITCH_DEFAULT_ON");
  expect(configuration.vars.DELIVERY_CLAIM_BATCH_SIZE === "25", "DELIVERY:CLAIM_BATCH_SIZE");
  expect(configuration.vars.DELIVERY_CLAIM_LEASE_SECONDS === "120", "DELIVERY:CLAIM_LEASE_SECONDS");
}

function verifyBreachScanTemplateBoundary(configuration, path) {
  verifyCommonWorkerBoundary(configuration, path);
  for (const key of forbiddenBindingKeys) {
    if (key === "hyperdrive") continue;
    expect(!(key in configuration), `BREACH_SCAN:FORBIDDEN_BINDING_${key}`);
  }
  expectExactKeys(
    configuration,
    [
      "$schema",
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "workers_dev",
      "preview_urls",
      "placement",
      "triggers",
      "alias",
      "hyperdrive",
      "observability",
      "vars",
    ],
    "BREACH_SCAN:ROOT",
  );
  expect(
    configuration.name === "digital-footprint-tracker-breach-scan-preview",
    "BREACH_SCAN:NAME",
  );
  expect(configuration.main === "workers/breach-scan.ts", "BREACH_SCAN:MAIN");
  expect(
    JSON.stringify(configuration.placement) === JSON.stringify({ mode: "smart" }),
    "BREACH_SCAN:PLACEMENT",
  );
  expect(
    JSON.stringify(configuration.triggers) === JSON.stringify({ crons: ["* * * * *"] }),
    "BREACH_SCAN:CRON",
  );
  expect(!("routes" in configuration), "BREACH_SCAN:ROUTES");
  expect(!("assets" in configuration), "BREACH_SCAN:ASSETS");
  expect(
    JSON.stringify(configuration.alias) ===
      JSON.stringify({ "server-only": "./workers/server-only-noop.ts" }),
    "BREACH_SCAN:SERVER_ONLY_ALIAS",
  );
  expect(
    JSON.stringify(configuration.hyperdrive) ===
      JSON.stringify([
        {
          binding: "SCAN_DATABASE",
          id: "00000000000000000000000000000000",
        },
      ]),
    "BREACH_SCAN:DATABASE_BINDING_TEMPLATE",
  );
  expectExactKeys(
    configuration.vars,
    [
      "SCAN_KILL_SWITCH",
      "SCAN_SYNTHETIC_ENABLED",
      "SCAN_CLAIM_BATCH_SIZE",
      "SCAN_CLAIM_LEASE_SECONDS",
    ],
    "BREACH_SCAN:VARS",
  );
  expect(configuration.vars.SCAN_KILL_SWITCH === "true", "BREACH_SCAN:KILL_SWITCH_DEFAULT_ON");
  expect(
    configuration.vars.SCAN_SYNTHETIC_ENABLED === "false",
    "BREACH_SCAN:SYNTHETIC_DEFAULT_OFF",
  );
  expect(configuration.vars.SCAN_CLAIM_BATCH_SIZE === "10", "BREACH_SCAN:CLAIM_BATCH_SIZE");
  expect(configuration.vars.SCAN_CLAIM_LEASE_SECONDS === "120", "BREACH_SCAN:CLAIM_LEASE_SECONDS");
}

export function verifyDeploymentBoundaries({
  previewConfigurationPath = previewPath,
  retentionConfigurationPath = retentionPath,
  verificationDeliveryConfigurationPath = verificationDeliveryPath,
  breachScanConfigurationPath = breachScanPath,
} = {}) {
  verifyPreviewBoundary(parseConfiguration(previewConfigurationPath), previewConfigurationPath);
  verifyRetentionTemplateBoundary(
    parseConfiguration(retentionConfigurationPath),
    retentionConfigurationPath,
  );
  verifyVerificationDeliveryTemplateBoundary(
    parseConfiguration(verificationDeliveryConfigurationPath),
    verificationDeliveryConfigurationPath,
  );
  verifyBreachScanTemplateBoundary(
    parseConfiguration(breachScanConfigurationPath),
    breachScanConfigurationPath,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDeploymentBoundaries();
  process.stdout.write("Cloudflare deployment boundaries verified.\n");
}
