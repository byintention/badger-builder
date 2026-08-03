# Badger Builder — agent guide

Grav **2.0** Admin2 page-builder plugin. Workspace root is this directory only.

## Scope

- Edit **only** files under this plugin tree.
- Do **not** change `user/config/`, `user/pages/`, themes, other plugins, or parent `grav-admin/.cursor/`.
- Plugin enablement, site config, and demo page content: **describe steps for the user**; do not apply them here.

See [`.cursor/rules/scope-badger-builder.mdc`](.cursor/rules/scope-badger-builder.mdc). Workspace model (same Grav install): [`user/themes/intention/docs/cursor-workspaces.md`](../../themes/intention/docs/cursor-workspaces.md).

## Skills

Before implementation that touches API routes, Admin2, or `admin-next/`, read [`.cursor/skills/`](.cursor/skills/) and follow the matching skill:

| Task | Skill |
|------|--------|
| REST API only | `grav-api-integration.md` |
| Admin2 / `onApi*` / `admin-next/` / custom fields | `grav-api-admin-next-integration.md` |

Panel Twig/CSS-only work still follows [`.cursor/rules/conventions.mdc`](.cursor/rules/conventions.mdc); read skills when the Admin2 field or API changes.

## Conventions

### CSS

| File | Purpose |
|------|---------|
| [`assets/css/badger-builder.css`](assets/css/badger-builder.css) | Front-end `.bb-panel-*` |
| [`assets/css/badger-builder-admin.css`](assets/css/badger-builder-admin.css) | Admin2 `.bb-admin-*` (lazy-loaded by `sections.js`) |

No inline `<style>` in JS unless the user asks. Class names: single hyphens only (`bb-panel-hero-body`, not BEM `__` / `--`).

### New panel checklist

1. Add schema in [`classes/PanelRegistry.php`](classes/PanelRegistry.php) (fields, defaults, optional `width`: `quarter` / `half` / `third`).
2. Add Twig partial [`templates/sections/{id}.html.twig`](templates/sections/) — use `bg-{{ bg }}` (theme colour slug) when the panel has a background field; default `transparent`, alias legacy `none` → `transparent`.
3. Add front-end styles in `badger-builder.css`.
4. Register in plugin defaults [`badger-builder.yaml`](badger-builder.yaml) and admin options [`blueprints.yaml`](blueprints.yaml) (`enabled_panels` / `default_panel`).
5. Update [`README.md`](README.md) panel table and sample YAML if the data shape changed.
6. If Admin2 layout needs a special field row (quarters/halves/thirds), update [`admin-next/fields/sections.js`](admin-next/fields/sections.js) `_renderSection` and admin CSS as needed.

Shared background options: use `backgroundField()` in `PanelRegistry`. Options are **Transparent** plus the active theme’s `colours` list (API fills options via `withBackgroundOptions()`). Front-end class is `bg-{hyphenize(label)}`, matching theme utility classes.

### Admin2 sections field

- Custom field: [`admin-next/fields/sections.js`](admin-next/fields/sections.js) (type = filename).
- Schemas come from `GET /api/v1/badger-builder/panels`; UI config from `/badger-builder/config`.
- Prefer extending existing field types (`text`, `markdown`, `select`, `range`, `list`, `page_media`) over one-off UI.
- Drag reorder: only the `⋮⋮` handle is `draggable` (not the whole card).
- Long text (`markdown` / `textarea`) mounts **Modern Editor** (`grav-modern-editor--moderneditor`) when that plugin is enabled; values are stored as **HTML** (`markdown_enabled: false`) so tags like `<sup>` and `<a class="btn btn-arrow">` round-trip cleanly. If Modern Editor is missing, Badger falls back to plain textareas.

### Theme integration (do not edit themes here)

- Page template [`templates/badger-builder.html.twig`](templates/badger-builder.html.twig) extends the **active theme’s** `partials/base.html.twig`.
- Themes may override section markup via `templates/sections/{panel}.html.twig`.
- Some themes wrap `{% block body %}` in a content container (e.g. UIkit `uk-container`). Full-bleed heroes may look constrained — that is a **theme** fix; describe it for the user or handle it in the Intention workspace.

### Markdown

Panel bodies use the `bb_markdown` Twig filter (`TwigExtension` / `MarkdownHelper`). Prefer that over raw `|markdown`. The filter **passes through HTML** (TinyMCE output) and still runs Parsedown for **legacy Markdown** content that does not start with `<`.

## Changelog

After completing a task, prepend two lines to [`.cursor/notes/changelog.md`](.cursor/notes/changelog.md) (date + ≤30-word summary). Do **not** write to parent `grav-admin/.cursor/notes/changelog.md`.

## Out of scope here

Site plugin enablement, `user/config/plugins/badger-builder.yaml`, page front matter, and Intention theme chrome belong in the **grav-admin** integration workspace or Admin UI — not this repo.
