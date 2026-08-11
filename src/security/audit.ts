import "server-only";

import { auditEvents } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";

export interface AuditEventInput {
  readonly userId: string | null;
  readonly actorType: "USER" | "SYSTEM" | "OPERATOR";
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
  readonly correlationId: string;
}

export async function appendAuditEvent(
  principal: AuthenticatedPrincipal,
  input: AuditEventInput,
): Promise<void> {
  await withTenantDatabase(principal, async (transaction) => {
    await transaction.insert(auditEvents).values({
      userId: input.userId,
      actorType: input.actorType,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      outcome: input.outcome,
      correlationId: input.correlationId,
    });
  });
}
