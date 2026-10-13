import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getConversations, getSettings } from "@/lib/data";
import { ConversationList } from "./ConversationList";
import { InboxPanes } from "./InboxPanes";

export const metadata = { title: "Inbox" };

export default async function InboxLayout({ children }: LayoutProps<"/conversations">) {
  const [conversations, settings] = await Promise.all([getConversations(), getSettings()]);
  return (
    <>
      <AutoRefresh />
      <InboxPanes
        list={
          // useSearchParams() in the list needs a Suspense boundary.
          <Suspense>
            <ConversationList conversations={conversations} timezone={settings.timezone} />
          </Suspense>
        }
      >
        {children}
      </InboxPanes>
    </>
  );
}
