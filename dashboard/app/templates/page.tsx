import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ConfirmButton } from "@/components/forms";
import { TemplatePreview } from "@/components/TemplatePreview";
import { Badge, ButtonLink, Card, EmptyState, Notice, Page, PageHeader } from "@/components/ui";
import { getTemplates } from "@/lib/data";
import { STATUS_DISPLAY, isSettling, languageLabel, previewParts, rejectionText } from "@/lib/templates";
import { deleteTemplateAction } from "./actions";

export const metadata = { title: "Message templates" };

const CATEGORY_LABEL = { MARKETING: "Marketing", UTILITY: "Utility", AUTHENTICATION: "Authentication" } as const;

export default async function TemplatesPage(props: PageProps<"/templates">) {
  const searchParams = await props.searchParams;
  const { wabaId, templates, reminderTemplateName } = await getTemplates();
  const visible = templates.filter((t) => t.status !== "DELETED");
  const settling = visible.some((t) => isSettling(t.status));

  return (
    <Page wide>
      <PageHeader
        title="Message templates"
        description="Pre-approved messages for starting a conversation or messaging customers after 24 hours — reminders, order updates, promotions. Meta reviews each one before it can be sent."
        actions={
          wabaId && (
            <ButtonLink href="/templates/new" variant="primary">
              <Plus className="size-4" /> New template
            </ButtonLink>
          )
        }
      />

      {/* Meta reviews in minutes to hours — keep checking while anything is in review so the status flips here on its own. */}
      {settling && <AutoRefresh intervalMs={10_000} />}

      {searchParams.created && (
        <Notice tone="info">
          Submitted to Meta for review. Most templates are approved within a few minutes — this page updates automatically.
        </Notice>
      )}

      {!wabaId ? (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title="WhatsApp Business Account not linked"
            description="Templates belong to your WhatsApp Business Account. Ask your Captus admin to add its ID to your business, then manage templates here."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquareText}
            title="No templates yet"
            description="Create one to send booking reminders, order updates or promotions outside the 24-hour reply window."
            action={
              <ButtonLink href="/templates/new" variant="primary">
                <Plus className="size-4" /> New template
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((t) => {
            const status = STATUS_DISPLAY[t.status] ?? { label: t.status, tone: "neutral" as const };
            const rejection = t.status === "REJECTED" ? rejectionText(t.rejected_reason) : null;
            const isReminder = t.name === reminderTemplateName;
            return (
              <Card key={t.id} className="flex flex-col overflow-hidden">
                <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-medium">{t.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone} dot>
                        {status.label}
                      </Badge>
                      <Badge>{CATEGORY_LABEL[t.category] ?? t.category}</Badge>
                      <Badge>{languageLabel(t.language)}</Badge>
                      {isReminder && <Badge tone="info">Booking reminders</Badge>}
                    </div>
                  </div>
                  <ConfirmButton
                    action={deleteTemplateAction.bind(null, t.id, t.name)}
                    confirmText={
                      isReminder
                        ? `Delete "${t.name}"? Captus uses this template to send booking reminders — they'll stop sending. The name can't be reused for 30 days.`
                        : `Delete "${t.name}" (${languageLabel(t.language)})? It's removed from WhatsApp too, and the name can't be reused for 30 days.`
                    }
                    title="Delete template"
                  >
                    <Trash2 className="size-3.5" />
                  </ConfirmButton>
                </div>
                {rejection && (
                  <p className="border-b border-line bg-danger-soft px-5 py-2.5 text-sm text-danger">
                    <span className="font-medium">Rejected:</span> {rejection}
                  </p>
                )}
                <div className="flex-1 bg-wa-chat px-5 py-5">
                  <TemplatePreview {...previewParts(t)} compact />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
