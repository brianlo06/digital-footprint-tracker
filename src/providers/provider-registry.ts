import "server-only";

import type { ServerEnv } from "@/config/server-env";
import {
  createSyntheticBreachProvider,
  type SyntheticBreachInput,
} from "@/providers/breach/synthetic-breach-provider";
import type { SyntheticBreachScenario } from "@/providers/breach/synthetic-fixtures";
import type { FootprintProvider } from "@/providers/provider.contracts";

export interface BreachProviderSelection {
  readonly status: "DISABLED" | "ENABLED_SYNTHETIC";
  readonly provider?: FootprintProvider<SyntheticBreachInput, unknown>;
}

export interface BreachProviderRegistryConfig {
  readonly appEnvironment: "local" | "preview" | "production";
  readonly provider: "disabled" | "synthetic";
  readonly featureEnabled: boolean;
  readonly killSwitchActive: boolean;
  readonly syntheticScenario?: SyntheticBreachScenario;
}

export function selectBreachProvider(
  config: BreachProviderRegistryConfig,
): BreachProviderSelection {
  if (config.provider === "synthetic" && config.appEnvironment !== "local") {
    throw new Error("SYNTHETIC_BREACH_PROVIDER_LOCAL_ONLY");
  }

  if (!config.featureEnabled || config.killSwitchActive || config.provider === "disabled") {
    return { status: "DISABLED" };
  }

  return {
    status: "ENABLED_SYNTHETIC",
    provider: createSyntheticBreachProvider(config.syntheticScenario),
  };
}

export function selectBreachProviderFromEnv(
  env: Pick<
    ServerEnv,
    "APP_ENV" | "BREACH_PROVIDER" | "FEATURE_BREACH_SCAN" | "BREACH_PROVIDER_KILL_SWITCH"
  >,
  syntheticScenario?: SyntheticBreachScenario,
): BreachProviderSelection {
  return selectBreachProvider({
    appEnvironment: env.APP_ENV,
    provider: env.BREACH_PROVIDER,
    featureEnabled: env.FEATURE_BREACH_SCAN,
    killSwitchActive: env.BREACH_PROVIDER_KILL_SWITCH,
    syntheticScenario,
  });
}
