"use client";

import type { ActionState } from "@/lib/actionState";
import type { FaqsData } from "@/lib/data";
import { ListEditor } from "../ListEditor";

const SUGGESTED_QUESTIONS = [
  "Do you take walk-ins or do I need to book?",
  "Is there parking nearby?",
  "Is your food halal?",
  "Do you deliver?",
  "Can I pay by card or e-wallet?",
  "Are you open on public holidays?",
  "Do you have vegetarian options?",
  "Is there a minimum order?",
  "How long does it take?",
  "Do you offer gift cards or vouchers?",
  "Are kids / pets allowed?",
  "Do you do corporate or bulk orders?",
];

export function FaqsEditor({
  action,
  initial,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: FaqsData;
}) {
  return (
    <ListEditor
      action={action}
      initialItems={(initial?.items ?? []).map((i) => ({ ...i }))}
      itemLabel="Question"
      emptyText="No questions yet — start with the ones you answer most often."
      columns={[
        { name: "question", label: "Question", placeholder: "What a customer would ask", required: true },
        { name: "answer", label: "Answer", placeholder: "Your answer, as you'd want the assistant to give it", multiline: true, required: true },
      ]}
      suggestions={SUGGESTED_QUESTIONS.map((q) => ({ label: q, row: { question: q } }))}
    />
  );
}
