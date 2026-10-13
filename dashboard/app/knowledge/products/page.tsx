import { Card, Page, PageHeader } from "@/components/ui";
import { getBusinessInfo } from "@/lib/data";
import { saveListSection } from "../actions";
import { ProductsEditor } from "./ProductsEditor";

export const metadata = { title: "Products & services" };

export default async function ProductsPage() {
  const info = await getBusinessInfo();
  return (
    <Page>
      <PageHeader
        eyebrow="Knowledge"
        title="Products & services"
        description="What you sell and what it costs. The assistant quotes prices only from this list — it never estimates."
      />
      <Card>
        <ProductsEditor action={saveListSection.bind(null, "products")} initial={info.sections.products?.data} />
      </Card>
    </Page>
  );
}
