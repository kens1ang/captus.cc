import http from "node:http";

// A stand-in for Meta's Graph API: records everything Captus sends (texts,
// documents, templates, typing indicators), serves media the "customer"
// sent, and can be told to fail sends — so whole conversations run end to
// end with a real backend + real Gemini, but no real WhatsApp.

export interface Outbound {
  phoneNumberId: string;
  to: string;
  type: "text" | "document" | "template" | "typing";
  text?: string;
  document?: { link: string; filename: string; caption?: string };
  template?: { name: string };
  at: number;
}

export class MockMeta {
  outbound: Outbound[] = [];
  private media = new Map<string, { data: Buffer; mime: string }>();
  private failures = new Map<string, { status: number; remaining: number }>();
  private beforeSend = new Map<string, () => Promise<void>>();
  private server?: http.Server;
  private seq = 0;
  sendAttempts = 0;

  constructor(public port: number) {}

  get base(): string {
    return `http://localhost:${this.port}`;
  }

  addMedia(id: string, data: Buffer, mime: string): void {
    this.media.set(id, { data, mime });
  }

  /** The next `times` sends to `to` fail with `status` (Meta-side rejection / outage). */
  failSendsTo(to: string, times: number, status = 500): void {
    this.failures.set(to, { status, remaining: times });
  }

  /** Runs `fn` before answering the next text send to `to` — the reply is "in flight" meanwhile. */
  beforeNextSendTo(to: string, fn: () => Promise<void>): void {
    this.beforeSend.set(to, fn);
  }

  /** Customer-visible messages to `to` (excludes typing indicators). */
  messagesTo(to: string): Outbound[] {
    return this.outbound.filter((o) => o.to === to && o.type !== "typing");
  }

  async waitFor(to: string, count: number, timeoutMs: number): Promise<Outbound[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const got = this.messagesTo(to);
      if (got.length >= count) return got;
      await new Promise((r) => setTimeout(r, 250));
    }
    return this.messagesTo(to);
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => this.handle(req, res, Buffer.concat(chunks)));
    });
    return new Promise((resolve) => this.server!.listen(this.port, resolve));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) {
    const url = new URL(req.url ?? "/", this.base);
    const parts = url.pathname.split("/").filter(Boolean);

    // GET /media/:id — the actual file bytes
    if (req.method === "GET" && parts[0] === "media") {
      const m = this.media.get(parts[1]);
      if (!m) return this.json(res, 404, { error: "no such media" });
      res.writeHead(200, { "Content-Type": m.mime });
      return res.end(m.data);
    }

    // GET /v21.0/:mediaId — media metadata lookup
    if (req.method === "GET" && parts.length === 2) {
      const m = this.media.get(parts[1]);
      if (!m) return this.json(res, 404, { error: { message: "media not found" } });
      return this.json(res, 200, { url: `${this.base}/media/${parts[1]}`, mime_type: m.mime, id: parts[1] });
    }

    // POST /v21.0/:phoneNumberId/messages
    if (req.method === "POST" && parts[2] === "messages") {
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const phoneNumberId = parts[1];
      if (payload.status === "read") {
        this.outbound.push({ phoneNumberId, to: "", type: "typing", at: Date.now() });
        return this.json(res, 200, { success: true });
      }
      this.sendAttempts++;
      const before = payload.type === "text" ? this.beforeSend.get(payload.to) : undefined;
      if (before) {
        this.beforeSend.delete(payload.to);
        await before();
      }
      const fail = this.failures.get(payload.to);
      if (fail && fail.remaining > 0) {
        fail.remaining--;
        return this.json(res, fail.status, { error: { message: "mock: injected send failure", code: 131000 } });
      }
      const o: Outbound = { phoneNumberId, to: payload.to, type: payload.type, at: Date.now() };
      if (payload.type === "text") o.text = payload.text?.body;
      if (payload.type === "document") o.document = payload.document;
      if (payload.type === "template") o.template = { name: payload.template?.name };
      this.outbound.push(o);
      return this.json(res, 200, { messaging_product: "whatsapp", contacts: [{ wa_id: payload.to }], messages: [{ id: `wamid.mock${++this.seq}` }] });
    }

    this.json(res, 404, { error: { message: `mock: unhandled ${req.method} ${url.pathname}` } });
  }
}
