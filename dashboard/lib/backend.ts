import { auth } from "@clerk/nextjs/server";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:3000";

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Fastify backend's /api/* routes, server-to-server, with the current Clerk session as a bearer token. */
export async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new BackendError(401, "Not signed in");

  const res = await fetch(`${BACKEND_API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new BackendError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
