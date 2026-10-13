import { ActionForm, FormFooter } from "@/components/forms";
import { Card, Page, PageHeader, SettingsRow } from "@/components/ui";
import { POLICY_FIELDS, getBusinessInfo, type PolicyKey } from "@/lib/data";
import { savePolicies } from "../actions";

export const metadata = { title: "Policies" };

const DESCRIPTIONS: Record<PolicyKey, string> = {
  payment: "Which payment methods you accept, deposits, invoices.",
  delivery: "Areas, fees, timing, pickup options.",
  returns: "When and how customers can return items or get a refund.",
  cancellation: "Notice needed, fees, how to reschedule.",
  warranty: "What's covered and for how long.",
  other: "House rules, age limits, dress code — anything else.",
};

export default async function PoliciesPage() {
  const info = await getBusinessInfo();
  const policies = info.sections.policies?.data;
  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Policies"
        description="The rules customers ask about before they buy. Fill in only what applies to you — blank ones are skipped."
      />
      <Card>
        <ActionForm action={savePolicies}>
          <div className="divide-y divide-line">
            {POLICY_FIELDS.map((f) => (
              <SettingsRow key={f.key} title={f.label} description={DESCRIPTIONS[f.key]}>
                <textarea name={f.key} defaultValue={policies?.[f.key]} rows={3} maxLength={3000} placeholder={f.placeholder} className="control" />
              </SettingsRow>
            ))}
          </div>
          <FormFooter />
        </ActionForm>
      </Card>
    </Page>
  );
}
