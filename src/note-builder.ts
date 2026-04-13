import * as path from "path";
import { EpubMeta, EpubShelfSettings } from "./types";

// ─── Slugify ─────────────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"''""«»]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

// ─── Filename ─────────────────────────────────────────────────────────────────

export function buildFilename(
  meta: EpubMeta,
  pattern: string
): string {
  const title = slugify(meta.title || "untitled");
  const author = meta.authors[0] ? slugify(meta.authors[0]) : "unknown";

  switch (pattern) {
    case "title":
      return title;
    case "title-author":
      return meta.authors[0] ? `${title}-${author}` : title;
    case "author-title":
    default:
      return meta.authors[0] ? `${author}-${title}` : title;
  }
}

// ─── YAML helpers ────────────────────────────────────────────────────────────

function yamlStr(s: string): string {
  // Wrap in quotes if needed, escape internal quotes
  if (!s) return '""';
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function yamlList(items: string[]): string {
  if (!items.length) return "[]";
  return `[${items.map((i) => yamlStr(i)).join(", ")}]`;
}

// ─── Tag builder ─────────────────────────────────────────────────────────────

function buildTags(meta: EpubMeta, settings: EpubShelfSettings): string[] {
  const tags = [...settings.extraTags];

  if (settings.autoTagLanguage && meta.language) {
    tags.push(`lang/${meta.language.substring(0, 2)}`);
  }

  if (settings.autoTagSubjects && meta.subjects.length) {
    for (const s of meta.subjects.slice(0, 5)) {
      const tag = slugify(s);
      if (tag && tag.length > 2 && !tags.includes(tag)) tags.push(tag);
    }
  }

  return [...new Set(tags)]; // deduplicate
}

// ─── Default template ────────────────────────────────────────────────────────

function buildDefaultNote(
  meta: EpubMeta,
  settings: EpubShelfSettings,
  coverLink: string,
  calibreLink: string
): string {
  const tags = buildTags(meta, settings);

  const lines: string[] = ["---"];

  lines.push(`title: ${yamlStr(meta.title)}`);

  if (meta.authors.length === 1) {
    lines.push(`author: ${yamlStr(meta.authors[0])}`);
  } else if (meta.authors.length > 1) {
    lines.push(`authors: ${yamlList(meta.authors)}`);
  }

  if (meta.year)       lines.push(`year: ${meta.year}`);
  if (meta.publisher)  lines.push(`publisher: ${yamlStr(meta.publisher)}`);
  if (meta.language)   lines.push(`language: ${meta.language.substring(0, 5)}`);
  if (meta.isbn)       lines.push(`isbn: "${meta.isbn}"`);
  if (meta.series)     lines.push(`series: ${yamlStr(meta.series)}`);
  if (meta.seriesIndex) lines.push(`series_index: ${meta.seriesIndex}`);

  lines.push(`status: "${settings.defaultStatus}"`);
  lines.push(`tags: ${yamlList(tags)}`);
  lines.push(`epub: "[[${path.basename(meta.sourceFile)}]]"`);
  if (settings.storeAbsolutePath) {
    lines.push(`epub_path: "${meta.sourceFile.replace(/\\/g, "/")}"`);
  }
  if (coverLink) lines.push(`cover: "${coverLink}"`);
  if (meta.calibreId) lines.push(`calibre_id: "${meta.calibreId}"`);
  if (calibreLink)  lines.push(`calibre_link: "${calibreLink}"`);
  lines.push(`date_added: ${new Date().toISOString().substring(0, 10)}`);
  lines.push("---");
  lines.push("");

  // Cover image inline
  if (coverLink) {
    lines.push(`![[${coverLink}]]`);
    lines.push("");
  }

  // Description
  if (meta.description) {
    lines.push(`> ${meta.description.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push("## Extraits");
  lines.push("");

  return lines.join("\n");
}

// ─── Template engine (simple {{variable}} substitution) ──────────────────────

function applyTemplate(
  template: string,
  meta: EpubMeta,
  settings: EpubShelfSettings,
  coverLink: string,
  calibreLink: string
): string {
  const tags = buildTags(meta, settings);
  const vars: Record<string, string> = {
    title:        meta.title,
    author:       meta.authors[0] || "",
    authors:      meta.authors.join(", "),
    year:         meta.year,
    publisher:    meta.publisher,
    language:     meta.language,
    isbn:         meta.isbn,
    series:       meta.series,
    series_index: meta.seriesIndex,
    description:  meta.description,
    status:       settings.defaultStatus,
    tags:         tags.join(", "),
    epub:         path.basename(meta.sourceFile),
    epub_path:    meta.sourceFile.replace(/\\/g, "/"),
    cover:        coverLink,
    calibre_id:   meta.calibreId,
    calibre_link: calibreLink,
    date_added:   new Date().toISOString().substring(0, 10),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildNote(
  meta: EpubMeta,
  settings: EpubShelfSettings,
  coverLink = "",
  calibreLink = ""
): string {
  if (settings.noteTemplate.trim()) {
    return applyTemplate(settings.noteTemplate, meta, settings, coverLink, calibreLink);
  }
  return buildDefaultNote(meta, settings, coverLink, calibreLink);
}
