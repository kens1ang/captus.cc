import { StickyNote, Trash2 } from "lucide-react";
import { ActionForm, ConfirmButton, FormFooter } from "@/components/forms";
import { Card, CardHeader, EmptyState, Page, PageHeader } from "@/components/ui";
import { formatRelative } from "@/lib/formatDate";
import { getKnowledgeChunks, getSettings } from "@/lib/data";
import { addNote, deleteNote } from "../actions";

export const metadata = { title: "Other notes" };

export default async function NotesPage() {
  const [chunks, settings] = await Promise.all([getKnowledgeChunks(), getSettings()]);
  // Section-generated chunks are managed on their own pages; this page is
  // only for free-form text pasted here (or ingested from a file).
  const notes = chunks.filter((c) => !c.source?.startsWith("section:"));

  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Other notes"
        description="Anything that doesn't fit the other pages — paste an existing FAQ document, current promotions, background on your team. Long text is split into searchable entries automatically."
      />

      <Card>
        <CardHeader title="Add a note" description="Separate topics with a blank line — each paragraph becomes its own entry." />
        <ActionForm action={addNote} resetOnSuccess>
          <div className="p-5">
            <textarea
              name="text"
              rows={6}
              required
              placeholder={"e.g. October promotion: buy 2 cakes, get 1 free, until 31 Oct.\n\nOur head baker trained at Le Cordon Bleu and has 15 years' experience."}
              className="control"
            />
          </div>
          <FormFooter submitLabel="Add note" pendingText="Adding…" />
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Saved notes" description={`${notes.length} ${notes.length === 1 ? "entry" : "entries"}`} />
        {notes.length === 0 ? (
          <EmptyState icon={StickyNote} title="No notes yet" description="Notes you add appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {notes.map((c) => (
              <li key={c.id} className="flex gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-wrap">{c.content}</p>
                  <p className="mt-1.5 text-xs text-faint">
                    Added {formatRelative(c.createdAt, settings.timezone)}
                    {c.source && c.source !== "dashboard" && ` · from ${c.source}`}
                  </p>
                </div>
                <ConfirmButton action={deleteNote.bind(null, c.id)} confirmText="Delete this note? The assistant will stop using it." title="Delete note">
                  <Trash2 className="size-3.5" />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
