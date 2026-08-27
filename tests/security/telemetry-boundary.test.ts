import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const workersRoot = join(process.cwd(), "workers");
const loggerPath = join(sourceRoot, "security", "logger.ts");
const productionSourceRoots = [sourceRoot, workersRoot] as const;
const workerConfigurations = [
  "wrangler.jsonc",
  "wrangler.retention.example.jsonc",
  "wrangler.verification-delivery.example.jsonc",
  "wrangler.breach-scan.example.jsonc",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith(".ts") || path.endsWith(".tsx")
        ? [path]
        : [];
  });
}

describe("closed telemetry boundary", () => {
  it("routes application and standalone Worker logging through the centralized sanitizer", () => {
    const forbiddenPatterns = [
      /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/,
      /\bprocess\.(?:stderr|stdout)\./,
      /from\s+["'](?:@sentry\/|@opentelemetry\/|dd-trace|newrelic)/,
    ];
    const paths = productionSourceRoots.flatMap(sourceFiles);

    expect(paths).toContain(join(workersRoot, "verification-delivery.ts"));
    expect(paths).toContain(join(workersRoot, "breach-scan.ts"));

    for (const path of paths) {
      if (path === loggerPath) continue;

      const source = readFileSync(path, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(source, `${relative(process.cwd(), path)} matched ${String(pattern)}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("keeps automatic invocation logs and application traces disabled for every Worker", () => {
    for (const configuration of workerConfigurations) {
      const config = readFileSync(join(process.cwd(), configuration), "utf8");

      expect(config, configuration).toMatch(/"invocation_logs"\s*:\s*false/);
      expect(config, configuration).toMatch(/"traces"\s*:\s*\{\s*"enabled"\s*:\s*false/);
    }
  });
});
