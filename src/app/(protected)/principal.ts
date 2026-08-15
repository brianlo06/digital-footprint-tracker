import type { AuthenticatedPrincipal } from "@/security/auth";
import { getAuthGateway } from "@/security/auth";
import { redirect } from "next/navigation";

/**
 * Page-render authentication uses an ordinary redirect for a signed-out
 * request. Server Actions continue to use requirePrincipal(), whose thrown
 * denial is appropriate for a direct mutation attempt.
 */
export async function requireProtectedPagePrincipal(): Promise<AuthenticatedPrincipal> {
  const principal = await getAuthGateway().currentPrincipal();
  if (!principal) redirect("/");
  return principal;
}
