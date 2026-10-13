import { Card, Page, PageHeader } from "@/components/ui";
import { getBusinessInfo } from "@/lib/data";
import { saveListSection } from "../actions";
import { FaqsEditor } from "./FaqsEditor";

export const metadata = { title: "FAQs" };

export default async function FaqsPage() {
  const info = await getBusinessInfo();
  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Frequently asked questions"
        description="Questions customers ask, with the exact answer you want them to get. Each one is matched to similar questions, so you don't need every wording."
      />
      <Card>
        <FaqsEditor action={saveListSection.bind(null, "faqs")} initial={info.sections.faqs?.data} />
      </Card>
    </Page>
  );
}
