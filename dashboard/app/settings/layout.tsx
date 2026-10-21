import { SubNav } from "@/components/shell/SubNav";
import { isCollapsed, SUBNAV_COOKIE } from "@/lib/panelPrefs";

export const metadata = { title: "Settings" };

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <SubNav
        title="Settings"
        defaultCollapsed={await isCollapsed(SUBNAV_COOKIE)}
        items={[
          { href: "/settings", label: "General" },
          { href: "/settings/assistant", label: "Assistant" },
          { href: "/settings/integrations", label: "Integrations" },
        ]}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
