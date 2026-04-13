import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { EpubShelfSettings } from "./types";

const execFileAsync = promisify(execFile);

// ─── calibredb binary discovery ──────────────────────────────────────────────

const CALIBREDB_CANDIDATES: Record<string, string[]> = {
  linux: [
    "/usr/bin/calibredb",
    "/usr/local/bin/calibredb",
    "/opt/calibre/calibredb",
  ],
  darwin: [
    "/Applications/calibre.app/Contents/MacOS/calibredb",
    "/usr/local/bin/calibredb",
    "/opt/homebrew/bin/calibredb",
  ],
  win32: [
    "C:\\Program Files\\Calibre2\\calibredb.exe",
    "C:\\Program Files (x86)\\Calibre2\\calibredb.exe",
  ],
};

export function findCalibreDb(): string {
  const platform = process.platform as string;
  const candidates = CALIBREDB_CANDIDATES[platform] ?? [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Last resort: hope it's in PATH
  return "calibredb";
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface CalibreAddResult {
  success: boolean;
  bookId: string;        // numeric Calibre id as string, e.g. "42"
  calibreLink: string;   // calibre://show-book/... deep link for Obsidian
  error?: string;
}

// ─── calibredb add ───────────────────────────────────────────────────────────

export async function addToCalibre(
  epubPath: string,
  settings: EpubShelfSettings
): Promise<CalibreAddResult> {
  const bin = settings.calibreDbPath || findCalibreDb();

  const args: string[] = ["add", epubPath];

  // Library location (local path or http://server)
  if (settings.calibreLibraryPath) {
    args.push("--with-library", settings.calibreLibraryPath);
  }

  // Credentials for calibre-server
  if (settings.calibreUsername) {
    args.push("--username", settings.calibreUsername);
  }
  if (settings.calibrePassword) {
    args.push("--password", settings.calibrePassword);
  }

  // Machine-readable output
  args.push("--dont-notify-gui");

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 30_000,
    });

    const output = stdout + stderr;
    const bookId = parseBookId(output);

    if (!bookId) {
      // calibredb already has this book — try to find its id
      const existingId = await findExistingId(bin, epubPath, settings);
      if (existingId) {
        return {
          success: true,
          bookId: existingId,
          calibreLink: buildCalibreLink(existingId, settings.calibreLibraryPath),
        };
      }
      return {
        success: false,
        bookId: "",
        calibreLink: "",
        error: `calibredb output unrecognised: ${output.substring(0, 200)}`,
      };
    }

    return {
      success: true,
      bookId,
      calibreLink: buildCalibreLink(bookId, settings.calibreLibraryPath),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, bookId: "", calibreLink: "", error: msg };
  }
}

// ─── Parse book id from calibredb output ─────────────────────────────────────
// calibredb add prints something like:
//   Added book ids: 42
// or (when already present):
//   Skipping /path/file.epub as it is already in the library

function parseBookId(output: string): string {
  // "Added book ids: 42" or "Added book ids: 42, 43"
  const m = output.match(/Added book ids?:\s*([\d, ]+)/i);
  if (m) {
    const ids = m[1].trim().split(/[\s,]+/).filter(Boolean);
    return ids[0] ?? "";
  }
  return "";
}

// ─── Find existing book id by searching on filename ──────────────────────────

async function findExistingId(
  bin: string,
  epubPath: string,
  settings: EpubShelfSettings
): Promise<string> {
  const basename = require("path").basename(epubPath, ".epub");
  const args = [
    "search",
    `title:~"${basename.replace(/"/g, "")}"`,
  ];
  if (settings.calibreLibraryPath)
    args.push("--with-library", settings.calibreLibraryPath);
  if (settings.calibreUsername)
    args.push("--username", settings.calibreUsername);
  if (settings.calibrePassword)
    args.push("--password", settings.calibrePassword);

  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 10_000 });
    const id = stdout.trim().split(/[\s,]+/)[0];
    return /^\d+$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

// ─── Build calibre:// deep link ───────────────────────────────────────────────
// Format:  calibre://show-book/<library_id>/<book_id>
// For local libraries the library_id is derived from the folder name.
// For calibre-server it uses the server's library name.

function buildCalibreLink(bookId: string, libraryPath: string): string {
  if (!bookId) return "";

  let libraryId = "Calibre_Library";

  if (libraryPath) {
    if (libraryPath.startsWith("http")) {
      // calibre-server: http://host:port/#library_name
      const m = libraryPath.match(/#(.+)$/);
      libraryId = m ? encodeURIComponent(m[1]) : "Calibre_Library";
    } else {
      // Local path: use folder name, spaces → underscores
      const folderName = require("path")
        .basename(libraryPath)
        .replace(/\s+/g, "_");
      libraryId = encodeURIComponent(folderName);
    }
  }

  return `calibre://show-book/${libraryId}/${bookId}`;
}

// ─── Test connectivity (used by settings UI) ──────────────────────────────────

export async function testCalibreConnection(
  settings: EpubShelfSettings
): Promise<{ ok: boolean; message: string }> {
  const bin = settings.calibreDbPath || findCalibreDb();

  const args = ["list", "--limit", "1", "--fields", "id"];
  if (settings.calibreLibraryPath)
    args.push("--with-library", settings.calibreLibraryPath);
  if (settings.calibreUsername)
    args.push("--username", settings.calibreUsername);
  if (settings.calibrePassword)
    args.push("--password", settings.calibrePassword);

  try {
    await execFileAsync(bin, args, { timeout: 10_000 });
    return { ok: true, message: `calibredb trouvé : ${bin}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
