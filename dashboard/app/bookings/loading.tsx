import { CardSkeleton } from "@/components/Skeleton";

// Rendered inside the Bookings layout, under its header and tabs.
export default function Loading() {
  return <CardSkeleton rows={4} />;
}
