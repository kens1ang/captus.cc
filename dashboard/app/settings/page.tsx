import { ActionForm, FormFooter } from "@/components/forms";
import { Card, CardHeader, Page, PageHeader, SettingsRow } from "@/components/ui";
import { getMe, getSettings } from "@/lib/data";
import { updateTimezone } from "./actions";
import { TimezoneSelect } from "./TimezoneSelect";

export default async function GeneralSettingsPage() {
  const [me, settings] = await Promise.all([getMe(), getSettings()]);
  return (
    <Page>
      <PageHeader eyebrow="Settings" title="General" description="Account-wide settings for your business." />

      <Card>
        <ActionForm action={updateTimezone}>
          <SettingsRow
            title="Timezone"
            description="Your opening hours and bookings are read in this timezone, and the assistant uses it to understand “today” or “next Tuesday”."
          >
            <TimezoneSelect value={settings.timezone} />
          </SettingsRow>
          <FormFooter />
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Your account" />
        <div className="divide-y divide-line">
          <SettingsRow title="Signed in as">
            <p className="text-sm">{me.email}</p>
          </SettingsRow>
          <SettingsRow title="Role" description="Owners and staff can both manage conversations and knowledge.">
            <p className="text-sm capitalize">{me.isAdmin ? "Admin" : me.role}</p>
          </SettingsRow>
        </div>
      </Card>
    </Page>
  );
}
