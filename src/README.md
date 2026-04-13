# Epub Shelf — Plugin Obsidian

Plugin Obsidian qui surveille des dossiers contenant des fichiers `.epub` et crée automatiquement une note Markdown par livre, avec toutes les métadonnées extraites du fichier.

---

## Fonctionnalités

- **Surveillance en temps réel** : détecte tout nouvel epub déposé dans les dossiers configurés
- **Scan au démarrage** : traite les epubs déjà présents au lancement d'Obsidian
- **Extraction de métadonnées** : titre, auteur(s), éditeur, année, langue, ISBN, sujets, description, série
- **Couvertures** : extrait et sauvegarde la couverture dans le vault
- **Enrichissement OpenLibrary** : complète les métadonnées manquantes via l'API OpenLibrary
- **Tags automatiques** : depuis la langue et les sujets Dublin Core
- **Template personnalisable** : remplace le template par défaut par le vôtre
- **Multi-dossiers** : surveillez autant de dossiers que nécessaire, chacun avec son dossier cible

---

## Installation (développement)

### Prérequis

- Node.js 18+
- Un vault Obsidian

### Étapes

```bash
# 1. Cloner dans le dossier plugins de votre vault
cd /chemin/vault/.obsidian/plugins
cp -r /chemin/epub-shelf ./epub-shelf
cd epub-shelf

# 2. Installer les dépendances
npm install

# 3. Builder
npm run build
```

Puis dans Obsidian :
- **Paramètres → Plugins tiers** → désactiver le mode sécurisé
- Activer **Epub Shelf** dans la liste des plugins installés

### Dev avec hot-reload

```bash
npm run dev
```

---

## Configuration

Ouvrez **Paramètres → Epub Shelf** :

### Dossiers surveillés

Ajoutez un ou plusieurs dossiers. Pour chaque dossier :
- **Dossier source** : chemin absolu sur le système (`/home/user/ebooks`)
- **Dossier cible** : chemin relatif dans le vault (`Books` ou `Lectures/Romans`)
- **Inclure les sous-dossiers** : surveille récursivement

### Template personnalisé

Laissez vide pour le template par défaut. Variables disponibles :

| Variable | Description |
|---|---|
| `{{title}}` | Titre du livre |
| `{{author}}` | Premier auteur |
| `{{authors}}` | Tous les auteurs (séparés par `, `) |
| `{{year}}` | Année de publication |
| `{{publisher}}` | Éditeur |
| `{{language}}` | Code langue (`fr`, `en`…) |
| `{{isbn}}` | ISBN |
| `{{series}}` | Nom de la série |
| `{{series_index}}` | Numéro dans la série |
| `{{description}}` | Résumé (500 chars max) |
| `{{status}}` | Statut (valeur par défaut configurable) |
| `{{tags}}` | Tags séparés par `, ` |
| `{{epub}}` | Nom du fichier epub |
| `{{cover}}` | Nom du fichier couverture |
| `{{date_added}}` | Date d'ajout (YYYY-MM-DD) |

### Exemple de template personnalisé

```
---
title: {{title}}
author: {{author}}
year: {{year}}
status: {{status}}
tags: [{{tags}}]
epub: "[[{{epub}}]]"
date_added: {{date_added}}
---

![[{{cover}}]]

> {{description}}

## Résumé

## Notes de lecture

## Citations

```

---

## Usage avec Dataview

```dataview
TABLE author, year, status
FROM "Books"
WHERE status = "unread"
SORT year DESC
```

```dataview
TABLE author, year, tags
FROM "Books"
WHERE contains(tags, "science-fiction")
SORT title ASC
```

---

## Dépendances

- [`adm-zip`](https://github.com/cthackers/adm-zip) — lecture des epub (ZIP + XML)
- [`chokidar`](https://github.com/paulmillr/chokidar) — surveillance du système de fichiers
- [`uuid`](https://github.com/uuidjs/uuid) — identifiants uniques pour les dossiers

---

## Limitations

- **Desktop uniquement** (`isDesktopOnly: true`) — la surveillance de dossiers système n'est pas possible sur mobile
- Les epubs très mal formés (sans `content.opf`) génèrent une note minimale avec juste le nom du fichier comme titre
- OpenLibrary peut être lente ou indisponible — l'enrichissement est optionnel et non-bloquant
