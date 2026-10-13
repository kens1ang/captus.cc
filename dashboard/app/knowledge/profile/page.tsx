import { ActionForm, FormFooter } from "@/components/forms";
import { Card, Field, Page, PageHeader, SettingsRow } from "@/components/ui";
import { getBusinessInfo } from "@/lib/data";
import { saveProfile } from "../actions";

export const metadata = { title: "Business profile" };

export default async function ProfilePage() {
  const info = await getBusinessInfo();
  const profile = info.sections.profile?.data;

  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Business profile"
        description="The basics your assistant introduces you with. It's included in every reply, so keep it short and accurate."
      />
      <Card>
        <ActionForm action={saveProfile}>
          <div className="divide-y divide-line">
            <SettingsRow title="Business name" description="How the assistant refers to you.">
              <input name="businessName" defaultValue={info.businessName} required maxLength={200} className="control" />
            </SettingsRow>
            <SettingsRow
              title="What you do"
              description="Two or three sentences, as you'd explain it to a new customer."
            >
              <Field label="Description" htmlFor="businessDescription" hint="e.g. Family-run café in Bangsar serving specialty coffee, all-day breakfast and homemade cakes since 2015.">
                <textarea
                  id="businessDescription"
                  name="businessDescription"
                  defaultValue={info.businessDescription}
                  rows={4}
                  maxLength={3000}
                  className="control"
                />
              </Field>
            </SettingsRow>
            <SettingsRow title="What makes you different" description="Your selling points — the assistant uses these when customers ask why they should choose you.">
              <textarea
                name="highlights"
                defaultValue={profile?.highlights}
                rows={3}
                maxLength={3000}
                placeholder="e.g. Beans roasted in-house weekly. Halal-certified kitchen. Free Wi-Fi and plenty of power points."
                className="control"
              />
            </SettingsRow>
            <SettingsRow title="Who you serve" description="Helps the assistant pitch answers at the right level.">
              <textarea
                name="audience"
                defaultValue={profile?.audience}
                rows={2}
                maxLength={3000}
                placeholder="e.g. Office workers on weekdays, families on weekends. We also cater corporate events."
                className="control"
              />
            </SettingsRow>
          </div>
          <FormFooter />
        </ActionForm>
      </Card>
    </Page>
  );
}
