import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Next's core-web-vitals carries only a subset of the accessibility rules and
  // already registers the jsx-a11y plugin, so take the recommended rules alone.
  // This is a WCAG 2.2 AA guardrail in CI, not a substitute for manual review
  // with a screen reader.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "coverage/**",
    "drizzle/**",
    "cloudflare-env.d.ts",
    "next-env.d.ts",
  ]),
]);
