"use server";

import { revalidatePath } from "next/cache";
import { backendFetch } from "@/lib/backend";
import { attempt, fail, type ActionState } from "@/lib/actionState";
import { POLICY_FIELDS, type BusinessHoursInterval, type SectionKey } from "@/lib/data";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function putSection(section: SectionKey, body: object): Promise<string> {
  const res = await backendFetch<{ chunksIndexed?: number }>(`/api/business-info/${section}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  // Every page's sidebar dots + the Overview checklist read this data.
  revalidatePath("/", "layout");
  if (res.chunksIndexed === undefined) return "Saved — your assistant uses this from its next reply";
  return `Saved — ${res.chunksIndexed} ${res.chunksIndexed === 1 ? "entry" : "entries"} ready for your assistant`;
}

export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const businessName = field(formData, "businessName");
  if (!businessName) return fail("Business name is required");
  return attempt(() =>
    putSection("profile", {
      businessName,
      businessDescription: field(formData, "businessDescription"),
      data: { highlights: field(formData, "highlights"), audience: field(formData, "audience") },
    }),
  );
}

/** Location/contact (business_info) and weekly hours (business_hours, shared with bookings) save together from one page. */
export async function saveLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const intervals: BusinessHoursInterval[] = [];
  for (let day = 0; day < 7; day++) {
    if (formData.get(`open_${day}`) !== "on") continue;
    const startTime = field(formData, `start_${day}`);
    const endTime = field(formData, `end_${day}`);
    if (!startTime || !endTime) return fail(`Set both opening and closing times for ${DAY_NAMES[day]}, or mark it closed`);
    if (endTime <= startTime) return fail(`${DAY_NAMES[day]}: closing time must be after opening time`);
    intervals.push({ dayOfWeek: day, startTime, endTime });
  }

  return attempt(async () => {
    await backendFetch("/api/business-hours", { method: "PUT", body: JSON.stringify({ intervals }) });
    return putSection("location", {
      data: {
        address: field(formData, "address"),
        directions: field(formData, "directions"),
        serviceArea: field(formData, "serviceArea"),
        phone: field(formData, "phone"),
        email: field(formData, "email"),
        website: field(formData, "website"),
        socials: field(formData, "socials"),
        hoursNotes: field(formData, "hoursNotes"),
      },
    });
  });
}

export async function savePolicies(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return attempt(() => putSection("policies", { data: Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, field(formData, f.key)])) }));
}

/** Products and FAQs are edited as lists client-side and arrive as one JSON payload. */
export async function saveListSection(section: "products" | "faqs", _prev: ActionState, formData: FormData): Promise<ActionState> {
  let data: unknown;
  try {
    data = JSON.parse(field(formData, "payload") || "{}");
  } catch {
    return fail("Couldn't read the form — please try again");
  }
  return attempt(() => putSection(section, { data }));
}

export async function saveAssistant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return attempt(() =>
    putSection("assistant", {
      data: {
        tone: field(formData, "tone"),
        languages: field(formData, "languages"),
        instructions: field(formData, "instructions"),
      },
    }),
  );
}

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = field(formData, "text");
  if (!text) return fail("Write something first");
  return attempt(async () => {
    const res = await backendFetch<{ chunksAdded: number }>("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({ text, source: "dashboard" }),
    });
    revalidatePath("/", "layout");
    return `Added — ${res.chunksAdded} ${res.chunksAdded === 1 ? "entry" : "entries"}`;
  });
}

export async function deleteNote(chunkId: string) {
  await backendFetch(`/api/knowledge/${chunkId}`, { method: "DELETE" });
  revalidatePath("/", "layout");
}

export async function uploadDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = field(formData, "name");
  const description = field(formData, "description");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return fail("Choose a file to upload");
  if (!name) return fail("Give the file a short name, like \"Menu\"");

  return attempt(async () => {
    await backendFetch("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileDataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      }),
    });
    revalidatePath("/", "layout");
    return `Uploaded "${name}"`;
  });
}

export async function deleteDocumentAction(documentId: string) {
  await backendFetch(`/api/documents/${documentId}`, { method: "DELETE" });
  revalidatePath("/", "layout");
}
