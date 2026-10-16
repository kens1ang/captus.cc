import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Page, PageHeader } from "@/components/ui";
import { TemplateEditor } from "./TemplateEditor";

export const metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <Link href="/templates" className="inline-flex items-center gap-1 normal-case hover:text-fg">
            <ArrowLeft className="size-3.5" /> Message templates
          </Link>
        }
        title="New template"
        description="Write the message once; Captus submits it to Meta for review and it appears in WhatsApp Manager too."
      />
      <TemplateEditor />
    </Page>
  );
}
