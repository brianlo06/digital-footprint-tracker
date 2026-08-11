import { readFileSync } from "node:fs";

const path = ".open-next/cloudflare/next-env.mjs";
const source = readFileSync(path, "utf8");
const assignments = [...source.matchAll(/^export const (production|development|test) = (.+);$/gm)];

if (assignments.length !== 3) {
  throw new Error("CLOUDFLARE_BUILD_ENV_MANIFEST_INVALID");
}

for (const [, mode, serializedEnvironment] of assignments) {
  const environment = JSON.parse(serializedEnvironment);
  if (Object.keys(environment).length > 0) {
    throw new Error(`CLOUDFLARE_BUILD_EMBEDDED_ENV_FORBIDDEN:${mode}`);
  }
}
