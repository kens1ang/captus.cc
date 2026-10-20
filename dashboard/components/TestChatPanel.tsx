"use client";

import dynamic from "next/dynamic";

// Browser-only: the transcript lives in sessionStorage, which the server
// can't see — rendering it there would only produce an empty chat that
// then doesn't match on hydration.
export const TestChatPanel = dynamic(() => import("./TestChat").then((m) => m.TestChatPanel), { ssr: false });
