import { selectBreachProvider } from "@/providers/provider-registry";
import { describe, expect, it } from "vitest";

describe("breach provider registry", () => {
  it("defaults to no executable provider", () => {
    expect(
      selectBreachProvider({
        appEnvironment: "local",
        provider: "disabled",
        featureEnabled: false,
        killSwitchActive: true,
      }),
    ).toEqual({ status: "DISABLED" });
  });

  it("keeps the provider disabled when either independent gate is closed", () => {
    expect(
      selectBreachProvider({
        appEnvironment: "local",
        provider: "synthetic",
        featureEnabled: false,
        killSwitchActive: false,
      }),
    ).toEqual({ status: "DISABLED" });
    expect(
      selectBreachProvider({
        appEnvironment: "local",
        provider: "synthetic",
        featureEnabled: true,
        killSwitchActive: true,
      }),
    ).toEqual({ status: "DISABLED" });
  });

  it("selects only the local synthetic adapter when every gate is open", () => {
    const selection = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
    });

    expect(selection.status).toBe("ENABLED_SYNTHETIC");
    expect(selection.provider).toMatchObject({ id: "synthetic-breach", category: "BREACH" });
  });

  it.each(["preview", "production"] as const)(
    "rejects a latent synthetic adapter in %s even when another gate is closed",
    (appEnvironment) => {
      expect(() =>
        selectBreachProvider({
          appEnvironment,
          provider: "synthetic",
          featureEnabled: false,
          killSwitchActive: true,
        }),
      ).toThrow("SYNTHETIC_BREACH_PROVIDER_LOCAL_ONLY");
    },
  );
});
