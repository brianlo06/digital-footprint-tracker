import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "@/app/ui/auth-provider";

describe("authentication provider", () => {
  it("enables Clerk's dynamic nonce propagation in managed-auth mode", () => {
    const rendered = AuthProvider({
      mode: "clerk",
      clerkPublishableKey: "pk_test_synthetic",
      children: "protected content",
    });

    expect(isValidElement(rendered)).toBe(true);
    const provider = rendered as ReactElement<{
      dynamic?: boolean;
      publishableKey?: string;
      children?: unknown;
    }>;
    expect(provider.props).toMatchObject({
      dynamic: true,
      publishableKey: "pk_test_synthetic",
      children: "protected content",
    });
  });

  it("does not load Clerk outside managed-auth mode", () => {
    expect(
      AuthProvider({ mode: "local", clerkPublishableKey: undefined, children: "local content" }),
    ).toBe("local content");
  });
});
