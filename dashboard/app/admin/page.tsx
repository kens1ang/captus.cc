import { backendFetch } from "@/lib/backend";
import { createTenant, linkClient, updateWabaId } from "./actions";

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
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string | null;
  users: TenantUser[];
}

export default async function AdminPage() {
  const tenants = await backendFetch<Tenant[]>("/api/admin/tenants");

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-8">
      <h1 className="text-lg font-semibold">Admin — businesses</h1>

      <form action={createTenant} className="flex flex-col gap-2 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-medium">New business</h2>
        <input
          name="businessName"
          placeholder="Business name"
          className="border border-gray-300 rounded px-3 py-2 text-sm"
          required
        />
        <input
          name="businessDescription"
          placeholder="Short description (used by the bot to answer questions)"
          className="border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="whatsappPhoneNumberId"
          placeholder="WhatsApp phone number id"
          className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          required
        />
        <input
          name="whatsappBusinessAccountId"
          placeholder="WhatsApp Business Account (WABA) id — from WhatsApp Manager > API Setup, next to the phone number id"
          className="border border-gray-300 rounded px-3 py-2 text-sm font-mono"
        />
        <button type="submit" className="self-start px-4 py-2 rounded bg-gray-900 text-white text-sm">
          Create
        </button>
      </form>

      <ul className="flex flex-col gap-4">
        {tenants.map((t) => (
          <li key={t.id} className="border border-gray-200 rounded p-4 flex flex-col gap-3">
            <div>
              <p className="font-medium">{t.businessName}</p>
              <p className="text-xs text-gray-400 font-mono">{t.whatsappPhoneNumberId}</p>
            </div>

            <div className="text-xs">
              {t.whatsappBusinessAccountId ? (
                <p className="text-gray-400 font-mono">WABA: {t.whatsappBusinessAccountId}</p>
              ) : (
                <form action={updateWabaId.bind(null, t.id)} className="flex gap-2">
                  <input
                    name="whatsappBusinessAccountId"
                    placeholder="WABA id (needed for booking reminders)"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 font-mono"
                    required
                  />
                  <button type="submit" className="px-2 py-1 rounded bg-gray-900 text-white">
                    Save
                  </button>
                </form>
              )}
            </div>

            <ul className="text-sm flex flex-col gap-1">
              {t.users.map((u) => (
                <li key={u.id} className="flex gap-2 items-center">
                  <span>{u.email}</span>
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{u.role}</span>
                  {u.isAdmin && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">admin</span>}
                </li>
              ))}
              {t.users.length === 0 && <li className="text-gray-400">No linked users yet.</li>}
            </ul>

            <form action={linkClient.bind(null, t.id)} className="flex gap-2">
              <input
                name="email"
                type="email"
                placeholder="client@example.com — they must have signed up already"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                required
              />
              <select name="role" defaultValue="owner" className="border border-gray-300 rounded px-2 py-2 text-sm">
                <option value="owner">owner</option>
                <option value="staff">staff</option>
              </select>
              <button type="submit" className="px-3 py-2 rounded bg-gray-900 text-white text-sm">
                Link
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
