import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export function normalizeEmail(value: string): string {
  return emailSchema.parse(value);
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  const lastDot = domain.lastIndexOf(".");
  const suffix = lastDot >= 0 ? domain.slice(lastDot) : "";
  return `${local.slice(0, 1)}***@***${suffix}`;
}
