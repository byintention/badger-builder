# Badger Builder

Flexible landing-page sections for Grav 2 Admin2. Store multiple content blocks in a single page's front matter as `header.sections`, edit them with a custom Admin2 field, and render with theme-agnostic plugin Twig and CSS.

## Requirements

- Grav 2.0.0-rc.1+
- [API plugin](https://github.com/getgrav/grav-plugin-api) (Admin2)
- PHP 8.1+

## Installation

1. Copy or install the plugin to `user/plugins/badger-builder` (or install a curated release zip from Gitea — see **Private updates** below).
2. Enable in Admin2 **Plugins** or set `user/config/plugins/badger-builder.yaml`:

```yaml
enabled: true
```

3. Clear cache: `bin/grav clearcache`

This plugin is **not** on official GPM (`gpm: false`). Updates use private Gitea Releases.

## Private updates (Gitea Releases)

Admin Next → **Badger Builder** (sidebar) checks Gitea for a curated zip and can install it in place.

### Site configuration

Put the access token in **site** config (not in the plugin git repo):

`user/config/plugins/badger-builder.yaml`:

```yaml
updates:
  enabled: true
  base_url: https://gitea.com
  owner: byintention
  repo: badgerbuilder
  token: 'YOUR_GITEA_TOKEN'   # read:repository (releases + assets)
  asset_prefix: badger-builder-
  prerelease: false
```

Defaults for owner/repo/base URL also live in plugin settings (Plugins → Badger Builder). Never commit the token.

### Release checklist (maintainers)

1. Bump `version` in `blueprints.yaml`.
2. Prepend a `# vX.Y.Z` section to `CHANGELOG.md`.
3. Commit and tag `vX.Y.Z` (leading `v` required).
4. Push the tag — `.gitea/workflows/release.yaml` builds `badger-builder-X.Y.Z.zip` (top-level `badger-builder/` folder) and attaches it to the Gitea Release.

The zip excludes `.git`, `.cursor`, `.gitea`, tests, and similar. **Theme** panels/templates under `user/themes/.../badger-builder/` are site-owned and are **not** in the zip / not overwritten by updates.

### API

| Route | Permission | Description |
|-------|------------|-------------|
| `GET /api/v1/badger-builder/updates` | `admin.badger-builder.read` | Current vs latest release status |
| `POST /api/v1/badger-builder/updates/apply` | `admin.badger-builder.write` | Download curated zip and install |

## Usage

1. Create or edit a page and choose the **Badger Builder** template (`badger-builder.md`).
2. Open the **Sections** tab to add, duplicate, reorder, and edit sections.
3. Upload images on the page **Media** tab; reference filenames in hero/text image fields.

Each section is rendered with an auto-generated HTML `id` (`panel-1`, `panel-2`, …) based on its position in the list.

## Built-in panels

| Panel | Purpose |
|-------|---------|
| `hero` | Full-width hero with title, rich body (HTML via Modern Editor), optional background image, background colour |
| `features` | Grid of feature cards with heading, text, icon label, optional link |
| `text` | Two-column text + optional image |
| `full` | Full-width rich body (HTML; legacy Markdown still renders) |
| `filler` | Vertical spacer (small / medium / large) |
| `boxes` | Flex row of rich-text boxes with per-box and panel-level CSS classes |
| `faq` | UIkit accordion of Title + rich Content items |
| `opener` | Opening `<div>` with optional CSS classes; wrap later sections until a Closer |
| `closer` | Closing `</div>` for a matching Opener |

Pair Opener with Closer yourself (nesting is allowed). An unmatched pair produces invalid HTML.

Panel definitions live in `panels/*.yaml` (merged with optional theme / `user/data` Local YAML). Plugin settings control which panels appear in the editor (`enabled_panels`).

## API endpoints

| Route | Permission | Description |
|-------|------------|-------------|
| `GET /api/v1/badger-builder/panels` | `api.pages.read` | Panel schemas for the sections field |
| `GET /api/v1/badger-builder/config` | `api.access` | UI config (enabled panels, defaults) |
| `GET /api/v1/badger-builder/updates` | `admin.badger-builder.read` | Gitea release update status |
| `POST /api/v1/badger-builder/updates/apply` | `admin.badger-builder.write` | Install curated release zip |

## Theme integration

Public pages extend the active theme's `partials/base.html.twig` (header, footer, nav). Section markup uses plugin Twig partials and `.bb-*` CSS.

To override section markup, place Twig under the active theme at `badger-builder/templates/sections/{id}.html.twig` (plugin registers this path). Legacy override via `templates/sections/{id}.html.twig` still works if present.

To override or add panel **schemas** (ACF-style Local YAML), place files in the active theme at `badger-builder/panels/{id}.yaml`. Later load points win by `id`. New custom panel ids must also be listed in site `enabled_panels`. See that folder’s README on `intention-base`.

Disable built-in CSS in plugin settings if your theme provides its own styles.

## Page data shape

```yaml
sections:
  - panel: hero
    hero_title: Welcome
    hero_body: "Markdown **body**"
    hero_image: hero.jpg
    hero_align: center
    hero_background: transparent
  - panel: features
    features_background: primary
    features:
      - header: Fast
        text: "Lightning quick"
        icon: bolt
        url: ""
  - panel: full
    full_width: 100
    full_overall_classes: ""
    full_background: transparent
    full_body: "## Section title\n\nMarkdown **body** with optional HTML."
  - panel: boxes
    boxes_overall_classes: ""
    boxes_container_classes: ""
    boxes_valign: center
    boxes_background: white
    boxes:
      - body: "## Box one\n\nMarkdown **content**."
        classes: ""
      - body: "## Box two\n\nMore content."
        classes: "my-custom-class"
  - panel: faq
    faq_background: transparent
    faq:
      - title: "What is this?"
        content: "Markdown **answer**."
      - title: "Another question"
        content: "More detail."
  - panel: opener
    opener_classes: container
  - panel: full
    full_body: "Wrapped in the opener div."
  - panel: closer
```

Background values are `transparent` or a hyphenized theme colour label (from the active theme’s Global Settings colours list). The front-end class is `bg-{value}` (e.g. `bg-primary`), matching theme utility classes.

FAQ uses UIkit 3 accordion markup (`uk-accordion`); the active theme must load UIkit (Intention does).
## License

MIT
