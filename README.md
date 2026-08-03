# Badger Builder

Flexible landing-page sections for Grav 2 Admin2. Store multiple content blocks in a single page's front matter as `header.sections`, edit them with a custom Admin2 field, and render with theme-agnostic plugin Twig and CSS.

## Requirements

- Grav 2.0.0-rc.1+
- [API plugin](https://github.com/getgrav/grav-plugin-api) (Admin2)
- PHP 8.1+

## Installation

1. Copy or install the plugin to `user/plugins/badger-builder`.
2. Enable in Admin2 **Plugins** or set `user/config/plugins/badger-builder.yaml`:

```yaml
enabled: true
```

3. Clear cache: `bin/grav clearcache`

## Usage

1. Create or edit a page and choose the **Badger Builder** template (`badger-builder.md`).
2. Open the **Sections** tab to add, reorder, and edit sections.
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

Panel definitions live in `panels/*.yaml` (merged with optional theme / `user/data` Local YAML). Plugin settings control which panels appear in the editor (`enabled_panels`).

## API endpoints

| Route | Permission | Description |
|-------|------------|-------------|
| `GET /api/v1/badger-builder/panels` | `api.pages.read` | Panel schemas for the sections field |
| `GET /api/v1/badger-builder/config` | `api.access` | UI config (enabled panels, defaults) |

## Theme integration

Public pages extend the active theme's `partials/base.html.twig` (header, footer, nav). Section markup uses plugin Twig partials and `.bb-*` CSS.

To override section markup, place Twig under the active theme at `badger-builder/templates/sections/{id}.html.twig` (plugin registers this path). Legacy override via `templates/sections/{id}.html.twig` still works if present.

To override or add panel **schemas** (ACF-style Local YAML), place files in the active theme at `badger-builder/panels/{id}.yaml`. Later load points win by `id`. New custom panel ids must also be listed in site `enabled_panels`. See that folder’s README on `thepractice-accrete`.

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
```

Background values are `transparent` or a hyphenized theme colour label (from the active theme’s Global Settings colours list). The front-end class is `bg-{value}` (e.g. `bg-primary`), matching theme utility classes.

FAQ uses UIkit 3 accordion markup (`uk-accordion`); the active theme must load UIkit (Intention does).
## License

MIT
