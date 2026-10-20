import { Building2, UserPlus } from "lucide-react";
import { ActionForm, FormFooter } from "@/components/forms";
import { Badge, Card, CardHeader, EmptyState, Field, Page, PageHeader } from "@/components/ui";
import { backendFetch } from "@/lib/backend";
import { createTenant, linkClient, updatePhoneNumberId, updateWabaId } from "./actions";

export const metadata = { title: "All businesses" };

interface TenantUser {
  id: string;
  email: string;
  role: string;
  isAdmin: boolean;
}

interface Tenant {
  id: string;
  businessName: string;
  businessDescription: string;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  users: TenantUser[];
}

export default async function AdminPage() {
  const tenants = await backendFetch<Tenant[]>("/api/admin/tenants");

  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="All businesses" description="Onboard new clients and manage who can sign in to each business." />

      <Card>
        <CardHeader title="Add a business" description="Creates the tenant. Its owner fills in everything else from their own dashboard." />
        <ActionForm action={createTenant} resetOnSuccess>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Business name" htmlFor="t-name">
              <input id="t-name" name="businessName" required className="control" />
            </Field>
            <Field label="Short description" optional htmlFor="t-desc">
              <input id="t-desc" name="businessDescription" className="control" />
            </Field>
            <Field label="WhatsApp phone number ID" htmlFor="t-phone" hint="Meta › WhatsApp Manager › API Setup">
              <input id="t-phone" name="whatsappPhoneNumberId" required className="control font-mono" />
            </Field>
            <Field label="WhatsApp Business Account ID" optional htmlFor="t-waba" hint="Needed for booking reminders. Shown next to the phone number ID.">
              <input id="t-waba" name="whatsappBusinessAccountId" className="control font-mono" />
            </Field>
          </div>
          <FormFooter submitLabel="Create business" pendingText="Creating…" />
        </ActionForm>
      </Card>

      {tenants.length === 0 ? (
        <Card>
          <EmptyState icon={Building2} title="No businesses yet" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tenants.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardHeader
                title={t.businessName}
                description={
                  t.whatsappPhoneNumberId ? (
                    <span className="font-mono text-xs">{t.whatsappPhoneNumberId}</span>
                  ) : (
                    "Signed up on their own — no WhatsApp number yet"
                  )
                }
                actions={
                  !t.whatsappPhoneNumberId ? (
                    <Badge tone="warn">No number</Badge>
                  ) : t.whatsappBusinessAccountId ? (
                    <Badge tone="brand">WABA set</Badge>
                  ) : (
                    <Badge tone="warn">No WABA</Badge>
                  )
                }
              />
              <div className="flex flex-1 flex-col gap-4 px-5 py-4">
                {!t.whatsappPhoneNumberId && (
                  <ActionForm action={updatePhoneNumberId.bind(null, t.id)} className="flex gap-2">
                    <input name="whatsappPhoneNumberId" required placeholder="WhatsApp phone number ID" className="control font-mono" />
                    <FormFooter submitLabel="Connect" className="rounded-none border-0 bg-transparent p-0" />
                  </ActionForm>
                )}
                {!t.whatsappBusinessAccountId && (
                  <ActionForm action={updateWabaId.bind(null, t.id)} className="flex gap-2">
                    <input name="whatsappBusinessAccountId" required placeholder="WABA ID (for booking reminders)" className="control font-mono" />
                    <FormFooter submitLabel="Save" className="rounded-none border-0 bg-transparent p-0" />
                  </ActionForm>
                )}
                <div>
                  <p className="mb-2 text-xs font-medium tracking-wider text-faint uppercase">People</p>
                  {t.users.length === 0 ? (
                    <p className="text-sm text-muted">No one linked yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {t.users.map((u) => (
                        <li key={u.id} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{u.email}</span>
                          <Badge>{u.role}</Badge>
                          {u.isAdmin && <Badge tone="warn">admin</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <ActionForm action={linkClient.bind(null, t.id)} resetOnSuccess className="border-t border-line">
                <div className="flex gap-2 px-5 pt-4">
                  <input name="email" type="email" required placeholder="client@example.com (must have signed up)" className="control" />
                  <select name="role" defaultValue="owner" className="control w-28">
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                  </select>
                </div>
                <FormFooter submitLabel="Link" pendingText="Linking…" className="border-0 bg-transparent">
                  <UserPlus className="mr-auto size-4 text-faint" />
                </FormFooter>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
