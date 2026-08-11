export type DestructiveActionAuthorization =
  "AUTHORIZED" | "SUBJECT_MISMATCH" | "REVERIFICATION_REQUIRED";

export function evaluateStrictReverification(
  expectedSubject: string,
  authenticatedSubject: string,
  hasStrictReverification: boolean,
): DestructiveActionAuthorization {
  if (authenticatedSubject !== expectedSubject) return "SUBJECT_MISMATCH";
  if (!hasStrictReverification) return "REVERIFICATION_REQUIRED";
  return "AUTHORIZED";
}
