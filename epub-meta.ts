import AdmZip from "adm-zip";
import { EpubMeta } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function xmlText(xml: string, tag: string): string {
  // Handles both <dc:tag> and <tag> forms, with optional attributes
  const re = new RegExp(
    `<(?:dc:)?${tag}(?:[^>]*)>([\\s\\S]*?)<\/(?:dc:)?${tag}>`,
    "i"
  );
  const m = xml.match(re);
  return m ? decodeEntities(m[1].trim()) : "";
}

function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:dc:)?${tag}(?:[^>]*)>([\\s\\S]*?)<\/(?:dc:)?${tag}>`,
    "gi"
  );
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = decodeEntities(m[1].trim());
    if (v) results.push(v);
  }
  return results;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

function extractYear(dateStr: string): string {
  const m = dateStr.match(/\d{4}/);
  return m ? m[0] : "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── OPF locator ────────────────────────────────────────────────────────────

function findOpfPath(zip: AdmZip): string | null {
  // Try container.xml first (standard)
  const container = zip.getEntry("META-INF/container.xml");
  if (container) {
    const xml = container.getData().toString("utf8");
    const m = xml.match(/full-path="([^"]+\.opf)"/i);
    if (m) return m[1];
  }
  // Fallback: scan for any .opf
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith(".opf")) return entry.entryName;
  }
  return null;
}

// ─── Cover extractor ────────────────────────────────────────────────────────

function extractCover(
  zip: AdmZip,
  opfXml: string,
  opfDir: string
): { data: Buffer | null; ext: string } {
  // Strategy 1: meta cover id → manifest item
  const coverIdMatch = opfXml.match(
    /<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/i
  );
  if (coverIdMatch) {
    const id = coverIdMatch[1];
    const itemRe = new RegExp(
      `<item[^>]+id=["']${id}["'][^>]+href=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const itemMatch = opfXml.match(itemRe);
    if (itemMatch) {
      const href = itemMatch[1];
      const fullPath = opfDir ? `${opfDir}/${href}` : href;
      const entry =
        zip.getEntry(fullPath) ||
        zip.getEntry(href) ||
        zip.getEntry(decodeURIComponent(fullPath));
      if (entry) {
        const ext = href.split(".").pop()?.toLowerCase() || "jpg";
        return { data: entry.getData(), ext };
      }
    }
  }

  // Strategy 2: first image in manifest with "cover" in id/href
  const manifestRe =
    /<item[^>]+(?:id|href)=["'][^"']*cover[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = manifestRe.exec(opfXml)) !== null) {
    const href = m[1];
    const fullPath = opfDir ? `${opfDir}/${href}` : href;
    const entry = zip.getEntry(fullPath) || zip.getEntry(href);
    if (entry) {
      const ext = href.split(".").pop()?.toLowerCase() || "jpg";
      return { data: entry.getData(), ext };
    }
  }

  return { data: null, ext: "" };
}

// ─── Calibre series ─────────────────────────────────────────────────────────

function extractSeries(opfXml: string): { series: string; index: string } {
  const seriesMatch = opfXml.match(
    /<meta[^>]+name=["']calibre:series["'][^>]+content=["']([^"']+)["']/i
  );
  const indexMatch = opfXml.match(
    /<meta[^>]+name=["']calibre:series_index["'][^>]+content=["']([^"']+)["']/i
  );
  return {
    series: seriesMatch ? decodeEntities(seriesMatch[1]) : "",
    index: indexMatch ? indexMatch[1] : "",
  };
}

// ─── ISBN ────────────────────────────────────────────────────────────────────

function extractIsbn(opfXml: string): string {
  // dc:identifier with scheme ISBN
  const re =
    /<dc:identifier[^>]*(?:scheme=["']ISBN["']|opf:scheme=["']ISBN["'])[^>]*>([^<]+)<\/dc:identifier>/gi;
  const m = re.exec(opfXml);
  if (m) return m[1].trim().replace(/[^0-9X]/gi, "");

  // Fallback: any identifier that looks like an ISBN
  const all = xmlAll(opfXml, "identifier");
  for (const id of all) {
    const clean = id.replace(/[^0-9X]/gi, "");
    if (clean.length === 13 || clean.length === 10) return clean;
  }
  return "";
}

// ─── Main extractor ─────────────────────────────────────────────────────────

export async function extractEpubMeta(
  filePath: string,
  extractCoverData = false
): Promise<EpubMeta> {
  const blank: EpubMeta = {
    title: "",
    authors: [],
    publisher: "",
    date: "",
    year: "",
    language: "",
    subjects: [],
    description: "",
    isbn: "",
    series: "",
    seriesIndex: "",
    coverBase64: "",
    coverExt: "",
    sourceFile: filePath,
    calibreId: "",
  };

  try {
    const zip = new AdmZip(filePath);
    const opfPath = findOpfPath(zip);
    if (!opfPath) return { ...blank, title: require("path").basename(filePath, ".epub") };

    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return blank;

    const opfXml = opfEntry.getData().toString("utf8");
    const opfDir = opfPath.includes("/")
      ? opfPath.substring(0, opfPath.lastIndexOf("/"))
      : "";

    const date = xmlText(opfXml, "date");
    const { series, index } = extractSeries(opfXml);

    const rawDesc = xmlText(opfXml, "description");
    const description = stripHtml(rawDesc).substring(0, 500);

    let coverBase64 = "";
    let coverExt = "";
    if (extractCoverData) {
      const { data, ext } = extractCover(zip, opfXml, opfDir);
      if (data) {
        coverBase64 = data.toString("base64");
        coverExt = ext;
      }
    }

    return {
      title: xmlText(opfXml, "title") || require("path").basename(filePath, ".epub"),
      authors: xmlAll(opfXml, "creator").filter(Boolean),
      publisher: xmlText(opfXml, "publisher"),
      date,
      year: extractYear(date),
      language: xmlText(opfXml, "language").substring(0, 5),
      subjects: xmlAll(opfXml, "subject").filter(Boolean),
      description,
      isbn: extractIsbn(opfXml),
      series,
      seriesIndex: index,
      coverBase64,
      coverExt,
      sourceFile: filePath,
      calibreId: "",
    };
  } catch {
    return {
      ...blank,
      title: require("path").basename(filePath, ".epub"),
    };
  }
}
