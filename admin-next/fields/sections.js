/**
 * sections — Badger Builder custom Admin2 field.
 *
 * Manages header.sections: add/duplicate/reorder/remove rows, per-panel field editors.
 * Styles: assets/css/badger-builder-admin.css (loaded via _ensureStylesheet).
 * Long text (markdown/textarea) uses Modern Editor when available (HTML storage).
 */

const TAG = window.__GRAV_FIELD_TAG;
const MODERN_EDITOR_TAG = 'grav-modern-editor--moderneditor';
const MODERN_EDITOR_SLUG = 'modern-editor';
const MODERN_EDITOR_TYPE = 'moderneditor';

/** @type {Promise<string|null>|null} */
let modernEditorLoadPromise = null;

/** WordPress-parity TinyMCE style formats (selector/inline + classes). */
const BADGER_STYLE_FORMATS = [
    { title: 'Positive', selector: 'p', classes: 'positive' },
    { title: 'Error', selector: 'p', classes: 'negative' },
    { title: 'Warning', selector: 'p', classes: 'warning' },
    { title: 'Smaller text', selector: 'p', classes: 'text-sm' },
    { title: 'Larger text', selector: 'p', classes: 'text-lg' },
    { title: 'Super large text', selector: 'p', classes: 'text-xl' },
    { title: 'Button', selector: 'a', classes: 'btn' },
    { title: 'Chip', inline: 'span', classes: 'chip' },
];

/**
 * Resolve theme editor.css URL for TinyMCE content_css.
 * @param {string|null|undefined} editorCss
 * @returns {string|null}
 */
function resolveEditorCssUrl(editorCss) {
    if (!editorCss || typeof editorCss !== 'string') {
        return null;
    }
    if (/^https?:\/\//i.test(editorCss) || editorCss.startsWith('//')) {
        return editorCss;
    }
    const base = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
    if (editorCss.startsWith('/')) {
        return `${base}${editorCss}`;
    }
    return `${base}/${editorCss}`;
}

/**
 * Use TinyMCE's folder icon for the image dialog browse control (default is "browse").
 * @param {typeof window.tinymce} tinymce
 */
function overrideBrowseIconWithFolder(tinymce) {
    if (!tinymce?.IconManager || tinymce.__badgerBrowseIconFolder) {
        return;
    }
    const pack = tinymce.IconManager.get('default') || { icons: {} };
    const icons = pack.icons || {};
    const folder = icons.folder;
    if (!folder) {
        return;
    }
    tinymce.IconManager.add('default', {
        icons: {
            ...icons,
            browse: folder,
        },
    });
    tinymce.__badgerBrowseIconFolder = true;
}

/**
 * Merge Badger style_formats / block_formats / editor.css / file picker into TinyMCE init opts.
 * @param {Record<string, unknown>} opts
 * @param {string|null} editorCssUrl
 * @returns {Record<string, unknown>}
 */
function mergeTinyMceStyleOpts(opts, editorCssUrl) {
    const next = { ...(opts || {}) };
    next.style_formats = BADGER_STYLE_FORMATS;
    next.style_formats_merge = false;
    next.block_formats = 'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; Heading 4=h4; Heading 5=h5; Heading 6=h6';
    next.file_picker_types = 'image';
    next.file_picker_callback = (callback, _value, meta) => {
        if (meta?.filetype && meta.filetype !== 'image') {
            return;
        }
        ensureBadgerMediaPicker().then((picker) => {
            return picker.open({
                title: 'Insert image',
                onInsert({ url, alt }) {
                    callback(url, { alt: alt || '' });
                },
            });
        }).catch((err) => {
            console.warn('[badger-builder] Media picker failed', err);
        });
    };

    if (editorCssUrl) {
        const existing = next.content_css;
        if (Array.isArray(existing)) {
            next.content_css = existing.includes(editorCssUrl)
                ? existing
                : [...existing, editorCssUrl];
        } else if (existing) {
            next.content_css = existing === editorCssUrl
                ? existing
                : [existing, editorCssUrl];
        } else {
            next.content_css = editorCssUrl;
        }
    }

    const spanClass = 'span[class|id|style|title|data-*]';
    const pClass = 'p[class|id|style|dir|lang]';
    const extended = typeof next.extended_valid_elements === 'string'
        ? next.extended_valid_elements
        : '';
    const extras = [];
    if (!extended.includes('span[')) {
        extras.push(spanClass);
    }
    if (!extended.includes('p[')) {
        extras.push(pClass);
    }
    if (extras.length) {
        next.extended_valid_elements = extended
            ? `${extended},${extras.join(',')}`
            : extras.join(',');
    }

    return next;
}

/** @type {Promise<typeof window.BadgerMediaPicker>|null} */
let mediaPickerLoadPromise = null;

