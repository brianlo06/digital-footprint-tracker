import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

export function AuthProvider({
  mode,
  clerkPublishableKey,
  children,
}: {
  mode: "disabled" | "local" | "clerk";
  clerkPublishableKey?: string;
  children: ReactNode;
}) {
  return mode === "clerk" ? (
    <ClerkProvider dynamic publishableKey={clerkPublishableKey}>
      {children}
    </ClerkProvider>
  ) : (
    children
  );
}
