import { SubNav } from "@/components/shell/SubNav";

export const metadata = { title: "Settings" };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <SubNav
        title="Settings"
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
