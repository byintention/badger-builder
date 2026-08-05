
2026-08-04
Site media picker (TinyMCE windowManager): site_media fields + TinyMCE image insert; portable paths, absolute render.

2026-08-03
Section list Remove link replaced with Admin2-style trash icon delete button.

2026-08-03
Moved section Twig into theme badger-builder/templates/sections; plugin registers that path.

2026-08-03
Phase 1 Local YAML: panel schemas in panels/*.yaml; PanelLoader merges plugin → data → theme.

2026-07-23
Modern Editor stores HTML (not Markdown); bb_markdown passes through HTML and still parses legacy Markdown.

2026-07-23
Options tab: Job code (text) and Brand select (accrete/binosto/fultium/movymia) on Badger Builder pages.

2026-07-23
Markdown/textarea panel fields mount Modern Editor (TinyMCE) when available; Markdown storage preserved for bb_markdown.

2026-07-22
Added FAQ panel (UIkit accordion, Title + markdown Content items) and list-item drag reorder in Admin2.

2026-07-08
Background colour dropdowns use Transparent + active theme colours; front-end classes are bg-{slug} matching theme utilities.

2026-07-08
Added AGENTS.md, product-local conventions.mdc, and backfilled plugin changelog for product-scoped Cursor workspaces.

2026-07-07
Full panel: Overall classes field; overall classes, background, and width at one-third width at bottom of editor.

2026-07-07
Filler panel: Size and Background colour at half width; hero align + background at quarter width.

2026-07-07
Every panel has Background colour (none/light/white/dark/accent) via shared bb-panel-bg-* classes.

2026-07-07
Full panel container width slider (25–100%) on bb-panel-full-inner; new Admin2 range field type.

2026-07-07
Renamed classes to flat hyphens: bb-panel-* front-end, bb-admin-* Admin2; CSS split front vs admin.

2026-07-07
Added boxes repeater panel; full body uses bb_markdown; removed menu label/anchor fields (ids are panel-N).

2026-06-17
Added full and filler panels; fixed Sections select Save dirty-state; removed features_intro field.

2026-06-18
Initial Badger Builder plugin changelog — use this file for plugin-scoped task notes.

2026-05-28
Initial plugin: Admin2 sections field, PanelRegistry, theme-extends base, home demo page (integration workspace).
