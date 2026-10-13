"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY_LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/history", label: "History" },
  { href: "/identities", label: "My identifiers" },
  { href: "/settings/privacy", label: "Privacy" },
] as const;

export function PrimaryNavLinks() {
  const pathname = usePathname();
  return PRIMARY_LINKS.map((link) => (
    <Link
      aria-current={pathname === link.href ? "page" : undefined}
      href={link.href}
      key={link.href}
    >
      {link.label}
    </Link>
  ));
}
