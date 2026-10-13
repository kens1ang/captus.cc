import { MessageCircle } from "lucide-react";
import { GoogleCalendarCard } from "@/components/GoogleCalendarCard";
import { Badge, Card, Page, PageHeader } from "@/components/ui";
import { getGoogleStatus, getMe } from "@/lib/data";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: PageProps<"/settings/integrations">) {
  const searchParams = await props.searchParams;
  const result = typeof searchParams.google === "string" ? searchParams.google : undefined;
  const [me, google] = await Promise.all([getMe(), getGoogleStatus()]);

  return (
    <Page>
      <PageHeader eyebrow="Settings" title="Integrations" description="Services your assistant is connected to." />

      <Card>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle">
            <MessageCircle className="size-5 text-brand" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">WhatsApp Business</p>
              <Badge tone="brand" dot>
                Connected
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              Phone number ID <span className="font-mono text-xs">{me.whatsappPhoneNumberId}</span>. Managed by Captus — contact us to change numbers.
            </p>
          </div>
        </div>
      </Card>

      <GoogleCalendarCard google={google} result={result} />
    </Page>
  );
}
