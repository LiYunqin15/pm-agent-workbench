import type { Citation, EvidenceSource } from "./types";

export type EvidenceBundle = {
  citations: Citation[];
  evidence: EvidenceSource[];
};

type MutableEvidence = Omit<EvidenceSource, "id">;

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key];
  }
  return null;
}

export function extractEvidence(
  value: unknown,
  capturedAt = new Date().toISOString(),
): EvidenceBundle {
  const found = new Map<string, MutableEvidence>();
  const seen = new Set<unknown>();

  function addSource(
    rawUrl: unknown,
    options: { title?: unknown; excerpt?: string; cited: boolean },
  ): void {
    const url = safeUrl(rawUrl);
    if (!url) return;
    const publisher = new URL(url).hostname.replace(/^www\./, "");
    const incomingTitle =
      typeof options.title === "string" && options.title.trim()
        ? options.title.trim()
        : publisher;
    const existing = found.get(url);

    found.set(url, {
      title:
        existing && existing.title !== existing.publisher
          ? existing.title
          : incomingTitle,
      url,
      publisher,
      capturedAt,
      cited: Boolean(existing?.cited || options.cited),
      excerpt: existing?.excerpt ?? options.excerpt,
      trust: "unrated",
      freshness: "unknown",
    });
  }

  function visit(node: unknown): void {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    const record = node as Record<string, unknown>;
    const providerData =
      record.providerData && typeof record.providerData === "object"
        ? (record.providerData as Record<string, unknown>)
        : null;
    const text = typeof record.text === "string" ? record.text : null;
    const annotations = Array.isArray(record.annotations)
      ? record.annotations
      : Array.isArray(providerData?.annotations)
        ? providerData.annotations
        : [];

    if (text) {
      annotations.forEach((annotation) => {
        if (!annotation || typeof annotation !== "object") return;
        const citation = annotation as Record<string, unknown>;
        if (citation.type !== "url_citation") return;
        const start = numberField(citation, "start_index", "startIndex");
        const end = numberField(citation, "end_index", "endIndex");
        const excerpt =
          start !== null && end !== null && start >= 0 && end > start
            ? text.slice(start, end).trim().slice(0, 500) || undefined
            : undefined;
        addSource(citation.url, {
          title: citation.title,
          excerpt,
          cited: true,
        });
      });
    }

    if (record.type === "url_citation") {
      addSource(record.url, { title: record.title, cited: true });
    }

    const sourceLists = [record.sources, providerData?.sources];
    sourceLists.forEach((sources) => {
      if (!Array.isArray(sources)) return;
      sources.forEach((source) => {
        if (!source || typeof source !== "object") return;
        const sourceRecord = source as Record<string, unknown>;
        if (sourceRecord.type === "url" || typeof sourceRecord.url === "string") {
          addSource(sourceRecord.url, { title: sourceRecord.title, cited: false });
        }
      });
    });

    Object.values(record).forEach(visit);
  }

  visit(value);
  const evidence = [...found.values()].map((item, index) => ({
    id: `evidence-${index + 1}`,
    ...item,
  }));

  return {
    evidence,
    citations: evidence
      .filter((item) => item.cited)
      .map(({ title, url }) => ({ title, url })),
  };
}

export function extractCitations(value: unknown): Citation[] {
  return extractEvidence(value).citations;
}
