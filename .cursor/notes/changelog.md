2026-10-07
Removed the Options tab Site meta section (job code field and brand dropdown).

2026-10-06
TinyMCE Paragraph menu heading previews inherit 14px/24px; Formats menu CSS left unchanged.

2026-10-05
Restored TinyMCE Paragraph/Formats menus to before the heading-overlap CSS and preview_styles changes.

2026-10-05
Media picker overlay sits above Modern Editor’s TinyMCE image dialog so browse/insert is usable.

2026-10-05
Media picker Edit save dialog defaults to webp; replace keeps the chosen extension instead of forcing the original.

2026-10-02
Sections field no longer remounts editors on every Admin2 field/value write-back, so typing and clicks keep focus.

2026-10-02
bb_markdown now runs shortcode-core handlers when that plugin is available, so panel bodies can include shortcodes.

2026-09-05
Oversized drops auto-resize to 1920px before upload; Cancel no longer posts the original file that Grav rejects with 422.

2026-09-04
Resize-large-image confirm uses window-level pointerdown so drop uploads can actually choose Resize and upload.

2026-09-04
Media picker confirm dialogs sit above Filerobot overlays so Resize and upload actually receives clicks.

2026-09-04
Media picker loads a local Filerobot 4.8.1 UMD from plugin assets instead of the Scaleflex CDN.

2026-09-04
Media picker prompts to resize images over 1920px on the longest edge before upload, instead of failing.

2026-09-04
Media picker caption and description fields use two-row textareas.

2026-09-04
Filerobot crop-ratio menu sits above the picker overlay; crop starts freeform with common aspect presets.

2026-09-04
Media picker is wider; details Edit opens Filerobot for crop, rotate, and resize, saving as a new file or replacing the original.

2026-09-04
Media picker grid scrolls; image URLs percent-encode folder names with spaces so front-end src/srcset still load.

2026-09-03
Site media picker is a three-pane overlay (folder tree, grid, details) with drag-and-drop upload, folder ops, and metadata — no TinyMCE dialog.



2026-09-02
Added Opener and Closer panels: wrap later sections in a classed div.


2026-08-25
Pages list shows meta-description traffic lights in a Meta column on tree, list, and miller views.


2026-08-25
Meta description length status shows Poor / OK / Good text as well as colour.

2026-08-25
Move meta description to a Metadata tab on all page templates; length icon sits under the field help.

2026-08-25
Meta description field shows a live length icon (green / amber / red).

2026-08-25
Add a meta description field on Badger Builder page Options.

2026-08-25
Standalone site_media Admin Next field: TinyMCE site library picker for page blueprints.

2026-08-24
Testimonials panel: heading plus a halves row for display mode and background colour.

2026-08-24
Add section row padding below increased to 48px.

2026-08-24
Padding below the Add section dropdown and button.

2026-08-24
Add item buttons use primary blue; removed hardcoded purple button styles.

2026-08-24
List item headers use the same muted grey bar as the section card.

2026-08-24
Hero panel Choose from site media buttons use primary blue.

2026-08-24
Text panel admin: image column stacks caption; config row is overall classes, background, align.

2026-08-06
Private Gitea Releases updater: Actions zip, PluginUpdater, Admin Updates page + API.

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
