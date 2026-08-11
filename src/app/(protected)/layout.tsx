import { requirePrincipal } from "@/security/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  try {
    await requirePrincipal();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") redirect("/");
    throw error;
  }

  return children;
}
