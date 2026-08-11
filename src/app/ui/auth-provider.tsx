import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

export function AuthProvider({ mode, children }: { mode: "local" | "clerk"; children: ReactNode }) {
  return mode === "clerk" ? <ClerkProvider>{children}</ClerkProvider> : children;
}
