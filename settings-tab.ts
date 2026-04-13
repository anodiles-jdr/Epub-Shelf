import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import EpubShelfPlugin from "./main";
import { WatchedFolder } from "./types";
import { findCalibreDb, testCalibreConnection } from "./calibre";

export class EpubShelfSettingsTab extends PluginSettingTab {
  plugin: EpubShelfPlugin;

  constructor(app: App, plugin: EpubShelfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Watched folders ──────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Dossiers surveillés" });

    const foldersContainer = containerEl.createDiv("epub-shelf-folders");
    this.renderFolderList(foldersContainer);

    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("+ Ajouter un dossier")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.watchedFolders.push({
              id: crypto.randomUUID(),
              sourcePath: "",
              targetFolder: "Books",
              recursive: true,
            });
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // ── Note generation ──────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Génération des notes" });

    new Setting(containerEl)
      .setName("Nom des fichiers notes")
      .setDesc("Pattern de nommage des fichiers .md créés")
      .addDropdown((drop) =>
        drop
          .addOption("author-title", "auteur-titre (défaut)")
          .addOption("title", "titre seul")
          .addOption("title-author", "titre-auteur")
          .setValue(this.plugin.settings.filenamePattern)
          .onChange(async (v) => {
            this.plugin.settings.filenamePattern = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Statut par défaut")
      .setDesc("Valeur du champ `status` dans le frontmatter")
      .addText((text) =>
        text
          .setPlaceholder("unread")
          .setValue(this.plugin.settings.defaultStatus)
          .onChange(async (v) => {
            this.plugin.settings.defaultStatus = v || "unread";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ne pas écraser les notes existantes")
      .setDesc("Si une note existe déjà pour cet epub, la laisser intacte")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.skipExisting)
          .onChange(async (v) => {
            this.plugin.settings.skipExisting = v;
            await this.plugin.saveSettings();
          })
      );

    // Template
    new Setting(containerEl)
      .setName("Template personnalisé")
      .setDesc(
        "Laissez vide pour le template par défaut. Variables disponibles : {{title}}, {{author}}, {{authors}}, {{year}}, {{publisher}}, {{language}}, {{isbn}}, {{series}}, {{series_index}}, {{description}}, {{status}}, {{tags}}, {{epub}}, {{cover}}, {{date_added}}"
      )
      .addTextArea((ta) => {
        ta.setPlaceholder("Laissez vide pour le template par défaut")
          .setValue(this.plugin.settings.noteTemplate)
          .onChange(async (v) => {
            this.plugin.settings.noteTemplate = v;
            await this.plugin.saveSettings();
          });
        ta.inputEl.rows = 10;
        ta.inputEl.style.width = "100%";
        ta.inputEl.style.fontFamily = "monospace";
        ta.inputEl.style.fontSize = "12px";
      });

    // ── Tags ─────────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Tags" });

    new Setting(containerEl)
      .setName("Tags supplémentaires")
      .setDesc("Tags toujours ajoutés à chaque note (séparés par des virgules)")
      .addText((text) =>
        text
          .setPlaceholder("book, reading")
          .setValue(this.plugin.settings.extraTags.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.extraTags = v
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tag de langue automatique")
      .setDesc("Ajoute lang/fr, lang/en… selon la langue de l'epub")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoTagLanguage)
          .onChange(async (v) => {
            this.plugin.settings.autoTagLanguage = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tags depuis les sujets epub")
      .setDesc("Convertit les sujets Dublin Core en tags Obsidian")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.autoTagSubjects)
          .onChange(async (v) => {
            this.plugin.settings.autoTagSubjects = v;
            await this.plugin.saveSettings();
          })
      );

    // ── Enrichissement ───────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Enrichissement" });

    new Setting(containerEl)
      .setName("OpenLibrary")
      .setDesc(
        "Complète les métadonnées manquantes via l'API OpenLibrary (requiert internet)"
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.fetchOpenLibrary)
          .onChange(async (v) => {
            this.plugin.settings.fetchOpenLibrary = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extraire les couvertures")
      .setDesc("Sauvegarde la couverture de chaque epub dans le vault")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.saveCover)
          .onChange(async (v) => {
            this.plugin.settings.saveCover = v;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.saveCover) {
      new Setting(containerEl)
        .setName("Dossier des couvertures")
        .setDesc("Chemin relatif dans le vault")
        .addText((text) =>
          text
            .setPlaceholder("Books/Covers")
            .setValue(this.plugin.settings.coverFolder)
            .onChange(async (v) => {
              this.plugin.settings.coverFolder = v || "Books/Covers";
              await this.plugin.saveSettings();
            })
        );
    }

    // ── Comportement ─────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Comportement" });

    new Setting(containerEl)
      .setName("Scanner au démarrage")
      .setDesc(
        "Lance un scan de tous les dossiers surveillés quand le plugin se charge"
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.scanOnStartup)
          .onChange(async (v) => {
            this.plugin.settings.scanOnStartup = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Notifications")
      .setDesc("Affiche une notification Obsidian pour chaque note créée")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showNotices)
          .onChange(async (v) => {
            this.plugin.settings.showNotices = v;
            await this.plugin.saveSettings();
          })
      );

    // ── Liens ────────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Liens vers les fichiers" });

    new Setting(containerEl)
      .setName("Stocker le chemin absolu")
      .setDesc(
        "Ajoute epub_path: /chemin/absolu/fichier.epub dans le frontmatter — utile pour les commandes externes et l'intégration Calibre"
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.storeAbsolutePath)
          .onChange(async (v) => {
            this.plugin.settings.storeAbsolutePath = v;
            await this.plugin.saveSettings();
          })
      );

    // ── Calibre ───────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Intégration Calibre" });

    new Setting(containerEl)
      .setName("Activer Calibre")
      .setDesc("Permet d'ajouter les epubs à votre bibliothèque Calibre")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.calibreEnabled)
          .onChange(async (v) => {
            this.plugin.settings.calibreEnabled = v;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.calibreEnabled) {
      new Setting(containerEl)
        .setName("Chemin vers calibredb")
        .setDesc(
          `Laissez vide pour la détection automatique (détecté : ${findCalibreDb()})`
        )
        .addText((text) =>
          text
            .setPlaceholder("/opt/calibre/calibredb")
            .setValue(this.plugin.settings.calibreDbPath)
            .onChange(async (v) => {
              this.plugin.settings.calibreDbPath = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Dossier de la bibliothèque")
        .setDesc(
          "Chemin local vers votre dossier Calibre, ou URL calibre-server (ex: http://localhost:8080/#My_Library)"
        )
        .addText((text) => {
          text
            .setPlaceholder("/home/user/Calibre Library")
            .setValue(this.plugin.settings.calibreLibraryPath)
            .onChange(async (v) => {
              this.plugin.settings.calibreLibraryPath = v;
              await this.plugin.saveSettings();
            });
          text.inputEl.style.width = "300px";
        });

      // Credentials (only shown if URL looks like a server)
      new Setting(containerEl)
        .setName("Utilisateur (calibre-server)")
        .setDesc("Optionnel — uniquement pour calibre-server avec authentification")
        .addText((text) =>
          text
            .setValue(this.plugin.settings.calibreUsername)
            .onChange(async (v) => {
              this.plugin.settings.calibreUsername = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Mot de passe (calibre-server)")
        .addText((text) => {
          text
            .setValue(this.plugin.settings.calibrePassword)
            .onChange(async (v) => {
              this.plugin.settings.calibrePassword = v;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
        });

      new Setting(containerEl)
        .setName("Ajouter automatiquement à Calibre")
        .setDesc(
          "Ajoute chaque nouvel epub à Calibre dès sa détection (en plus de créer la note)"
        )
        .addToggle((t) =>
          t
            .setValue(this.plugin.settings.calibreAddOnDetect)
            .onChange(async (v) => {
              this.plugin.settings.calibreAddOnDetect = v;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Stocker le lien Calibre dans la note")
        .setDesc(
          "Ajoute calibre_link: calibre://show-book/... dans le frontmatter — ouvre directement le livre dans Calibre au clic"
        )
        .addToggle((t) =>
          t
            .setValue(this.plugin.settings.calibreStoreLinkInNote)
            .onChange(async (v) => {
              this.plugin.settings.calibreStoreLinkInNote = v;
              await this.plugin.saveSettings();
            })
        );

      // Test connection
      new Setting(containerEl)
        .setName("Tester la connexion Calibre")
        .addButton((btn) =>
          btn.setButtonText("Tester").onClick(async () => {
            const result = await testCalibreConnection(this.plugin.settings);
            new Notice(
              result.ok
                ? `✅ ${result.message}`
                : `❌ ${result.message}`
            );
          })
        );
    }

    // ── Actions manuelles ────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Actions" });

    new Setting(containerEl)
      .setName("Scanner maintenant")
      .setDesc("Lance un scan immédiat de tous les dossiers surveillés")
      .addButton((btn) =>
        btn.setButtonText("Lancer le scan").onClick(async () => {
          const count = await this.plugin.scanAll();
          new Notice(`Epub Shelf : ${count} note(s) créée(s)`);
        })
      );
  }

  private renderFolderList(container: HTMLElement): void {
    container.empty();
    const folders = this.plugin.settings.watchedFolders;

    if (!folders.length) {
      container.createEl("p", {
        text: "Aucun dossier surveillé. Ajoutez-en un ci-dessous.",
        cls: "epub-shelf-empty",
      });
      return;
    }

    for (const folder of folders) {
      this.renderFolderRow(container, folder);
    }
  }

  private renderFolderRow(container: HTMLElement, folder: WatchedFolder): void {
    const row = container.createDiv("epub-shelf-folder-row");

    // Source path
    new Setting(row)
      .setName("Dossier source (chemin absolu)")
      .setDesc("Dossier système contenant les epubs")
      .addText((text: TextComponent) => {
        text
          .setPlaceholder("/home/user/ebooks")
          .setValue(folder.sourcePath)
          .onChange(async (v) => {
            folder.sourcePath = v;
            await this.plugin.saveSettings();
            this.plugin.restartWatcher(folder.id);
          });
        text.inputEl.style.width = "300px";
      });

    // Target folder
    new Setting(row)
      .setName("Dossier cible dans le vault")
      .setDesc("Où créer les notes (chemin relatif)")
      .addText((text) =>
        text
          .setPlaceholder("Books")
          .setValue(folder.targetFolder)
          .onChange(async (v) => {
            folder.targetFolder = v || "Books";
            await this.plugin.saveSettings();
          })
      );

    // Recursive
    new Setting(row)
      .setName("Inclure les sous-dossiers")
      .addToggle((t) =>
        t.setValue(folder.recursive).onChange(async (v) => {
          folder.recursive = v;
          await this.plugin.saveSettings();
          this.plugin.restartWatcher(folder.id);
        })
      );

    // Remove button
    new Setting(row).addButton((btn) =>
      btn
        .setButtonText("Supprimer")
        .setWarning()
        .onClick(async () => {
          this.plugin.stopWatcher(folder.id);
          this.plugin.settings.watchedFolders =
            this.plugin.settings.watchedFolders.filter(
              (f) => f.id !== folder.id
            );
          await this.plugin.saveSettings();
          this.display();
        })
    );

    row.style.borderBottom = "1px solid var(--background-modifier-border)";
    row.style.paddingBottom = "12px";
    row.style.marginBottom = "12px";
  }
}
