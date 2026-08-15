import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const provisioner = readFileSync("scripts/provision-hosted-database-roles.sql", "utf8");

describe("hosted database provisioning boundary", () => {
  it("loads every hosted login password only from a named environment variable", () => {
    expect(provisioner).toContain("\\getenv runtime_password DFT_RUNTIME_DB_PASSWORD");
    expect(provisioner).toContain("\\getenv maintenance_password DFT_MAINTENANCE_DB_PASSWORD");
    expect(provisioner).toContain("\\getenv rotation_password DFT_ROTATION_DB_PASSWORD");
    expect(provisioner).toContain(
      "\\getenv lookup_rotation_password DFT_LOOKUP_ROTATION_DB_PASSWORD",
    );
    expect(provisioner).toContain("\\getenv delivery_password DFT_DELIVERY_DB_PASSWORD");
    expect(provisioner).not.toMatch(/PASSWORD\s+'[^']+'/i);
    expect(provisioner).not.toContain("local_runtime_only");
    expect(provisioner).not.toContain("local_maintenance_only");
    expect(provisioner).not.toContain("local_rotation_only");
    expect(provisioner).not.toContain("local_lookup_rotation_only");
    expect(provisioner).not.toContain("local_delivery_only");
  });

  it("enforces distinct long passwords before beginning a write transaction", () => {
    const validationPosition = provisioner.indexOf("hosted_passwords_valid");
    const transactionPosition = provisioner.indexOf("BEGIN;");

    expect(validationPosition).toBeGreaterThan(0);
    expect(transactionPosition).toBeGreaterThan(validationPosition);
    expect(provisioner).toContain("length(:'runtime_password') >= 32");
    expect(provisioner).toContain("length(:'lookup_rotation_password') >= 32");
    expect(provisioner).toContain("length(:'delivery_password') >= 32");
    expect(provisioner).toContain("AND :'runtime_password' <> :'maintenance_password'");
    expect(provisioner).toContain("AND :'rotation_password' <> :'lookup_rotation_password'");
    expect(provisioner).toContain("AND :'runtime_password' <> :'delivery_password'");
    expect(provisioner).toContain("AND :'lookup_rotation_password' <> :'delivery_password'");
    expect(provisioner).toContain("required hosted database password is unavailable");
  });

  it("keeps capability owners portable to managed PostgreSQL", () => {
    expect(provisioner).toContain("OR actual.rolbypassrls");
    expect(provisioner).toContain("OR actual.rolsuper");
    expect(provisioner.replace(/^--.*$/gm, "")).not.toMatch(/\bBYPASSRLS\b/);
    expect(provisioner).not.toContain("TO CURRENT_USER WITH ADMIN OPTION");
    expect(provisioner).toContain("TO CURRENT_USER;");
  });
});
