import { Tabs } from "@/components/shell/Tabs";
import { Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Bookings" };

export default function BookingsLayout({ children }: LayoutProps<"/bookings">) {
  return (
    <Page wide>
      <div className="flex flex-col gap-6">
        <PageHeader bordered={false} title="Bookings" description="Appointments customers book over WhatsApp. The assistant checks your calendar before offering any time." />
        <Tabs
          items={[
            { href: "/bookings", label: "Upcoming" },
            { href: "/bookings/setup", label: "Setup" },
          ]}
        />
      </div>
      {children}
    </Page>
  );
}