function ensureBadgerMediaPicker() {
    if (window.BadgerMediaPicker) {
        return Promise.resolve(window.BadgerMediaPicker);
    }
    if (!mediaPickerLoadPromise) {
        mediaPickerLoadPromise = (async () => {
            const base = (window.__GRAV_API_SERVER_URL || '') + (window.__GRAV_API_PREFIX || '/api/v1');
            const h = { Accept: 'application/json' };
            const token = window.__GRAV_API_TOKEN;
            if (token) h['X-API-Token'] = token;
            const resp = await fetch(`${base}/gpm/plugins/badger-builder/fields`, { headers: h });
            if (!resp.ok) {
                throw new Error(`Badger fields HTTP ${resp.status}`);
            }
            const scripts = await resp.json();
            const code = scripts?.['bb-media-picker']
                ?? scripts?.data?.['bb-media-picker']
                ?? scripts?.fields?.['bb-media-picker'];
            if (typeof code !== 'string') {
                throw new Error('bb-media-picker field script missing');
            }
            const blob = new Blob([code], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            try {
                await import(url);
            } finally {
                URL.revokeObjectURL(url);
            }
            if (!window.BadgerMediaPicker) {
                throw new Error('BadgerMediaPicker failed to register');
            }
            return window.BadgerMediaPicker;
        })().catch((err) => {
            mediaPickerLoadPromise = null;
            throw err;
        });
    }
    return mediaPickerLoadPromise;
}

/**
 * Patch window.tinymce.init once (re-applies if TinyMCE is replaced).
 * @param {string|null|undefined} editorCss
 */
function installTinyMceStyleFormats(editorCss) {
    const editorCssUrl = resolveEditorCssUrl(editorCss);
    window.__BADGER_TINYMCE_EDITOR_CSS__ = editorCssUrl;

    const patchInstance = (tinymce) => {
        if (!tinymce || typeof tinymce.init !== 'function') {
            return;
        }
        overrideBrowseIconWithFolder(tinymce);
        if (tinymce.__badgerStyleFormatsPatched) {
            return;
        }
        const originalInit = tinymce.init.bind(tinymce);
        tinymce.init = (opts) => {
            overrideBrowseIconWithFolder(tinymce);
            return originalInit(
                mergeTinyMceStyleOpts(opts, window.__BADGER_TINYMCE_EDITOR_CSS__ || null),
            );
        };
        tinymce.__badgerStyleFormatsPatched = true;
    };

    patchInstance(window.tinymce);

    if (!window.__BADGER_TINYMCE_HOOK__) {
        window.__BADGER_TINYMCE_HOOK__ = true;
        let tinymceRef = window.tinymce;
        try {
            Object.defineProperty(window, 'tinymce', {
                configurable: true,
                enumerable: true,
                get() {
                    return tinymceRef;
                },
                set(value) {
                    tinymceRef = value;
                    patchInstance(value);
                },
            });
        } catch {
            // defineProperty may fail if tinymce is non-configurable; fall through to poll.
        }

        // ME may delete + reload tinymce; keep patching until stable.
        const pollId = window.setInterval(() => {
            patchInstance(window.tinymce);
        }, 200);
        window.setTimeout(() => window.clearInterval(pollId), 60000);
    } else {
        patchInstance(window.tinymce);
    }
}

class SectionsField extends HTMLElement {
    constructor() {
        super();
        this._value = [];
        this._field = null;
        this._panels = [];
        this._config = {};
        this._loading = true;
        this._error = null;
        this._expanded = new Set();
        this._dragIndex = null;
        this._listDrag = null;
        /** @type {string|null} */
        this._modernEditorTag = null;
    }

    set field(v) {
        // Admin2 reassigns field on every parent re-render. Store only — do not
        // wipe the DOM or Modern Editor instances lose focus on click/keypress.
        this._field = v;
    }
    get field() { return this._field; }

    set value(v) {
        const arr = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : [];
        const normalized = arr.map((s) => this._normalizeSection(s));
        // Admin2 writes value back after every change event. Skip remount when
        // the payload matches what we already hold (typing / TinyMCE edits).
        if (this._valuesEqual(normalized, this._value)) {
            return;
        }
        this._value = normalized;
        if (this.isConnected && !this._loading) this._render();
    }
    get value() {
        this._syncFieldsFromDom();
        return this._value;
    }

    _valuesEqual(a, b) {
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    connectedCallback() {
        this._ensureStylesheet();
        this._render();
        this._bootstrap();
    }

    _ensureStylesheet() {
        const id = 'badger-builder-admin-stylesheet';
        if (document.getElementById(id)) {
            return;
        }
        const base = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = `${base}/user/plugins/badger-builder/assets/css/badger-builder-admin.css`;
        document.head.appendChild(link);
    }

    // ─── API ───────────────────────────────────────────────────────────────
    _apiPath(path) {
        return (window.__GRAV_API_SERVER_URL || '') +
               (window.__GRAV_API_PREFIX || '/api/v1') + path;
    }

    _apiUrl(kind) {
        const fromField = this._field?.panel_endpoint
            || this._field?.layout_endpoint
            || '/badger-builder/panels';
        const configPath = this._field?.config_endpoint || '/badger-builder/config';
        const endpoint = kind === 'config' ? configPath : fromField;
        return this._apiPath(endpoint);
    }

    _headers() {
        const h = { Accept: 'application/json' };
        const token = window.__GRAV_API_TOKEN;
        if (token) h['X-API-Token'] = token;
        return h;
    }

    async _bootstrap() {
        this._loading = true;
        this._error = null;
        this._render();
        try {
            const [panelsResp, configResp] = await Promise.all([
                fetch(this._apiUrl('panels'), { headers: this._headers() }),
                fetch(this._apiUrl('config'), { headers: this._headers() }),
            ]);
            if (!panelsResp.ok) throw new Error(`Panels HTTP ${panelsResp.status}`);
            if (!configResp.ok) throw new Error(`Config HTTP ${configResp.status}`);
            const panelsJson = await panelsResp.json();
            const configJson = await configResp.json();
            this._panels = panelsJson.data?.panels ?? panelsJson.panels
                ?? panelsJson.data?.layouts ?? panelsJson.layouts ?? [];
            this._config = configJson.data ?? configJson;
            installTinyMceStyleFormats(this._config.editor_css);
            this._modernEditorTag = await this._ensureModernEditor();
            installTinyMceStyleFormats(this._config.editor_css);
            ensureBadgerMediaPicker().catch(() => {});
        } catch (e) {
            this._error = e.message || String(e);
            this._panels = [];
        } finally {
            this._loading = false;
            this._render();
        }
    }

    // ─── Modern Editor (optional nest) ───────────────────────────────────────
    async _ensureModernEditor() {
        if (customElements.get(MODERN_EDITOR_TAG)) {
            return MODERN_EDITOR_TAG;
        }
        if (!modernEditorLoadPromise) {
            modernEditorLoadPromise = this._loadModernEditorElement().catch((err) => {
                console.warn('[badger-builder] Modern Editor unavailable; using textarea fallback.', err);
                modernEditorLoadPromise = null;
                return null;
            });
        }
        return modernEditorLoadPromise;
    }

    async _loadModernEditorElement() {
        if (customElements.get(MODERN_EDITOR_TAG)) {
            return MODERN_EDITOR_TAG;
        }

        const loading = window.__GRAV_FIELD_LOADING ?? (window.__GRAV_FIELD_LOADING = {});
        const bundles = window.__GRAV_FIELD_BUNDLES ?? (window.__GRAV_FIELD_BUNDLES = {});
        const bundleKey = `plugins/${MODERN_EDITOR_SLUG}`;

        if (loading[MODERN_EDITOR_TAG]) {
            await loading[MODERN_EDITOR_TAG];
            return customElements.get(MODERN_EDITOR_TAG) ? MODERN_EDITOR_TAG : null;
        }

        loading[MODERN_EDITOR_TAG] = (async () => {
            let bundlePromise = bundles[bundleKey];
            if (!bundlePromise) {
                bundlePromise = fetch(this._apiPath(`/gpm/plugins/${MODERN_EDITOR_SLUG}/fields`), {
                    headers: this._headers(),
                }).then(async (resp) => {
                    if (!resp.ok) {
                        throw new Error(`Modern Editor fields HTTP ${resp.status}`);
                    }
                    return resp.json();
                });
                bundles[bundleKey] = bundlePromise;
            }

            const scripts = await bundlePromise;
            const code = scripts?.[MODERN_EDITOR_TYPE];
            if (typeof code !== 'string') {
                throw new Error('moderneditor field script missing from modern-editor bundle');
            }

            const prevTag = window.__GRAV_FIELD_TAG;
            window.__GRAV_FIELD_TAG = MODERN_EDITOR_TAG;
            const blob = new Blob(
                [`window.__GRAV_FIELD_TAG = ${JSON.stringify(MODERN_EDITOR_TAG)};\n${code}`],
                { type: 'application/javascript' },
            );
            const url = URL.createObjectURL(blob);
            try {
                await import(url);
            } catch (err) {
                if (!customElements.get(MODERN_EDITOR_TAG)) {
                    throw err;
                }
            } finally {
                URL.revokeObjectURL(url);
                if (prevTag !== undefined) {
                    window.__GRAV_FIELD_TAG = prevTag;
                } else {
                    delete window.__GRAV_FIELD_TAG;
                }
            }

            if (!customElements.get(MODERN_EDITOR_TAG)) {
                throw new Error('Modern Editor custom element failed to register');
            }
        })();

        await loading[MODERN_EDITOR_TAG];
        return MODERN_EDITOR_TAG;
    }

    _useModernEditor() {
        return Boolean(this._modernEditorTag && customElements.get(this._modernEditorTag));
    }

    _longTextHostHtml({
        label,
        help = '',
        value = '',
        rows = 4,
        colClass = '',
        index,
        name,
        li = null,
        sub = null,
        nested = false,
        height = null,
    }) {
        const isList = li !== null && li !== undefined && sub;
        const col = colClass ? ` ${colClass}` : '';
        const nest = nested ? ' bb-admin-field-nested' : '';
        const commonAttrs = isList
            ? `data-action="list-field" data-index="${index}" data-name="${this._escape(name)}" data-li="${li}" data-sub="${this._escape(sub)}"`
            : `data-action="field" data-index="${index}" data-name="${this._escape(name)}"`;

        if (!this._useModernEditor()) {
            return `
                <div class="bb-admin-field${nest}${col}">
                    <label class="bb-admin-label">${this._escape(label)}</label>
                    ${help}
                    <textarea class="bb-admin-input bb-admin-textarea" rows="${rows}" ${commonAttrs}>${this._escape(value ?? '')}</textarea>
                </div>
            `;
        }

        const listAttrs = isList
            ? ` data-li="${li}" data-sub="${this._escape(sub)}"`
            : '';
        const editorHeight = height ?? (isList ? 180 : 220);

        return `
            <div class="bb-admin-field bb-admin-field-modern${nest}${col}"
                data-bb-me="1"
                data-index="${index}"
                data-name="${this._escape(name)}"
                data-label="${this._escape(label)}"
                data-height="${editorHeight}"
                ${listAttrs}>
                <label class="bb-admin-label">${this._escape(label)}</label>
                ${help}
            </div>
        `;
    }

    _mountModernEditors(root = this) {
        if (!this._useModernEditor()) {
            return;
        }
        const tag = this._modernEditorTag;
        const scope = root || this;

        scope.querySelectorAll('[data-bb-me="1"]').forEach((host) => {
            if (host.querySelector(tag)) {
                return;
            }

            const index = parseInt(host.dataset.index, 10);
            const name = host.dataset.name;
            const liRaw = host.dataset.li;
            const sub = host.dataset.sub;
            const isList = liRaw !== undefined && liRaw !== '' && sub;
            const li = isList ? parseInt(liRaw, 10) : null;

            let current = '';
            if (isList) {
                const list = this._value[index]?.[name];
                current = Array.isArray(list) ? (list[li]?.[sub] ?? '') : '';
            } else {
                current = this._value[index]?.[name] ?? '';
            }

            const el = document.createElement(tag);
            el.field = {
                type: 'moderneditor',
                label: host.dataset.label || name,
                markdown_enabled: false,
                height: parseInt(host.dataset.height || '220', 10) || 220,
            };
            el.value = current == null ? '' : String(current);

            el.addEventListener('change', (ev) => {
                ev.stopPropagation();
                const nextVal = ev.detail !== undefined ? ev.detail : el.value;
                if (isList) {
                    this._setListField(index, name, li, sub, nextVal ?? '');
                } else {
                    this._setSectionField(index, name, nextVal ?? '');
                }
            });

            host.appendChild(el);
            this._injectToxNoBorder(el);
        });
    }

    /**
     * Modern Editor mounts TinyMCE inside an open shadow root, so document CSS
     * cannot target .tox-tinymce. Inject a small override into the shadow.
     */
    _injectToxNoBorder(el) {
        const inject = () => {
            const root = el.shadowRoot;
            if (!root) {
                return false;
            }
            if (root.querySelector('style[data-bb-tox]')) {
                return true;
            }
            const style = document.createElement('style');
            style.setAttribute('data-bb-tox', '1');
            style.textContent = '.tox-tinymce { border: none !important; }';
            root.appendChild(style);
            return true;
        };

        if (inject()) {
            return;
        }

        queueMicrotask(() => {
            if (inject()) {
                return;
            }
            const obs = new MutationObserver(() => {
                if (inject()) {
                    obs.disconnect();
                }
            });
            obs.observe(el, { childList: true, subtree: true });
            setTimeout(() => obs.disconnect(), 3000);
        });
    }

    _normalizeSection(section) {
        if (!section || typeof section !== 'object') {
            return section;
        }
        const out = { ...section };
        if (out.layout && !out.panel) {
            out.panel = out.layout;
            delete out.layout;
        }
        return out;
    }

    _panelId(section) {
        return section?.panel || section?.layout || 'text';
    }

    _panelById(id) {
        return this._panels.find((p) => p.id === id) || null;
    }

    _panelLabel(id) {
        const panel = this._panelById(id);
        return panel?.label || id;
    }

    _sectionSummary(section) {
        const panelId = this._panelId(section);
        const snippet = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

        switch (panelId) {
            case 'hero':
                return snippet(section.hero_title || section.hero_body);
            case 'text':
                return snippet(section.text_body);
            case 'full':
                return snippet(section.full_body);
            case 'features': {
                const items = section.features;
                if (!Array.isArray(items) || !items.length) return '';
                const first = items[0]?.header || items[0]?.text || '';
                const extra = items.length > 1 ? ` (+${items.length - 1})` : '';
                return snippet(first) + extra;
            }
            case 'filler': {
                const size = section.filler_size || 'medium';
                const labels = { small: 'Small', medium: 'Medium', large: 'Large' };
                return `${labels[size] || size} spacer`;
            }
            case 'boxes': {
                const n = Array.isArray(section.boxes) ? section.boxes.length : 0;
                return n ? `${n} box${n === 1 ? '' : 'es'}` : '';
            }
            case 'faq': {
                const items = section.faq;
                if (!Array.isArray(items) || !items.length) return '';
                const first = items[0]?.title || items[0]?.content || '';
                const extra = items.length > 1 ? ` (+${items.length - 1})` : '';
                return snippet(first) + extra;
            }
            case 'testimonials': {
                const heading = snippet(section.testimonials_heading);
                if (heading) return heading;
                return section.testimonials_mode === 'all' ? 'All published' : 'Random one';
            }
            case 'opener':
                return snippet(section.opener_classes);
            case 'closer':
                return 'Closes wrapper';
            default:
                return '';
        }
    }

    _showPanelLabels() {
        const c = this._config;
        if (c.show_panel_labels === false || c.show_layout_labels === false) {
            return false;
        }
        return true;
    }

    _defaultPanel() {
        return this._config.default_panel
            || this._config.default_layout
            || this._panels[0]?.id
            || 'text';
    }

    _pageRoute() {
        const fromAdmin = window.__GRAV_PAGE_ROUTE;
        if (fromAdmin && fromAdmin !== '/' && fromAdmin !== '') {
            return fromAdmin.startsWith('/') ? fromAdmin : `/${fromAdmin}`;
        }

        const base = (window.__GRAV_CONFIG__?.basePath || '').replace(/\/$/, '');
        let path = window.location.pathname;
        if (base && path.startsWith(base)) {
            path = path.slice(base.length) || '/';
        }
        const patterns = [
            /^\/pages\/edit\/(.+)\/?$/,
            /^\/pages\/(?!new(?:\/|$)|edit\/)(.+)\/?$/,
        ];
        for (const pattern of patterns) {
            const match = path.match(pattern);
            if (match) {
                const route = decodeURIComponent(match[1]);
                return route.startsWith('/') ? route : `/${route}`;
            }
        }
        return null;
    }

    _pageMediaApiRoute() {
        const route = this._pageRoute();
        if (!route || route === '/') return null;
        return route.replace(/^\//, '');
    }

    _siteMediaPreviewUrl(path) {
        if (!path) return '';
        const base = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
        const rel = String(path)
            .replace(/^\/+/, '')
            .split('/')
            .filter(Boolean)
            .map((seg) => {
                try {
                    seg = decodeURIComponent(seg);
                } catch {
                    // keep
                }
                return encodeURIComponent(seg);
            })
            .join('/');
        return `${base}/user/media/${rel}`;
    }

    _altFieldName(name) {
        return `${name}_alt`;
    }

    async _openSiteMediaPicker(index, name) {
        try {
            const picker = await ensureBadgerMediaPicker();
            const section = this._value[index] || {};
            const selectedPath = section[name] || null;
            const alt = section[this._altFieldName(name)] || '';
            await picker.open({
                title: 'Choose image',
                selectedPath,
                alt,
                onInsert: ({ path, alt: nextAlt }) => {
                    this._setSectionField(index, name, path, { emit: false });
                    this._setSectionField(index, this._altFieldName(name), nextAlt || '', { emit: false });
                    this._render();
                    this._emit();
                    this._emitCommit();
                },
            });
        } catch (err) {
            console.warn('[badger-builder] Site media picker failed', err);
        }
    }

    _clearMedia(index, name) {
        this._setSectionField(index, name, '', { emit: false });
        this._setSectionField(index, this._altFieldName(name), '', { emit: false });
        this._render();
        this._emit();
        this._emitCommit();
    }

    _syncFieldsFromDom() {
        this.querySelectorAll('[data-action="field"]').forEach((el) => {
            const index = parseInt(el.dataset.index, 10);
            const name = el.dataset.name;
            if (Number.isNaN(index) || !name) {
                return;
            }
            this._setSectionField(index, name, el.value, { emit: false });
        });

        this.querySelectorAll('[data-action="list-field"]').forEach((el) => {
            const index = parseInt(el.dataset.index, 10);
            const name = el.dataset.name;
            const li = parseInt(el.dataset.li, 10);
            const sub = el.dataset.sub;
            if (Number.isNaN(index) || !name || Number.isNaN(li) || !sub) {
                return;
            }
            this._setListField(index, name, li, sub, el.value, { emit: false });
        });

        if (this._useModernEditor()) {
            const tag = this._modernEditorTag;
            this.querySelectorAll(`[data-bb-me="1"] > ${tag}`).forEach((el) => {
                const host = el.parentElement;
                if (!host) return;
                const index = parseInt(host.dataset.index, 10);
                const name = host.dataset.name;
                if (Number.isNaN(index) || !name) return;
                const liRaw = host.dataset.li;
                const sub = host.dataset.sub;
                const val = el.value ?? '';
                if (liRaw !== undefined && liRaw !== '' && sub) {
                    this._setListField(index, name, parseInt(liRaw, 10), sub, val, { emit: false });
                } else {
                    this._setSectionField(index, name, val, { emit: false });
                }
            });
        }
    }

    _payload() {
        this._syncFieldsFromDom();
        return JSON.parse(JSON.stringify(this._value));
    }

    _emit() {
        const detail = this._payload();
        this.dispatchEvent(new CustomEvent('change', {
            detail,
            bubbles: true,
        }));
    }

    _emitCommit() {
        const detail = this._payload();
        this.dispatchEvent(new CustomEvent('change', {
            detail,
            bubbles: true,
        }));
        this.dispatchEvent(new CustomEvent('commit', {
            detail,
            bubbles: true,
        }));
    }

    _updateSection(index, section, { render = true, emit = true } = {}) {
        const next = [...this._value];
        next[index] = section;
        this._value = next;
        if (render) {
            this._render();
        } else {
            this._updateSectionSummary(index);
        }
        if (emit) {
            this._emit();
        }
    }

    _setSectionField(index, name, val, { emit = true } = {}) {
        const next = [...this._value];
        next[index] = { ...next[index], [name]: val };
        this._value = next;
        this._updateSectionSummary(index);
        if (emit) {
            this._emit();
        }
    }

    _setListField(index, name, li, sub, val, { emit = true } = {}) {
        const section = { ...this._value[index] };
        const list = Array.isArray(section[name]) ? section[name].map((x) => ({ ...x })) : [];
        if (!list[li]) list[li] = {};
        list[li][sub] = val;
        section[name] = list;
        this._updateSection(index, section, { render: false, emit });
    }

    _updateSectionSummary(index) {
        const section = this._value[index];
        if (!section) return;
        const card = this.querySelector(`.bb-admin-card[data-index="${index}"]`);
        if (!card) return;
        const summary = this._sectionSummary(section);
        const summaryText = summary ? String(summary).slice(0, 60) : '';
        let summaryEl = card.querySelector('.bb-admin-card-summary');
        if (summaryText) {
            if (!summaryEl) {
                summaryEl = document.createElement('span');
                summaryEl.className = 'bb-admin-card-summary';
                card.querySelector('.bb-admin-card-toggle')?.appendChild(summaryEl);
            }
            summaryEl.textContent = summaryText;
        } else if (summaryEl) {
            summaryEl.remove();
        }
    }

    _moveSection(from, to) {
        if (to < 0 || to >= this._value.length || from === to) return;
        const next = [...this._value];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        this._value = next;
        this._render();
        this._emit();
    }

    _moveListItem(sectionIndex, listName, fromLi, toLi) {
        const section = this._value[sectionIndex];
        if (!section) return;
        const list = Array.isArray(section[listName]) ? [...section[listName]] : [];
        if (toLi < 0 || toLi >= list.length || fromLi === toLi) return;
        const [item] = list.splice(fromLi, 1);
        list.splice(toLi, 0, item);
        this._updateSection(sectionIndex, { ...section, [listName]: list });
    }

    async _removeSection(index) {
        const ok = await window.__GRAV_DIALOGS?.confirm({
            title: 'Remove section?',
            message: 'This section will be removed from the page.',
            confirmLabel: 'Remove',
            variant: 'destructive',
        });
        if (!ok) return;
        this._value = this._value.filter((_, i) => i !== index);
        this._expanded.delete(index);
        this._render();
        this._emit();
    }

    _addSection(panelId) {
        const panel = this._panelById(panelId);
        if (!panel) return;
        const section = { panel: panelId };
        for (const field of panel.fields || []) {
            const name = field.name;
            if (!name) continue;
            if (field.type === 'list') {
                section[name] = [];
            } else if (field.default !== undefined) {
                section[name] = field.default;
            } else {
                section[name] = '';
            }
        }
        this._value = [...this._value, section];
        this._expanded.add(this._value.length - 1);
        this._render();
        this._emit();
    }

    _duplicateSection(index) {
        this._syncFieldsFromDom();
        const section = this._value[index];
        if (!section) return;
        const clone = JSON.parse(JSON.stringify(section));
        const next = [...this._value];
        next.splice(index + 1, 0, clone);
        this._value = next;
        const remapped = new Set();
        this._expanded.forEach((i) => {
            remapped.add(i > index ? i + 1 : i);
        });
        remapped.add(index + 1);
        this._expanded = remapped;
        this._render();
        this._emit();
    }

    _toggleExpanded(index) {
        const card = this.querySelector(`.bb-admin-card[data-index="${index}"]`);
        if (!card) {
            if (this._expanded.has(index)) {
                this._expanded.delete(index);
            } else {
                this._expanded.add(index);
            }
            this._render();
            return;
        }

        const opening = !this._expanded.has(index);
        // Persist editor/input values before tearing down this card's body.
        this._syncFieldsFromDom();

        if (!opening) {
            this._expanded.delete(index);
            card.classList.remove('is-open');
            card.querySelector('.bb-admin-card-body')?.remove();
            return;
        }

        this._expanded.add(index);
        card.classList.add('is-open');
        if (card.querySelector('.bb-admin-card-body')) {
            return;
        }

        const section = this._value[index];
        if (!section) return;

        const body = document.createElement('div');
        body.className = 'bb-admin-card-body';
        body.innerHTML = this._sectionFieldsHtml(index, section);
        card.appendChild(body);
        this._bindBodyEvents(body);
        this._mountModernEditors(body);
    }

    // ─── Field editors ───────────────────────────────────────────────────────
    _renderSiteMediaField(index, section, field, opts = {}) {
        const name = field.name;
        const val = section[name] || '';
        const alt = section[this._altFieldName(name)] || '';
        const label = field.label || name;
        const help = field.help ? `<span class="bb-admin-help">${this._escape(field.help)}</span>` : '';
        const width = opts.width ?? field.width;
        const rowClass = width === 'quarter'
            ? 'bb-admin-field bb-admin-field-quarter bb-admin-field-media'
            : width === 'half'
                ? 'bb-admin-field bb-admin-field-half bb-admin-field-media'
                : width === 'third'
                    ? 'bb-admin-field bb-admin-field-third bb-admin-field-media'
                    : width === 'hero-image'
                        ? 'bb-admin-field bb-admin-hero-image bb-admin-field-media'
                        : 'bb-admin-field bb-admin-field-media';
        const thumb = val ? this._siteMediaPreviewUrl(val) : '';
        const preview = val
            ? (thumb
                ? `<img class="bb-admin-media-preview-img" src="${this._escape(thumb)}" alt="${this._escape(alt || val)}" />`
                : `<span class="bb-admin-media-preview-file">${this._escape(val)}</span>`)
            : `<span class="bb-admin-media-preview-empty">No image selected</span>`;
        const altLine = val
            ? `<div class="bb-admin-help">Alt: ${alt ? this._escape(alt) : '<em>none</em>'}</div>`
            : '';

        return `
            <div class="${rowClass}">
                <label class="bb-admin-label">${this._escape(label)}</label>
                ${help}
                <div class="bb-admin-media-preview">${preview}</div>
                ${altLine}
                <div class="bb-admin-media-actions">
                    <button type="button" class="bb-admin-btn" data-action="media-open"
                        data-index="${index}" data-name="${this._escape(name)}">Choose from site media</button>
                    ${val ? `<button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="media-clear"
                        data-index="${index}" data-name="${this._escape(name)}">Clear</button>` : ''}
                </div>
            </div>
        `;
    }

    _renderListSubField(index, listName, li, item, sf, colClass = '') {
        const sfName = sf.name;
        const sfVal = item[sfName] ?? '';
        const sfLabel = sf.label || sfName;
        const help = sf.help ? `<span class="bb-admin-help">${this._escape(sf.help)}</span>` : '';
        const commonAttrs = `data-action="list-field" data-index="${index}" data-name="${this._escape(listName)}" data-li="${li}" data-sub="${this._escape(sfName)}"`;
        const col = colClass ? ` ${colClass}` : '';

        if (sf.type === 'textarea' || sf.type === 'markdown') {
            const isFaqContent = listName === 'faq' && sfName === 'content';
            return this._longTextHostHtml({
                label: sfLabel,
                help,
                value: sfVal,
                rows: isFaqContent ? 2 : (sf.type === 'markdown' ? 4 : 2),
                colClass,
                index,
                name: listName,
                li,
                sub: sfName,
                nested: true,
                height: isFaqContent ? 90 : null,
            });
        }

        return `
            <div class="bb-admin-field bb-admin-field-nested${col}">
                <label class="bb-admin-label">${this._escape(sfLabel)}</label>
                ${help}
                <input type="text" class="bb-admin-input" ${commonAttrs} value="${this._escape(sfVal)}" />
            </div>
        `;
    }

    _renderField(index, section, field, opts = {}) {
        const name = field.name;
        const val = section[name];
        const label = field.label || name;
        const help = field.help ? `<span class="bb-admin-help">${this._escape(field.help)}</span>` : '';
        const width = opts.width ?? field.width;
        const rowClass = width === 'quarter'
            ? 'bb-admin-field bb-admin-field-quarter'
            : width === 'half'
                ? 'bb-admin-field bb-admin-field-half'
                : width === 'third'
                    ? 'bb-admin-field bb-admin-field-third'
                    : 'bb-admin-field';

        if (field.type === 'site_media' || field.type === 'page_media') {
            return this._renderSiteMediaField(index, section, field, opts);
        }

        if (field.type === 'select') {
            const optionHtml = Object.entries(field.options || {}).map(([k, v]) =>
                `<option value="${this._escape(k)}"${val === k ? ' selected' : ''}>${this._escape(v)}</option>`
            ).join('');
            return `
                <div class="${rowClass}">
                    <label class="bb-admin-label">${this._escape(label)}</label>
                    ${help}
                    <select class="bb-admin-input" data-action="field" data-index="${index}" data-name="${this._escape(name)}">${optionHtml}</select>
                </div>
            `;
        }

        if (field.type === 'range') {
            const min = field.min ?? 0;
            const max = field.max ?? 100;
            const step = field.step ?? 1;
            const unit = field.unit ?? '%';
            const numVal = val !== '' && val !== undefined && val !== null ? Number(val) : (field.default ?? max);
            return `
                <div class="${rowClass}">
                    <label class="bb-admin-label">${this._escape(label)}</label>
                    ${help}
                    <div class="bb-admin-range">
                        <input type="range" class="bb-admin-range-input" data-action="field" data-index="${index}"
                            data-name="${this._escape(name)}" data-unit="${this._escape(unit)}"
                            min="${min}" max="${max}" step="${step}" value="${numVal}" />
                        <output class="bb-admin-range-value" data-range-for="${this._escape(name)}">${numVal}${this._escape(unit)}</output>
                    </div>
                </div>
            `;
        }

        if (field.type === 'list') {
            const items = Array.isArray(val) ? val : [];
            const subFields = field.fields || [];
            const itemsHtml = items.map((item, li) => {
                let subHtml;
                if (name === 'boxes') {
                    const bodyField = subFields.find((sf) => sf.name === 'body');
                    const classesField = subFields.find((sf) => sf.name === 'classes');
                    subHtml = `<div class="bb-admin-list-split">
                        ${bodyField ? this._renderListSubField(index, name, li, item, bodyField, 'bb-admin-list-col-wide') : ''}
                        ${classesField ? this._renderListSubField(index, name, li, item, classesField, 'bb-admin-list-col-narrow') : ''}
                    </div>`;
                } else if (name === 'faq') {
                    const titleField = subFields.find((sf) => sf.name === 'title');
                    const contentField = subFields.find((sf) => sf.name === 'content');
                    subHtml = `<div class="bb-admin-list-split">
                        ${titleField ? this._renderListSubField(index, name, li, item, titleField, 'bb-admin-list-col-half') : ''}
                        ${contentField ? this._renderListSubField(index, name, li, item, contentField, 'bb-admin-list-col-half') : ''}
                    </div>`;
                } else {
                    subHtml = subFields.map((sf) => this._renderListSubField(index, name, li, item, sf)).join('');
                }
                return `
                    <div class="bb-admin-list-item" data-list-index="${index}" data-list-name="${this._escape(name)}" data-li="${li}">
                        <div class="bb-admin-list-item-head">
                            <button type="button" class="bb-admin-list-drag" draggable="true" title="Drag to reorder" aria-label="Drag handle">⋮⋮</button>
                            <span>Item ${li + 1}</span>
                            <button type="button" class="bb-admin-icon-btn bb-admin-icon-btn-delete" data-action="list-remove"
                                data-index="${index}" data-name="${this._escape(name)}" data-li="${li}" title="Delete" aria-label="Delete item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M3 6h18"></path>
                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                    <line x1="10" x2="10" y1="11" y2="17"></line>
                                    <line x1="14" x2="14" y1="11" y2="17"></line>
                                </svg>
                            </button>
                        </div>
                        ${subHtml}
                    </div>
                `;
            }).join('');

            if (name === 'faq' || name === 'boxes') {
                return `
                    <div class="bb-admin-field bb-admin-field-list bb-admin-field-list-${this._escape(name)}">
                        <div class="bb-admin-list-head">
                            <label class="bb-admin-label">${this._escape(label)}</label>
                        </div>
                        ${help}
                        <div class="bb-admin-list">${itemsHtml || '<div class="bb-admin-list-empty">No items yet.</div>'}</div>
                        <div class="bb-admin-list-foot">
                            <button type="button" class="bb-admin-btn bb-admin-btn-primary" data-action="list-add"
                                data-index="${index}" data-name="${this._escape(name)}">Add item</button>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="bb-admin-field bb-admin-field-list">
                    <div class="bb-admin-list-head">
                        <label class="bb-admin-label">${this._escape(label)}</label>
                        <button type="button" class="bb-admin-btn" data-action="list-add"
                            data-index="${index}" data-name="${this._escape(name)}">Add item</button>
                    </div>
                    ${help}
                    <div class="bb-admin-list">${itemsHtml || '<div class="bb-admin-list-empty">No items yet.</div>'}</div>
                </div>
            `;
        }

        const isLong = field.type === 'textarea' || field.type === 'markdown';
        if (isLong) {
            const widthClass = rowClass.replace(/^bb-admin-field\s*/, '').trim();
            return this._longTextHostHtml({
                label,
                help,
                value: val ?? '',
                rows: 4,
                colClass: widthClass,
                index,
                name,
            });
        }

        return `
            <div class="${rowClass}">
                <label class="bb-admin-label">${this._escape(label)}</label>
                ${help}
                <input type="text" class="bb-admin-input" data-action="field" data-index="${index}" data-name="${this._escape(name)}"
                    value="${this._escape(val ?? '')}" />
            </div>
        `;
    }

    _sectionFieldsHtml(index, section) {
        const panelId = this._panelId(section);
        const panel = this._panelById(panelId);

        if (panelId === 'boxes' && panel) {
            const fields = panel.fields || [];
            const configFields = fields.filter((f) => f.type !== 'list');
            const listFields = fields.filter((f) => f.type === 'list');
            return `
                ${listFields.map((f) => this._renderField(index, section, f)).join('')}
                <div class="bb-admin-field bb-admin-field-quarters">
                    ${configFields.map((f) => this._renderField(index, section, f, { width: 'quarter' })).join('')}
                </div>
            `;
        }
        if (panelId === 'faq' && panel) {
            const fields = panel.fields || [];
            const listFields = fields.filter((f) => f.type === 'list');
            const configFields = fields.filter((f) => f.type !== 'list');
            return `
                ${listFields.map((f) => this._renderField(index, section, f)).join('')}
                ${configFields.length ? `<div class="bb-admin-field bb-admin-field-halves">
                    ${configFields.map((f) => this._renderField(index, section, f, { width: 'half' })).join('')}
                </div>` : ''}
            `;
        }
        if (panelId === 'hero' && panel) {
            const fields = panel.fields || [];
            const bodyField = fields.find((f) => f.name === 'hero_body');
            const imageFields = fields.filter((f) =>
                f.name === 'hero_image_desktop' || f.name === 'hero_image_mobile'
            );
            const configFields = fields.filter((f) =>
                f.name === 'hero_overall_classes'
                || f.name === 'hero_layout'
                || f.name === 'hero_align'
                || f.name === 'hero_background'
            );
            return `
                <div class="bb-admin-field-halves bb-admin-field-halves-hero">
                    ${bodyField ? this._renderField(index, section, bodyField, { width: 'half' }) : ''}
                    ${imageFields.length ? `<div class="bb-admin-field bb-admin-field-half bb-admin-hero-images">
                        ${imageFields.map((f) => this._renderField(index, section, f, { width: 'hero-image' })).join('')}
                    </div>` : ''}
                </div>
                ${configFields.length ? `<div class="bb-admin-field bb-admin-field-quarters">
                    ${configFields.map((f) => this._renderField(index, section, f, { width: 'quarter' })).join('')}
                </div>` : ''}
            `;
        }
        if (panelId === 'filler' && panel) {
            const fields = panel.fields || [];
            return `<div class="bb-admin-field bb-admin-field-halves">
                ${fields.map((f) => this._renderField(index, section, f, { width: 'half' })).join('')}
            </div>`;
        }
        if (panelId === 'text' && panel) {
            const fields = panel.fields || [];
            const bodyField = fields.find((f) => f.name === 'text_body');
            const imageField = fields.find((f) => f.name === 'text_image');
            const captionField = fields.find((f) => f.name === 'text_image_caption');
            const configFields = fields.filter((f) =>
                f.name === 'text_overall_classes'
                || f.name === 'text_background'
                || f.name === 'text_align'
            );
            return `
                <div class="bb-admin-field bb-admin-field-halves bb-admin-field-halves-text">
                    ${bodyField ? this._renderField(index, section, bodyField, { width: 'half' }) : ''}
                    ${imageField || captionField ? `<div class="bb-admin-field bb-admin-field-half bb-admin-text-image-col">
                        ${imageField ? this._renderField(index, section, imageField, { width: 'hero-image' }) : ''}
                        ${captionField ? this._renderField(index, section, captionField) : ''}
                    </div>` : ''}
                </div>
                ${configFields.length ? `<div class="bb-admin-field bb-admin-field-thirds">
                    ${configFields.map((f) => this._renderField(index, section, f, { width: 'third' })).join('')}
                </div>` : ''}
            `;
        }
        if (panelId === 'full' && panel) {
            const fields = panel.fields || [];
            const mainFields = fields.filter((f) => f.width !== 'third');
            const thirdFields = fields.filter((f) => f.width === 'third');
            return `
                ${mainFields.map((f) => this._renderField(index, section, f)).join('')}
                ${thirdFields.length ? `<div class="bb-admin-field bb-admin-field-thirds">
                    ${thirdFields.map((f) => this._renderField(index, section, f, { width: 'third' })).join('')}
                </div>` : ''}
            `;
        }
        if (panelId === 'testimonials' && panel) {
            const fields = panel.fields || [];
            const mainFields = fields.filter((f) => f.width !== 'half');
            const halfFields = fields.filter((f) => f.width === 'half');
            return `
                ${mainFields.map((f) => this._renderField(index, section, f)).join('')}
                ${halfFields.length ? `<div class="bb-admin-field bb-admin-field-halves">
                    ${halfFields.map((f) => this._renderField(index, section, f, { width: 'half' })).join('')}
                </div>` : ''}
            `;
        }
        return panel
            ? (panel.fields || []).map((f) => this._renderField(index, section, f)).join('')
            : '<p class="bb-admin-error">Unknown panel.</p>';
    }

    _renderSection(index, section) {
        const panelId = this._panelId(section);
        const expanded = this._expanded.has(index);
        const showLabel = this._showPanelLabels();
        const title = showLabel ? this._panelLabel(panelId) : `Section ${index + 1}`;
        const summary = this._sectionSummary(section);
        const summaryText = summary ? String(summary).slice(0, 60) : '';
        const fieldsHtml = expanded ? this._sectionFieldsHtml(index, section) : '';

        return `
            <article class="bb-admin-card${expanded ? ' is-open' : ''}" data-index="${index}">
                <header class="bb-admin-card-head">
                    <button type="button" class="bb-admin-drag" draggable="true" title="Drag to reorder" aria-label="Drag handle">⋮⋮</button>
                    <button type="button" class="bb-admin-card-toggle" data-action="toggle" data-index="${index}">
                        <span class="bb-admin-card-title">${this._escape(title)}</span>
                        ${summaryText ? `<span class="bb-admin-card-summary">${this._escape(summaryText)}</span>` : ''}
                    </button>
                    <div class="bb-admin-card-actions">
                        <button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="up" data-index="${index}" title="Move up">↑</button>
                        <button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="down" data-index="${index}" title="Move down">↓</button>
                        <button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="duplicate" data-index="${index}" title="Duplicate" aria-label="Duplicate section">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button type="button" class="bb-admin-icon-btn bb-admin-icon-btn-delete" data-action="remove" data-index="${index}" title="Delete" aria-label="Delete section">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                <line x1="10" x2="10" y1="11" y2="17"></line>
                                <line x1="14" x2="14" y1="11" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </header>
                ${expanded ? `
                    <div class="bb-admin-card-body">
                        ${fieldsHtml}
                    </div>
                ` : ''}
            </article>
        `;
    }

    _render() {
        if (this._loading) {
            this.innerHTML = `<div class="bb-admin-status">Loading section panels…</div>`;
            return;
        }

        if (this._error && !this._panels.length) {
            this.innerHTML = `<div class="bb-admin-status bb-admin-status-error">Failed to load panels: ${this._escape(this._error)}</div>`;
            return;
        }

        const panelOptions = this._panels.map((p) =>
            `<option value="${this._escape(p.id)}">${this._escape(p.label || p.id)}</option>`
        ).join('');

        const defaultPanel = this._defaultPanel();
        const cards = this._value.map((s, i) => this._renderSection(i, s)).join('');

        this.innerHTML = `
            <div class="bb-admin-sections">
                <div class="bb-admin-sections-list">${cards || '<div class="bb-admin-status">No sections yet. Add one below.</div>'}</div>
                <div class="bb-admin-sections-add">
                    <select class="bb-admin-input bb-admin-add-select" data-ref="add-select">${panelOptions}</select>
                    <button type="button" class="bb-admin-btn bb-admin-btn-primary" data-action="add">Add section</button>
                </div>
            </div>
        `;

        const addSelect = this.querySelector('[data-ref="add-select"]');
        if (addSelect && !addSelect.value) {
            addSelect.value = defaultPanel;
        }
        addSelect?.addEventListener('change', (ev) => ev.stopPropagation());

        this._bindEvents();
        this._mountModernEditors();
    }

    _bindEvents() {
        this.querySelector('[data-action="add"]')?.addEventListener('click', () => {
            const sel = this.querySelector('[data-ref="add-select"]');
            this._addSection(sel?.value || this._defaultPanel());
        });

        this.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
            btn.addEventListener('click', () => this._toggleExpanded(parseInt(btn.dataset.index, 10)));
        });

        this.querySelectorAll('[data-action="up"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.index, 10);
                this._moveSection(i, i - 1);
            });
        });

        this.querySelectorAll('[data-action="down"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.index, 10);
                this._moveSection(i, i + 1);
            });
        });

        this.querySelectorAll('[data-action="duplicate"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._duplicateSection(parseInt(btn.dataset.index, 10));
            });
        });

        this.querySelectorAll('[data-action="remove"]').forEach((btn) => {
            btn.addEventListener('click', () => this._removeSection(parseInt(btn.dataset.index, 10)));
        });

        this.querySelectorAll('.bb-admin-drag').forEach((handle) => {
            handle.addEventListener('dragstart', (e) => {
                const card = handle.closest('.bb-admin-card');
                if (!card) return;
                this._dragIndex = parseInt(card.dataset.index, 10);
                this._listDrag = null;
                card.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            handle.addEventListener('dragend', () => {
                const card = handle.closest('.bb-admin-card');
                card?.classList.remove('is-dragging');
                this._dragIndex = null;
            });
        });

        this.querySelectorAll('.bb-admin-card').forEach((card) => {
            card.addEventListener('dragover', (e) => {
                if (this._listDrag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            card.addEventListener('drop', (e) => {
                if (this._listDrag) return;
                e.preventDefault();
                const to = parseInt(card.dataset.index, 10);
                if (this._dragIndex !== null && this._dragIndex !== to) {
                    this._moveSection(this._dragIndex, to);
                }
            });
        });

        this._bindBodyEvents(this);
    }

    /** Field / list / media handlers for a card body (or the whole host on full render). */
    _bindBodyEvents(root) {
        const scope = root || this;

        scope.querySelectorAll('[data-action="field"]').forEach((el) => {
            if (el.tagName === 'SELECT') {
                el.addEventListener('change', (ev) => {
                    // Native change bubbles to the custom-element host; Admin2 treats
                    // that as onchange(undefined) and clears dirty state.
                    ev.stopPropagation();
                    const index = parseInt(el.dataset.index, 10);
                    const name = el.dataset.name;
                    this._setSectionField(index, name, el.value, { emit: false });
                    this._emitCommit();
                });
                return;
            }
            el.addEventListener('input', () => {
                const index = parseInt(el.dataset.index, 10);
                const name = el.dataset.name;
                if (el.type === 'range') {
                    const unit = el.dataset.unit || '%';
                    const output = el.parentElement?.querySelector('.bb-admin-range-value');
                    if (output) output.textContent = `${el.value}${unit}`;
                }
                this._setSectionField(index, name, el.value);
            });
            el.addEventListener('blur', () => this._emitCommit());
        });

        scope.querySelectorAll('[data-action="list-add"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index, 10);
                const name = btn.dataset.name;
                const panel = this._panelById(this._panelId(this._value[index]));
                const listField = (panel?.fields || []).find((f) => f.name === name);
                const empty = {};
                for (const sf of listField?.fields || []) {
                    empty[sf.name] = '';
                }
                const section = { ...this._value[index] };
                const list = Array.isArray(section[name]) ? [...section[name]] : [];
                list.push(empty);
                section[name] = list;
                this._updateSection(index, section);
            });
        });

        scope.querySelectorAll('[data-action="list-remove"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index, 10);
                const name = btn.dataset.name;
                const li = parseInt(btn.dataset.li, 10);
                const section = { ...this._value[index] };
                const list = Array.isArray(section[name]) ? [...section[name]] : [];
                list.splice(li, 1);
                section[name] = list;
                this._updateSection(index, section);
            });
        });

        scope.querySelectorAll('[data-action="list-field"]').forEach((el) => {
            el.addEventListener('input', () => {
                const index = parseInt(el.dataset.index, 10);
                const name = el.dataset.name;
                const li = parseInt(el.dataset.li, 10);
                const sub = el.dataset.sub;
                this._setListField(index, name, li, sub, el.value);
            });
            el.addEventListener('blur', () => this._emitCommit());
        });

        scope.querySelectorAll('[data-action="media-open"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._openSiteMediaPicker(
                    parseInt(btn.dataset.index, 10),
                    btn.dataset.name,
                );
            });
        });

        scope.querySelectorAll('[data-action="media-clear"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._clearMedia(parseInt(btn.dataset.index, 10), btn.dataset.name);
            });
        });

        scope.querySelectorAll('.bb-admin-list-drag').forEach((handle) => {
            handle.addEventListener('dragstart', (e) => {
                const item = handle.closest('.bb-admin-list-item');
                if (!item) return;
                e.stopPropagation();
                this._dragIndex = null;
                this._listDrag = {
                    sectionIndex: parseInt(item.dataset.listIndex, 10),
                    listName: item.dataset.listName,
                    fromLi: parseInt(item.dataset.li, 10),
                };
                item.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            handle.addEventListener('dragend', () => {
                const item = handle.closest('.bb-admin-list-item');
                item?.classList.remove('is-dragging');
                this._listDrag = null;
            });
        });

        scope.querySelectorAll('.bb-admin-list-item').forEach((item) => {
            item.addEventListener('dragover', (e) => {
                if (!this._listDrag) return;
                if (this._listDrag.listName !== item.dataset.listName
                    || this._listDrag.sectionIndex !== parseInt(item.dataset.listIndex, 10)) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
            });
            item.addEventListener('drop', (e) => {
                if (!this._listDrag) return;
                const toLi = parseInt(item.dataset.li, 10);
                const { sectionIndex, listName, fromLi } = this._listDrag;
                if (listName !== item.dataset.listName
                    || sectionIndex !== parseInt(item.dataset.listIndex, 10)) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (fromLi !== toLi) {
                    this._moveListItem(sectionIndex, listName, fromLi, toLi);
                }
                this._listDrag = null;
            });
        });
    }

    _escape(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

customElements.define(TAG, SectionsField);
