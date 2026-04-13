import { EpubMeta } from "./types";

interface OLDoc {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  publish_date?: string[];
  subject?: string[];
  isbn?: string[];
  language?: string[];
  cover_i?: number;
}

/**
 * Enriches metadata via OpenLibrary Search API.
 * Only fills fields that are empty in the current meta.
 */
export async function enrichFromOpenLibrary(
  meta: EpubMeta
): Promise<EpubMeta> {
  try {
    const query = buildQuery(meta);
    if (!query) return meta;

    const url = `https://openlibrary.org/search.json?${query}&limit=1&fields=title,author_name,publisher,publish_date,subject,isbn,language,cover_i`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ObsidianEpubShelf/1.0" },
    });
    if (!res.ok) return meta;

    const json = await res.json();
    const doc: OLDoc = json?.docs?.[0];
    if (!doc) return meta;

    const enriched = { ...meta };

    if (!enriched.title && doc.title) enriched.title = doc.title;
    if (!enriched.authors.length && doc.author_name?.length)
      enriched.authors = doc.author_name;
    if (!enriched.publisher && doc.publisher?.[0])
      enriched.publisher = doc.publisher[0];
    if (!enriched.year && doc.publish_date?.[0]) {
      const m = doc.publish_date[0].match(/\d{4}/);
      if (m) enriched.year = m[0];
    }
    if (!enriched.subjects.length && doc.subject?.length)
      enriched.subjects = doc.subject.slice(0, 6);
    if (!enriched.isbn && doc.isbn?.length) enriched.isbn = doc.isbn[0];
    if (!enriched.language && doc.language?.[0])
      enriched.language = doc.language[0];

    return enriched;
  } catch {
    return meta;
  }
}

function buildQuery(meta: EpubMeta): string {
  const parts: string[] = [];
  if (meta.isbn) {
    parts.push(`isbn=${encodeURIComponent(meta.isbn)}`);
    return parts.join("&");
  }
  if (meta.title) parts.push(`title=${encodeURIComponent(meta.title)}`);
  if (meta.authors[0]) parts.push(`author=${encodeURIComponent(meta.authors[0])}`);
  return parts.join("&");
}
