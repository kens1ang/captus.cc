import { redirect } from "next/navigation";

// Files moved under Knowledge — keep old links working.
export default function DocumentsRedirect() {
  redirect("/knowledge/files");
}
