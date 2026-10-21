import { SubNav } from "@/components/shell/SubNav";
import { TestChatPanel } from "@/components/TestChatPanel";
import { isCollapsed, SUBNAV_COOKIE } from "@/lib/panelPrefs";
import { buildSetupSteps, getBusinessHours, getBusinessInfo, getDocuments, getGoogleStatus, getServices } from "@/lib/data";

export const metadata = { title: "Knowledge" };

export default async function KnowledgeLayout({ children }: LayoutProps<"/knowledge">) {
  const [info, hours, documents, google, services, subnavCollapsed] = await Promise.all([
    getBusinessInfo(),
    getBusinessHours(),
    getDocuments(),
    getGoogleStatus(),
    getServices(),
    isCollapsed(SUBNAV_COOKIE),
  ]);
  const done = Object.fromEntries(buildSetupSteps({ info, hours, documents, google, services }).map((s) => [s.key, s.done]));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <SubNav
        title="Knowledge"
        defaultCollapsed={subnavCollapsed}
        items={[
          { href: "/knowledge", label: "Overview" },
          { href: "/knowledge/profile", label: "Business profile", done: done.profile, group: "Your business" },
          { href: "/knowledge/location", label: "Location & hours", done: done.location, group: "Your business" },
          { href: "/knowledge/products", label: "Products & services", done: done.products, group: "Your business" },
          { href: "/knowledge/policies", label: "Policies", done: done.policies, group: "Your business" },
          { href: "/knowledge/faqs", label: "FAQs", done: done.faqs, group: "Answers" },
          { href: "/knowledge/notes", label: "Other notes", group: "Answers" },
          { href: "/knowledge/files", label: "Files", done: done.files, group: "Answers" },
        ]}
      />
      <div className="min-w-0 flex-1">{children}</div>
      <TestChatPanel />
    </div>
  );
}
