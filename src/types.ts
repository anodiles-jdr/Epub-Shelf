// ─── Epub metadata ─────────────────────────────────────────────────────────

export interface EpubMeta {
  title: string;
  authors: string[];
  publisher: string;
  date: string;          // YYYY or YYYY-MM-DD
  year: string;          // YYYY extracted from date
  language: string;
  subjects: string[];
  description: string;
  isbn: string;
  series: string;
  seriesIndex: string;
  coverBase64: string;   // empty string if none
  coverExt: string;      // "jpg" | "png" | "webp" | ""
  sourceFile: string;    // absolute path to the epub
  calibreId: string;     // Calibre book id after add, empty if not added
}

// ─── Plugin settings ────────────────────────────────────────────────────────

export interface WatchedFolder {
  id: string;            // uuid-like, for keying
  sourcePath: string;    // absolute path on disk to watch
  targetFolder: string;  // vault-relative path for generated notes
  recursive: boolean;    // watch subfolders?
}

export interface EpubShelfSettings {
  watchedFolders: WatchedFolder[];

  // Note generation
  noteTemplate: string;          // Handlebars-like template, empty = default
  defaultStatus: string;         // e.g. "unread"
  skipExisting: boolean;         // don't overwrite notes already created
  filenamePattern: string;       // "author-title" | "title" | "title-author"

  // Enrichment
  fetchOpenLibrary: boolean;     // enrich metadata via OpenLibrary API
  saveCover: boolean;            // extract and save cover image
  coverFolder: string;           // vault-relative folder for cover images

  // Tags
  autoTagLanguage: boolean;
  autoTagSubjects: boolean;
  extraTags: string[];           // always added to every note

  // Behaviour
  scanOnStartup: boolean;        // scan all watched folders when plugin loads
  showNotices: boolean;          // Obsidian Notice on each new note

  // Note links
  storeAbsolutePath: boolean;    // also store epub_path: /abs/path in frontmatter

  // Calibre integration
  calibreEnabled: boolean;
  calibreDbPath: string;         // path to calibredb binary (auto-detected if empty)
  calibreLibraryPath: string;    // --with-library path (local folder or http://...)
  calibreUsername: string;       // for calibre-server (optional)
  calibrePassword: string;       // for calibre-server (optional)
  calibreAddOnDetect: boolean;   // auto-add to Calibre when epub is detected
  calibreStoreLinkInNote: boolean; // write calibre://... link in frontmatter
}

export const DEFAULT_SETTINGS: EpubShelfSettings = {
  watchedFolders: [],

  noteTemplate: "",
  defaultStatus: "unread",
  skipExisting: true,
  filenamePattern: "author-title",

  fetchOpenLibrary: false,
  saveCover: false,
  coverFolder: "Books/Covers",

  autoTagLanguage: true,
  autoTagSubjects: true,
  extraTags: ["book"],

  scanOnStartup: true,
  showNotices: true,

  storeAbsolutePath: true,

  calibreEnabled: false,
  calibreDbPath: "",
  calibreLibraryPath: "",
  calibreUsername: "",
  calibrePassword: "",
  calibreAddOnDetect: true,
  calibreStoreLinkInNote: true,
};
