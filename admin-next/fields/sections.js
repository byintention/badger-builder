/**
 * sections — Badger Builder custom Admin2 field.
 *
 * Manages header.sections: add/reorder/remove rows, per-panel field editors.
 * Styles: assets/css/badger-builder-admin.css (loaded via _ensureStylesheet).
 * Long text (markdown/textarea) uses Modern Editor when available (HTML storage).
 */

const TAG = window.__GRAV_FIELD_TAG;
const MODERN_EDITOR_TAG = 'grav-modern-editor--moderneditor';
const MODERN_EDITOR_SLUG = 'modern-editor';
const MODERN_EDITOR_TYPE = 'moderneditor';

/** @type {Promise<string|null>|null} */
let modernEditorLoadPromise = null;

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
        this._mediaPickerOpen = null;
        this._pageMedia = [];
        this._mediaLoading = false;
        this._mediaError = null;
        /** @type {string|null} */
        this._modernEditorTag = null;
    }

    set field(v) {
        this._field = v;
        if (this.isConnected) this._render();
    }
    get field() { return this._field; }

    set value(v) {
        const arr = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : [];
        this._value = arr.map((s) => this._normalizeSection(s));
        if (this.isConnected && !this._loading) this._render();
    }
    get value() {
        this._syncFieldsFromDom();
        return this._value;
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
            this._modernEditorTag = await this._ensureModernEditor();
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

    _mountModernEditors() {
        if (!this._useModernEditor()) {
            return;
        }
        const tag = this._modernEditorTag;

        this.querySelectorAll('[data-bb-me="1"]').forEach((host) => {
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

    _mediaItem(filename) {
        if (!filename) return null;
        return this._pageMedia.find((m) => m.filename === filename) || null;
    }

    async _loadPageMedia() {
        const route = this._pageMediaApiRoute();
        if (!route) {
            this._mediaError = 'Save the page first, then pick from Page Media on the Content tab.';
            this._pageMedia = [];
            return;
        }
        this._mediaLoading = true;
        this._mediaError = null;
        try {
            const resp = await fetch(this._apiPath(`/pages/${encodeURI(route)}/media`), {
                headers: this._headers(),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            const items = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
            this._pageMedia = items.filter((m) => String(m.type || '').startsWith('image/'));
        } catch (e) {
            this._mediaError = e.message || String(e);
            this._pageMedia = [];
        } finally {
            this._mediaLoading = false;
        }
    }

    async _toggleMediaPicker(key) {
        if (this._mediaPickerOpen === key) {
            this._mediaPickerOpen = null;
            this._render();
            return;
        }
        this._mediaPickerOpen = key;
        this._render();
        await this._loadPageMedia();
        this._render();
    }

    _selectMedia(index, name, filename) {
        this._setSectionField(index, name, filename);
        this._mediaPickerOpen = null;
        this._render();
    }

    _clearMedia(index, name) {
        this._setSectionField(index, name, '');
        this._mediaPickerOpen = null;
        this._render();
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

    _toggleExpanded(index) {
        if (this._expanded.has(index)) {
            this._expanded.delete(index);
        } else {
            this._expanded.add(index);
        }
        this._render();
    }

    // ─── Field editors ───────────────────────────────────────────────────────
    _renderPageMediaField(index, section, field) {
        const name = field.name;
        const val = section[name] || '';
        const label = field.label || name;
        const help = field.help ? `<span class="bb-admin-help">${this._escape(field.help)}</span>` : '';
        const pickerKey = `${index}:${name}`;
        const open = this._mediaPickerOpen === pickerKey;
        const item = this._mediaItem(val);
        const thumb = item?.thumbnail_url || item?.url || '';
        const preview = val
            ? (thumb
                ? `<img class="bb-admin-media-preview-img" src="${this._escape(thumb)}" alt="" />`
                : `<span class="bb-admin-media-preview-file">${this._escape(val)}</span>`)
            : `<span class="bb-admin-media-preview-empty">No image selected</span>`;

        let pickerBody = '';
        if (open) {
            if (this._mediaLoading) {
                pickerBody = '<div class="bb-admin-media-status">Loading page media…</div>';
            } else if (this._mediaError) {
                pickerBody = `<div class="bb-admin-media-status bb-admin-media-status-error">${this._escape(this._mediaError)}</div>`;
            } else if (!this._pageMedia.length) {
                pickerBody = '<div class="bb-admin-media-status">No images on this page yet. Upload on the Content tab → Page Media.</div>';
            } else {
                pickerBody = `<div class="bb-admin-media-grid">${this._pageMedia.map((m) => {
                    const src = m.thumbnail_url || m.url || '';
                    const selected = m.filename === val ? ' is-selected' : '';
                    return `
                        <button type="button" class="bb-admin-media-item${selected}" data-action="media-pick"
                            data-index="${index}" data-name="${this._escape(name)}"
                            data-filename="${this._escape(m.filename)}" title="${this._escape(m.filename)}">
                            ${src ? `<img src="${this._escape(src)}" alt="" loading="lazy" />` : `<span>${this._escape(m.filename)}</span>`}
                        </button>
                    `;
                }).join('')}</div>`;
            }
        }

        return `
            <div class="bb-admin-field bb-admin-field-media">
                <label class="bb-admin-label">${this._escape(label)}</label>
                ${help}
                <div class="bb-admin-media-preview">${preview}</div>
                <div class="bb-admin-media-actions">
                    <button type="button" class="bb-admin-btn" data-action="media-toggle"
                        data-key="${this._escape(pickerKey)}">${open ? 'Close picker' : 'Choose from page media'}</button>
                    ${val ? `<button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="media-clear"
                        data-index="${index}" data-name="${this._escape(name)}">Clear</button>` : ''}
                </div>
                ${open ? `<div class="bb-admin-media-picker">${pickerBody}</div>` : ''}
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

        if (field.type === 'page_media') {
            return this._renderPageMediaField(index, section, field);
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
                        ${bodyField ? this._renderListSubField(index, name, li, item, bodyField, 'bb-admin-list-col-half') : ''}
                        ${classesField ? this._renderListSubField(index, name, li, item, classesField, 'bb-admin-list-col-half') : ''}
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
                            <button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="list-remove"
                                data-index="${index}" data-name="${this._escape(name)}" data-li="${li}">Remove</button>
                        </div>
                        ${subHtml}
                    </div>
                `;
            }).join('');

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

    _renderSection(index, section) {
        const panelId = this._panelId(section);
        const panel = this._panelById(panelId);
        const expanded = this._expanded.has(index);
        const showLabel = this._showPanelLabels();
        const title = showLabel ? this._panelLabel(panelId) : `Section ${index + 1}`;
        const summary = this._sectionSummary(section);
        const summaryText = summary ? String(summary).slice(0, 60) : '';

        let fieldsHtml;
        if (panelId === 'boxes' && panel) {
            const fields = panel.fields || [];
            const configFields = fields.filter((f) => f.type !== 'list');
            const listFields = fields.filter((f) => f.type === 'list');
            fieldsHtml = `
                <div class="bb-admin-field bb-admin-field-quarters">
                    ${configFields.map((f) => this._renderField(index, section, f, { width: 'quarter' })).join('')}
                </div>
                ${listFields.map((f) => this._renderField(index, section, f)).join('')}
            `;
        } else if (panelId === 'hero' && panel) {
            const fields = panel.fields || [];
            const mainFields = fields.filter((f) => f.width !== 'quarter');
            const quarterFields = fields.filter((f) => f.width === 'quarter');
            fieldsHtml = `
                ${mainFields.map((f) => this._renderField(index, section, f)).join('')}
                ${quarterFields.length ? `<div class="bb-admin-field bb-admin-field-quarters">
                    ${quarterFields.map((f) => this._renderField(index, section, f, { width: 'quarter' })).join('')}
                </div>` : ''}
            `;
        } else if (panelId === 'filler' && panel) {
            const fields = panel.fields || [];
            fieldsHtml = `<div class="bb-admin-field bb-admin-field-halves">
                ${fields.map((f) => this._renderField(index, section, f, { width: 'half' })).join('')}
            </div>`;
        } else if (panelId === 'full' && panel) {
            const fields = panel.fields || [];
            const mainFields = fields.filter((f) => f.width !== 'third');
            const thirdFields = fields.filter((f) => f.width === 'third');
            fieldsHtml = `
                ${mainFields.map((f) => this._renderField(index, section, f)).join('')}
                ${thirdFields.length ? `<div class="bb-admin-field bb-admin-field-thirds">
                    ${thirdFields.map((f) => this._renderField(index, section, f, { width: 'third' })).join('')}
                </div>` : ''}
            `;
        } else {
            fieldsHtml = panel
                ? (panel.fields || []).map((f) => this._renderField(index, section, f)).join('')
                : '<p class="bb-admin-error">Unknown panel.</p>';
        }

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
                        <button type="button" class="bb-admin-btn bb-admin-btn-ghost bb-admin-btn-danger" data-action="remove" data-index="${index}">Remove</button>
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

        this.querySelectorAll('[data-action="remove"]').forEach((btn) => {
            btn.addEventListener('click', () => this._removeSection(parseInt(btn.dataset.index, 10)));
        });

        this.querySelectorAll('[data-action="field"]').forEach((el) => {
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

        this.querySelectorAll('[data-action="list-add"]').forEach((btn) => {
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

        this.querySelectorAll('[data-action="list-remove"]').forEach((btn) => {
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

        this.querySelectorAll('[data-action="list-field"]').forEach((el) => {
            el.addEventListener('input', () => {
                const index = parseInt(el.dataset.index, 10);
                const name = el.dataset.name;
                const li = parseInt(el.dataset.li, 10);
                const sub = el.dataset.sub;
                this._setListField(index, name, li, sub, el.value);
            });
            el.addEventListener('blur', () => this._emitCommit());
        });

        this.querySelectorAll('[data-action="media-toggle"]').forEach((btn) => {
            btn.addEventListener('click', () => this._toggleMediaPicker(btn.dataset.key));
        });

        this.querySelectorAll('[data-action="media-pick"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._selectMedia(
                    parseInt(btn.dataset.index, 10),
                    btn.dataset.name,
                    btn.dataset.filename
                );
            });
        });

        this.querySelectorAll('[data-action="media-clear"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._clearMedia(parseInt(btn.dataset.index, 10), btn.dataset.name);
            });
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

        this.querySelectorAll('.bb-admin-list-drag').forEach((handle) => {
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

        this.querySelectorAll('.bb-admin-list-item').forEach((item) => {
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
