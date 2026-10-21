/** Cookie names for the collapsible side panels. Cookies (not localStorage) so the server renders the right width and there's no flash on load. */
export const SIDEBAR_COOKIE = "captus.sidebarCollapsed";
export const SUBNAV_COOKIE = "captus.subnavCollapsed";

/** Remember a panel's collapsed state for a year; read back on the server by lib/panelPrefs. */
export function saveCollapsed(name: string, collapsed: boolean) {
  document.cookie = `${name}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}
