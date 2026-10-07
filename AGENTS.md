# Badger Builder — agent guide

Grav **2.0** Admin2 page-builder plugin. Workspace root is this directory only.

## Scope

- Edit **only** files under this plugin tree.
- Do **not** change `user/config/`, `user/pages/`, themes, other plugins, or parent `grav-admin/.cursor/`.
- Plugin enablement, site config, and demo page content: **describe steps for the user**; do not apply them here.

See [`.cursor/rules/scope-badger-builder.mdc`](.cursor/rules/scope-badger-builder.mdc). Workspace model (same Grav install): [`user/themes/intention-base/docs/cursor-workspaces.md`](../../themes/intention-base/docs/cursor-workspaces.md).

## Skills

Before implementation that touches API routes, Admin2, or `admin-next/`, read `[.cursor/skills/](.cursor/skills/)` and follow the matching skill:


| Task                                              | Skill                                |
| ------------------------------------------------- | ------------------------------------ |
| REST API only                                     | `grav-api-integration.md`            |
| Admin2 / `onApi*` / `admin-next/` / custom fields | `grav-api-admin-next-integration.md` |


Panel Twig/CSS-only work still follows `[.cursor/rules/conventions.mdc](.cursor/rules/conventions.mdc)`; read skills when the Admin2 field or API changes.

## Conventions

### CSS


| File                                                                         | Purpose                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
|                                                                              |                                                     |
| `[assets/css/badger-builder-admin.css](assets/css/badger-builder-admin.css)` | Admin2 `.bb-admin-*` (lazy-loaded by `sections.js`) |


No inline `<style>` in JS or HTML unless the user asks. Class names: single hyphens only (`bb-panel-hero-body`, not BEM `__` / `--`).

### New panel checklist

1. Add schema YAML in `[panels/{id}.yaml](panels/)` (fields, defaults, optional `width`: `quarter` / `half` / `third`). Theme overrides: active theme `badger-builder/panels/{id}.yaml` (whole panel replace by `id`).
2. Add Twig partial under the active theme at `badger-builder/templates/sections/{id}.html.twig` — use `bg-{{ bg }}` (theme colour slug) when the panel has a background field; default `transparent`, alias legacy `none` → `transparent`. (Plugin registers that Twig path ahead of its own templates.)
3. Add front-end styles in `badger-builder.css` and/or the active theme CSS.
4. Register in plugin defaults `[badger-builder.yaml](badger-builder.yaml)` and admin options `[blueprints.yaml](blueprints.yaml)` (`enabled_panels` / `default_panel`). Custom theme panel ids: list them in site `user/config/plugins/badger-builder.yaml` → `enabled_panels`.
5. Update `[README.md](README.md)` panel table and sample YAML if the data shape changed.
6. If Admin2 layout needs a special field row (quarters/halves/thirds), update `[admin-next/fields/sections.js](admin-next/fields/sections.js)` `_renderSection` and admin CSS as needed.

Shared background options: use a `*_background` select field in panel YAML (placeholder `transparent` option). The panels API fills options via `PanelRegistry::withBackgroundOptions()` from the active theme’s `colours` list. Front-end class is `bg-{hyphenize(label)}`, matching theme utility classes.

Local YAML load order (last wins): plugin `panels/` → `user/data/{data_path}` → theme `{theme_path}`. See `local_panels` in plugin config. Loader: `[classes/PanelLoader.php](classes/PanelLoader.php)`.

### Admin2 sections field

- Custom field: `[admin-next/fields/sections.js](admin-next/fields/sections.js)` (type = filename).
- Schemas come from `GET /api/v1/badger-builder/panels`; UI config from `/badger-builder/config`.
- Prefer extending existing field types (`text`, `markdown`, `select`, `range`, `list`, `site_media`) over one-off UI.
- Drag reorder: only the `⋮⋮` handle is `draggable` (not the whole card).
- Long text (`markdown` / `textarea`) mounts **Modern Editor** (`grav-modern-editor--moderneditor`) when that plugin is enabled; values are stored as **HTML** (`markdown_enabled: false`) so tags like `<sup>` and `<a class="btn btn-arrow">` round-trip cleanly. If Modern Editor is missing, Badger falls back to plain textareas.
- `**site_media`** (alias `page_media` inside the sections field): opens the shared three-pane site media picker (`admin-next/fields/bb-media-picker.js`). Stores a portable relative path under `user/media` plus companion `{name}_alt`. No page-media uploads on Badger Builder pages (`header.media_order` unset). TinyMCE image insert uses the same picker via `file_picker_callback` and stores root-relative `/user/media/...` `src` values; front-end Twig/`bb_markdown` absoluteizes for the live domain. Details pane **Edit** opens a vendored Filerobot build (`assets/vendor/filerobot-image-editor/`, crop/rotate/resize); Save writes a new file, with an optional replace-original.
- Standalone page-blueprint field: `admin-next/fields/site_media.js` (`type: site_media`). Same picker; optional `alt_field` writes the companion alt (default `{name}_alt`). Themes may use this for featured images and similar header fields.
- Meta description: `admin-next/fields/meta_description.js` (`type: meta_description`). Live length status under the field help — Good 150–160 characters, OK 120–149, Poor if shorter or longer (colour, Poor/OK/Good, and character count). Injected on a **Metadata** tab for every page template via `onApiBlueprintResolved`.

### Theme integration (do not edit themes here)

- Page template `[templates/badger-builder.html.twig](templates/badger-builder.html.twig)` extends the **active theme’s** `partials/base.html.twig`.
- Themes may override section markup via `badger-builder/templates/sections/{panel}.html.twig` (preferred) or legacy `templates/sections/{panel}.html.twig`.
- Themes may override / add panel **schemas** via `badger-builder/panels/{id}.yaml` (Local YAML; see theme folder README).
- Some themes wrap `{% block body %}` in a content container (e.g.  `container`). Full-bleed heroes may look constrained — that is a **theme** fix; describe it for the user or handle it in the Intention workspace.

### Markdown

Panel bodies use the `bb_markdown` Twig filter (`TwigExtension` / `MarkdownHelper`). Prefer that over raw `|markdown`. The filter **passes through HTML** (TinyMCE output) and still runs Parsedown for **legacy Markdown** content that does not start with `<`.

## Private updates

- Source of truth: Gitea Releases on `https://gitea.com/byintention/badgerbuilder` with curated `badger-builder-{version}.zip` assets (Gitea Actions on `v*` tags).
- Runtime: `classes/Updates/*`, API `GET/POST …/badger-builder/updates*`, Admin page `admin-next/pages/badger-builder.js`.
- Site token: `user/config/plugins/badger-builder.yaml` → `updates.token` (describe for the user; do not write secrets from this workspace).
- Do **not** publish to official GPM; `gpm: false` in `blueprints.yaml`.
- Theme `badger-builder/` panels/templates are out of scope for plugin zips.

## Changelog

After completing a task, prepend two lines to `[.cursor/notes/changelog.md](.cursor/notes/changelog.md)` (date + ≤30-word summary). Do **not** write to parent `grav-admin/.cursor/notes/changelog.md`. Product release notes go in root `[CHANGELOG.md](CHANGELOG.md)` (`# vX.Y.Z` sections) when cutting a release.

## Out of scope here

Site plugin enablement, `user/config/plugins/badger-builder.yaml` (including update tokens), page front matter, and theme chrome belong in the **grav-admin** integration workspace or Admin UI — not this repo.