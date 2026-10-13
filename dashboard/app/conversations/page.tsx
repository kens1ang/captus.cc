import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/ui";

export default function InboxIndexPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={MessagesSquare}
        title="Select a conversation"
        description="Your assistant replies automatically. Open a chat to read it, reply yourself, or hand it back."
      />
    </div>
  );
}
