// Lives outside lib/data.ts so client components (the import card) can use
// it too — see lib/status.ts for why data.ts is server-only.

export const POLICY_FIELDS = [
  { key: "payment", label: "Payment methods", placeholder: "e.g. Cash, card, DuitNow QR, bank transfer. No cheques." },
  { key: "delivery", label: "Delivery & shipping", placeholder: "e.g. Free delivery within 5km for orders over RM50. Same-day if ordered before 2pm." },
  { key: "returns", label: "Returns & refunds", placeholder: "e.g. Unopened items can be returned within 7 days with receipt for a full refund." },
  {
    key: "cancellation",
    label: "Cancellations & rescheduling",
    placeholder: "e.g. Free cancellation up to 24 hours before your appointment. Late cancellations forfeit the deposit.",
  },
  { key: "warranty", label: "Warranty & guarantees", placeholder: "e.g. 6-month warranty on all repairs, covering parts and labour." },
  { key: "other", label: "Anything else", placeholder: "e.g. Pets welcome. Kids under 5 eat free. No outside food." },
] as const;
