import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import chokidar, { FSWatcher } from "chokidar";

import { EpubShelfSettings, DEFAULT_SETTINGS, WatchedFolder } from "./types";
import { EpubShelfSettingsTab } from "./settings-tab";
import { extractEpubMeta } from "./epub-meta";
import { enrichFromOpenLibrary } from "./open-library";
import { buildNote, buildFilename, slugify } from "./note-builder";
import { addToCalibre } from "./calibre";

export default class EpubShelfPlugin extends Plugin {
  settings: EpubShelfSettings;

  // Map of folder.id → FSWatcher
  private watchers: Map<string, FSWatcher> = new Map();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new EpubShelfSettingsTab(this.app, this));

    // Command: manual scan
    this.addCommand({
      id: "scan-all-folders",
      name: "Scanner tous les dossiers epub",
      callback: async () => {
        const count = await this.scanAll();
        new Notice(`Epub Shelf : ${count} note(s) créée(s)`);
      },
    });

    // Command: add current note's epub to Calibre
    this.addCommand({
      id: "add-to-calibre",
      name: "Ajouter cet epub à Calibre",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const cache = this.app.metadataCache.getFileCache(file);
        const epubPath = cache?.frontmatter?.epub_path as string | undefined;
        if (!epubPath) return false;
        if (checking) return true;

        this.addEpubToCalibreAndUpdateNote(file, epubPath);
        return true;
      },
    });

    // Start watchers after layout is ready
    this.app.workspace.onLayoutReady(async () => {
      for (const folder of this.settings.watchedFolders) {
        this.startWatcher(folder);
      }
      if (this.settings.scanOnStartup) {
        await this.scanAll();
      }
    });
  }

  async onunload() {
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Ensure each folder has an id (migration guard)
    for (const f of this.settings.watchedFolders) {
      if (!f.id) f.id = crypto.randomUUID();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Watcher management ─────────────────────────────────────────────────────

  startWatcher(folder: WatchedFolder) {
    if (!folder.sourcePath) return;
    if (!fs.existsSync(folder.sourcePath)) {
      console.warn(`[EpubShelf] Folder not found: ${folder.sourcePath}`);
      return;
    }

    const pattern = folder.recursive
      ? path.join(folder.sourcePath, "**", "*.epub")
      : path.join(folder.sourcePath, "*.epub");

    const watcher = chokidar.watch(pattern, {
      ignoreInitial: true,       // don't fire for existing files (scan handles those)
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 200,
      },
      persistent: true,
    });

    watcher.on("add", async (filePath: string) => {
      console.log(`[EpubShelf] New epub detected: ${filePath}`);
      await this.processEpub(filePath, folder);
    });

    watcher.on("error", (err: Error) => {
      console.error(`[EpubShelf] Watcher error for ${folder.sourcePath}:`, err);
    });

    this.watchers.set(folder.id, watcher);
    console.log(`[EpubShelf] Watching: ${folder.sourcePath}`);
  }

  async stopWatcher(folderId: string) {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(folderId);
    }
  }

  async restartWatcher(folderId: string) {
    await this.stopWatcher(folderId);
    const folder = this.settings.watchedFolders.find((f) => f.id === folderId);
    if (folder) this.startWatcher(folder);
  }

  // ── Scan all ───────────────────────────────────────────────────────────────

  async scanAll(): Promise<number> {
    let total = 0;
    for (const folder of this.settings.watchedFolders) {
      if (!folder.sourcePath || !fs.existsSync(folder.sourcePath)) continue;
      const epubs = this.findEpubs(folder.sourcePath, folder.recursive);
      for (const filePath of epubs) {
        const created = await this.processEpub(filePath, folder);
        if (created) total++;
      }
    }
    return total;
  }

  private findEpubs(dirPath: string, recursive: boolean): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory() && recursive) {
          results.push(...this.findEpubs(fullPath, true));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".epub")) {
          results.push(fullPath);
        }
      }
    } catch (e) {
      console.error(`[EpubShelf] Cannot read directory ${dirPath}:`, e);
    }
    return results;
  }

  // ── Core processing ────────────────────────────────────────────────────────

  async processEpub(
    filePath: string,
    folder: WatchedFolder
  ): Promise<boolean> {
    try {
      // 1. Extract metadata
      let meta = await extractEpubMeta(filePath, this.settings.saveCover);

      // 2. Enrich from OpenLibrary if enabled
      if (this.settings.fetchOpenLibrary) {
        meta = await enrichFromOpenLibrary(meta);
      }

      // 3. Determine note path
      const filename = buildFilename(meta, this.settings.filenamePattern);
      const noteRelPath = normalizePath(
        `${folder.targetFolder}/${filename}.md`
      );

      // 4. Skip if exists and option is set
      if (this.settings.skipExisting) {
        const existing = this.app.vault.getAbstractFileByPath(noteRelPath);
        if (existing) return false;
      }

      // 5. Save cover if enabled
      let coverLink = "";
      if (this.settings.saveCover && meta.coverBase64 && meta.coverExt) {
        coverLink = await this.saveCover(
          meta.coverBase64,
          meta.coverExt,
          filename
        );
      }

      // 6. Add to Calibre if enabled
      let calibreLink = "";
      if (this.settings.calibreEnabled && this.settings.calibreAddOnDetect) {
        const result = await addToCalibre(filePath, this.settings);
        if (result.success) {
          meta.calibreId = result.bookId;
          calibreLink = result.calibreLink;
          if (this.settings.showNotices) {
            new Notice(`📚 Calibre : ajouté (id ${result.bookId})`);
          }
        } else {
          console.warn(`[EpubShelf] Calibre add failed: ${result.error}`);
        }
      }

      // 7. Ensure target folder exists
      await this.ensureFolder(folder.targetFolder);

      // 8. Build and write note
      const content = buildNote(meta, this.settings, coverLink, calibreLink);
      await this.app.vault.create(noteRelPath, content);

      if (this.settings.showNotices) {
        new Notice(`📚 Note créée : ${meta.title || filename}`);
      }

      console.log(`[EpubShelf] Created note: ${noteRelPath}`);
      return true;
    } catch (e) {
      console.error(`[EpubShelf] Failed to process ${filePath}:`, e);
      return false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async saveCover(
    base64: string,
    ext: string,
    filename: string
  ): Promise<string> {
    const coverFolder = this.settings.coverFolder;
    await this.ensureFolder(coverFolder);

    const coverFilename = `${filename}.${ext}`;
    const coverPath = normalizePath(`${coverFolder}/${coverFilename}`);

    // Avoid duplicate writes
    if (!this.app.vault.getAbstractFileByPath(coverPath)) {
      const buffer = Buffer.from(base64, "base64");
      await this.app.vault.createBinary(coverPath, buffer);
    }

    return coverFilename;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (!existing) {
      await this.app.vault.createFolder(normalized);
    }
  }

  // ── Calibre: add from active note ─────────────────────────────────────────

  async addEpubToCalibreAndUpdateNote(file: TFile, epubPath: string) {
    if (!this.settings.calibreEnabled) {
      new Notice("Epub Shelf : activez l'intégration Calibre dans les paramètres");
      return;
    }

    new Notice("Epub Shelf : ajout à Calibre en cours…");
    const result = await addToCalibre(epubPath, this.settings);

    if (!result.success) {
      new Notice(`Epub Shelf : erreur Calibre — ${result.error}`);
      console.error("[EpubShelf] Calibre error:", result.error);
      return;
    }

    // Patch the note's frontmatter in-place
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["calibre_id"] = result.bookId;
      if (this.settings.calibreStoreLinkInNote && result.calibreLink) {
        fm["calibre_link"] = result.calibreLink;
      }
    });

    new Notice(`📚 Ajouté à Calibre (id ${result.bookId})`);
  }
}
