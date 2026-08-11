export { authenticationProxy as proxy } from "@/security/proxy";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
