// OpenNext currently requires the Edge middleware bundle. Next.js 16's newer
// `proxy.ts` convention is Node-only, so retain the deprecated filename until
// the adapter supports Node proxy bundles.
export { authenticationProxy as middleware } from "@/security/proxy";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
