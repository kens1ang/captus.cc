import { ActionForm, FormFooter } from "@/components/forms";
import { Card, Field, Notice, Page, PageHeader, SettingsRow } from "@/components/ui";
import { ASSISTANT_TONES, getBusinessInfo } from "@/lib/data";
import { saveAssistant } from "@/app/knowledge/actions";

export const metadata = { title: "Assistant" };

const INSTRUCTIONS_PLACEHOLDER = `e.g.
- Always suggest our signature cheesecake when someone asks for dessert.
- Don't discuss competitor prices.
- Sign off with "— Team Kopi Corner".`;

export default async function AssistantSettingsPage() {
  const info = await getBusinessInfo();
  const assistant = info.sections.assistant?.data;
  const tone = assistant?.tone ?? "friendly";

  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Assistant"
        description="How your assistant sounds and behaves. What it knows comes from the Knowledge pages."
      />

      <Card>
        <ActionForm action={saveAssistant}>
          <div className="divide-y divide-line">
            <SettingsRow title="Tone of voice" description="Applies to every reply.">
              <div className="grid gap-2 sm:grid-cols-2">
                {ASSISTANT_TONES.map((t) => (
                  <label
                    key={t.value}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition-colors hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft/50"
                  >
                    <input type="radio" name="tone" value={t.value} defaultChecked={tone === t.value} className="mt-0.5 accent-brand" />
                    <span>
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-xs text-muted">{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </SettingsRow>

            <SettingsRow title="Languages" description="The assistant replies in the customer's language when it's one of these.">
              <input name="languages" defaultValue={assistant?.languages} placeholder="e.g. English, Bahasa Melayu, Chinese" className="control" />
            </SettingsRow>

            <SettingsRow
              title="Special instructions"
              description="Anything else it should always or never do. Write it like you're briefing a new staff member."
            >
              <Field
                label="Instructions"
                optional
                htmlFor="instructions"
                hint="Safety rules can't be overridden — the assistant still never invents prices or facts, and still hands tricky chats to you."
              >
                <textarea
                  id="instructions"
                  name="instructions"
                  defaultValue={assistant?.instructions}
                  rows={6}
                  maxLength={3000}
                  placeholder={INSTRUCTIONS_PLACEHOLDER}
                  className="control"
                />
              </Field>
            </SettingsRow>
          </div>
          <FormFooter />
        </ActionForm>
      </Card>

      <Notice tone="info">Changes apply from the assistant&apos;s next reply — no restart needed.</Notice>
    </Page>
  );
}
