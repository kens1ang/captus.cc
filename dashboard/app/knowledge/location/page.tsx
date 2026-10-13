import { ActionForm, FormFooter } from "@/components/forms";
import { Card, Field, Page, PageHeader, SettingsRow } from "@/components/ui";
import { getBusinessHours, getBusinessInfo, getSettings } from "@/lib/data";
import { saveLocation } from "../actions";
import { HoursEditor } from "./HoursEditor";

export const metadata = { title: "Location & hours" };

export default async function LocationPage() {
  const [info, hours, settings] = await Promise.all([getBusinessInfo(), getBusinessHours(), getSettings()]);
  const loc = info.sections.location?.data;

  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Location & hours"
        description="Where to find you, how to reach you, and when you're open. Included in every reply — these are the questions customers ask most."
      />
      <Card>
        <ActionForm action={saveLocation}>
          <div className="divide-y divide-line">
            <SettingsRow title="Opening hours" description={`Times are in your business's timezone (${settings.timezone}). Also used for bookings.`}>
              <HoursEditor initial={hours} />
              <Field label="Holidays & exceptions" optional htmlFor="hoursNotes">
                <textarea
                  id="hoursNotes"
                  name="hoursNotes"
                  defaultValue={loc?.hoursNotes}
                  rows={2}
                  placeholder="e.g. Closed on public holidays. Last order 30 minutes before closing."
                  className="control"
                />
              </Field>
            </SettingsRow>

            <SettingsRow title="Location" description="Leave blank if you're online-only.">
              <Field label="Address" htmlFor="address">
                <input id="address" name="address" defaultValue={loc?.address} placeholder="e.g. 12 Jalan Telawi 3, Bangsar, 59100 Kuala Lumpur" className="control" />
              </Field>
              <Field label="Directions & parking" optional htmlFor="directions">
                <textarea
                  id="directions"
                  name="directions"
                  defaultValue={loc?.directions}
                  rows={2}
                  placeholder="e.g. Opposite the 7-Eleven. Street parking, or Bangsar Village basement (2 min walk)."
                  className="control"
                />
              </Field>
              <Field label="Service or delivery area" optional htmlFor="serviceArea">
                <input id="serviceArea" name="serviceArea" defaultValue={loc?.serviceArea} placeholder="e.g. Klang Valley only" className="control" />
              </Field>
            </SettingsRow>

            <SettingsRow title="Contact details" description="Shared when a customer asks how to reach you another way.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" htmlFor="phone">
                  <input id="phone" name="phone" defaultValue={loc?.phone} placeholder="+60 3-1234 5678" className="control" />
                </Field>
                <Field label="Email" htmlFor="email">
                  <input id="email" name="email" type="email" defaultValue={loc?.email} placeholder="hello@yourbusiness.com" className="control" />
                </Field>
                <Field label="Website" htmlFor="website">
                  <input id="website" name="website" defaultValue={loc?.website} placeholder="yourbusiness.com" className="control" />
                </Field>
                <Field label="Social media" htmlFor="socials">
                  <input id="socials" name="socials" defaultValue={loc?.socials} placeholder="@yourbusiness on Instagram" className="control" />
                </Field>
              </div>
            </SettingsRow>
          </div>
          <FormFooter />
        </ActionForm>
      </Card>
    </Page>
  );
}
