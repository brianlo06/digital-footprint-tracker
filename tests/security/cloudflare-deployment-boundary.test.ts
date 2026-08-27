import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDeploymentBoundaries } from "../../scripts/verify-cloudflare-deployment-boundaries.mjs";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

function configurationFixtures(): {
  preview: string;
  retention: string;
  verificationDelivery: string;
  breachScan: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "dft-cloudflare-boundary-"));
  temporaryDirectories.push(directory);
  const preview = join(directory, "wrangler.jsonc");
  const retention = join(directory, "wrangler.retention.example.jsonc");
  const verificationDelivery = join(directory, "wrangler.verification-delivery.example.jsonc");
  const breachScan = join(directory, "wrangler.breach-scan.example.jsonc");
  copyFileSync("wrangler.jsonc", preview);
  copyFileSync("wrangler.retention.example.jsonc", retention);
  copyFileSync("wrangler.verification-delivery.example.jsonc", verificationDelivery);
  copyFileSync("wrangler.breach-scan.example.jsonc", breachScan);
  return { preview, retention, verificationDelivery, breachScan };
}

function verify(
  preview: string,
  retention: string,
  verificationDelivery: string,
  breachScan = "wrangler.breach-scan.example.jsonc",
): void {
  verifyDeploymentBoundaries({
    previewConfigurationPath: preview,
    retentionConfigurationPath: retention,
    verificationDeliveryConfigurationPath: verificationDelivery,
    breachScanConfigurationPath: breachScan,
  });
}

describe("Cloudflare deployment boundary verifier", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts the committed route and background-worker boundaries", () => {
    const { preview, retention, verificationDelivery, breachScan } = configurationFixtures();
    expect(() => verify(preview, retention, verificationDelivery, breachScan)).not.toThrow();
  });

  it("rejects enabling authentication in the no-data preview", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"AUTH_MODE": "disabled"', '"AUTH_MODE": "clerk"'),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow("PREVIEW:AUTH_MODE");
  });

  it("rejects a web Hyperdrive binding", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace(
        '"vars": {',
        '"hyperdrive": [{"binding":"RUNTIME_DATABASE","id":"synthetic"}], "vars": {',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "FORBIDDEN_BINDING_hyperdrive",
    );
  });

  it("rejects an unknown future root binding until it is reviewed", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"vars": {', '"future_binding": {}, "vars": {'),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow("PREVIEW:ROOT:KEYS");
  });

  it("rejects secret-like values placed in public vars", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace(
        '"APP_ENV": "preview",',
        '"APP_ENV": "preview", "CLERK_SECRET_KEY": "synthetic",',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "SECRET_LIKE_VAR_CLERK_SECRET_KEY",
    );
  });

  it("rejects comments that could hide unparsed configuration", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(preview, `// synthetic hidden change\n${readFileSync(preview, "utf8")}`);

    expect(() => verify(preview, retention, verificationDelivery)).toThrow("COMMENTS_FORBIDDEN");
  });

  it("rejects automatic invocation logging", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      preview,
      readFileSync(preview, "utf8").replace('"invocation_logs": false', '"invocation_logs": true'),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow("INVOCATION_LOGS");
  });

  it("rejects replacing the retention placeholder in the committed template", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      retention,
      readFileSync(retention, "utf8").replace(
        "00000000000000000000000000000000",
        "11111111111111111111111111111111",
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "MAINTENANCE_BINDING_TEMPLATE",
    );
  });

  it("rejects replacing the verification-delivery database placeholder in the committed template", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      verificationDelivery,
      readFileSync(verificationDelivery, "utf8").replace(
        "00000000000000000000000000000000",
        "11111111111111111111111111111111",
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "DATABASE_BINDING_TEMPLATE",
    );
  });

  it("rejects disabling the verification-delivery kill switch's default-on posture", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      verificationDelivery,
      readFileSync(verificationDelivery, "utf8").replace(
        '"DELIVERY_KILL_SWITCH": "true"',
        '"DELIVERY_KILL_SWITCH": "false"',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "KILL_SWITCH_DEFAULT_ON",
    );
  });

  it("rejects a verification-delivery provider secret placed in a plain var", () => {
    const { preview, retention, verificationDelivery } = configurationFixtures();
    writeFileSync(
      verificationDelivery,
      readFileSync(verificationDelivery, "utf8").replace(
        '"DELIVERY_ENCRYPTION_KEY_ID": "example-delivery-v1",',
        '"DELIVERY_ENCRYPTION_KEY_ID": "example-delivery-v1", "PROVIDER_API_KEY": "synthetic",',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery)).toThrow(
      "SECRET_LIKE_VAR_PROVIDER_API_KEY",
    );
  });

  it("rejects replacing the breach-scan database placeholder", () => {
    const { preview, retention, verificationDelivery, breachScan } = configurationFixtures();
    writeFileSync(
      breachScan,
      readFileSync(breachScan, "utf8").replace(
        "00000000000000000000000000000000",
        "11111111111111111111111111111111",
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery, breachScan)).toThrow(
      "BREACH_SCAN:DATABASE_BINDING_TEMPLATE",
    );
  });

  it("rejects disabling the breach-scan kill switch in the committed template", () => {
    const { preview, retention, verificationDelivery, breachScan } = configurationFixtures();
    writeFileSync(
      breachScan,
      readFileSync(breachScan, "utf8").replace(
        '"SCAN_KILL_SWITCH": "true"',
        '"SCAN_KILL_SWITCH": "false"',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery, breachScan)).toThrow(
      "BREACH_SCAN:KILL_SWITCH_DEFAULT_ON",
    );
  });

  it("rejects enabling the hosted synthetic scan flag in the committed template", () => {
    const { preview, retention, verificationDelivery, breachScan } = configurationFixtures();
    writeFileSync(
      breachScan,
      readFileSync(breachScan, "utf8").replace(
        '"SCAN_SYNTHETIC_ENABLED": "false"',
        '"SCAN_SYNTHETIC_ENABLED": "true"',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery, breachScan)).toThrow(
      "BREACH_SCAN:SYNTHETIC_DEFAULT_OFF",
    );
  });

  it("rejects changing the reviewed server-only alias", () => {
    const { preview, retention, verificationDelivery, breachScan } = configurationFixtures();
    writeFileSync(
      breachScan,
      readFileSync(breachScan, "utf8").replace(
        '"./workers/server-only-noop.ts"',
        '"./workers/unknown.ts"',
      ),
    );

    expect(() => verify(preview, retention, verificationDelivery, breachScan)).toThrow(
      "BREACH_SCAN:SERVER_ONLY_ALIAS",
    );
  });
});
