const LOOKUP_NAMESPACES = {
  EMAIL: "identifier:email:v1",
} as const;

export function identifierLookupNamespace(type: keyof typeof LOOKUP_NAMESPACES): string {
  return LOOKUP_NAMESPACES[type];
}
