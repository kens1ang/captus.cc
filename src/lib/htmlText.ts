// Turns a fetched HTML page into what's worth showing a model: title, meta
// description, structured data and visible text, plus the page's links (to
// pick which other pages of the site to read). Regex-based on purpose — no
// DOM or headless browser on a 512 MB free-tier box, and the model is
// forgiving of a bit of leftover noise.

export interface PageText {
  title: string;
  description: string;
  /** schema.org JSON-LD blocks — often the most exact source of hours, address and phone (it's what Google reads). */
  structuredData: string[];
  text: string;
  links: { href: string; text: string }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function metaContent(html: string, key: string): string {
  // Attribute order varies (name before content or after), so match the tag first.
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (content) return decodeEntities(content[1] ?? content[2] ?? "").trim();
  }
  return "";
}

export function htmlToText(html: string, baseUrl: string): PageText {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const description = metaContent(html, "description") || metaContent(html, "og:description");

  const structuredData = [...html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 6000));

  const links: PageText["links"] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(decodeEntities(m[1]), baseUrl).toString();
      const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      links.push({ href, text });
    } catch {
      // unparseable href — skip
    }
  }

  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Keep some structure so a menu or price table doesn't collapse into one line.
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return { title, description, structuredData, text, links };
}
