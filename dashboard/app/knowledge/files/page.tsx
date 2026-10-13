import { FileImage, FileSpreadsheet, FileText, FolderOpen, Trash2 } from "lucide-react";
import { ActionForm, ConfirmButton, FormFooter } from "@/components/forms";
import { Card, CardHeader, EmptyState, Field, Page, PageHeader } from "@/components/ui";
import { formatRelative } from "@/lib/formatDate";
import { getDocuments, getSettings } from "@/lib/data";
import { deleteDocumentAction, uploadDocument } from "../actions";

export const metadata = { title: "Files" };

function iconFor(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("csv")) return FileSpreadsheet;
  return FileText;
}

export default async function FilesPage() {
  const [documents, settings] = await Promise.all([getDocuments(), getSettings()]);

  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Files"
        description="Menus, catalogs and price lists the assistant can send on WhatsApp when a customer asks — e.g. “can I see your menu?”."
      />

      <Card>
        <CardHeader title="Upload a file" description="PDF, image or spreadsheet, up to 15 MB." />
        <ActionForm action={uploadDocument} resetOnSuccess>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name" htmlFor="doc-name" hint="What customers would call it — the assistant matches requests to this.">
              <input id="doc-name" name="name" required placeholder="e.g. Menu, Price list, Catalog 2026" className="control" />
            </Field>
            <Field label="Description" optional htmlFor="doc-description" hint="Helps the assistant pick the right file.">
              <input id="doc-description" name="description" placeholder="e.g. Full food & drinks menu with prices" className="control" />
            </Field>
            <div className="sm:col-span-2">
              <label
                htmlFor="doc-file"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-canvas/50 px-6 py-8 text-center transition-colors hover:border-brand/60 hover:bg-brand-soft/30"
              >
                <FolderOpen className="size-6 text-faint" />
                <span className="text-sm font-medium">Choose a file</span>
                <input
                  id="doc-file"
                  name="file"
                  type="file"
                  required
                  accept=".pdf,image/*,.xls,.xlsx,.csv,.doc,.docx"
                  className="max-w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
                />
              </label>
            </div>
          </div>
          <FormFooter submitLabel="Upload" pendingText="Uploading…" />
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Your files" description={`${documents.length} ${documents.length === 1 ? "file" : "files"}`} />
        {documents.length === 0 ? (
          <EmptyState icon={FileText} title="No files yet" description="Upload your menu or price list so the assistant can send it." />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((d) => {
              const Icon = iconFor(d.mimeType);
              return (
                <li key={d.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.name}</p>
                    <p className="truncate text-xs text-muted">
                      {d.description ? `${d.description} · ` : ""}
                      <span className="font-mono">{d.filename}</span> · {formatRelative(d.createdAt, settings.timezone)}
                    </p>
                  </div>
                  <ConfirmButton action={deleteDocumentAction.bind(null, d.id)} confirmText={`Delete "${d.name}"? The assistant won't be able to send it any more.`} title="Delete file">
                    <Trash2 className="size-3.5" />
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
}
