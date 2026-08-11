import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const previewPath = "wrangler.jsonc";
const retentionPath = "wrangler.retention.example.jsonc";

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
    ["RETENTION_BATCH_SIZE", "ORPHAN_AUDIT_RETENTION_DAYS"],
    "RETENTION:VARS",
  );
  expect(configuration.vars.RETENTION_BATCH_SIZE === "100", "RETENTION:BATCH_SIZE");
  expect(configuration.vars.ORPHAN_AUDIT_RETENTION_DAYS === "365", "RETENTION:AUDIT_DAYS");
}

export function verifyDeploymentBoundaries({
  previewConfigurationPath = previewPath,
  retentionConfigurationPath = retentionPath,
} = {}) {
  verifyPreviewBoundary(parseConfiguration(previewConfigurationPath), previewConfigurationPath);
  verifyRetentionTemplateBoundary(
    parseConfiguration(retentionConfigurationPath),
    retentionConfigurationPath,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDeploymentBoundaries();
  process.stdout.write("Cloudflare deployment boundaries verified.\n");
}
