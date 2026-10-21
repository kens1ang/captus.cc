import { cookies } from "next/headers";

export { SIDEBAR_COOKIE, SUBNAV_COOKIE } from "./panelPrefsClient";

export async function isCollapsed(name: string): Promise<boolean> {
  return (await cookies()).get(name)?.value === "1";
}
