import { getAuthGateway } from "@/security/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  if (process.env.AUTH_MODE === "disabled") redirect("/preview");
  if (!(await getAuthGateway().currentPrincipal())) redirect("/");

  return children;
}
