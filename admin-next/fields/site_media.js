/**
 * site_media — standalone Admin Next field for page blueprints.
 *
 * Opens the shared site media picker (bb-media-picker.js).
 * Stores a portable relative path under user/media. Optional companion alt
 * is written to a sibling field (blueprint `alt_field`, default `{name}_alt`).
 * Styles: assets/css/badger-builder-admin.css (loaded via _ensureStylesheet).
 */

const TAG = window.__GRAV_FIELD_TAG;

/** @type {Promise<typeof window.BadgerMediaPicker>|null} */
let mediaPickerLoadPromise = null;

function apiPath(path) {
    return (window.__GRAV_API_SERVER_URL || '') +
        (window.__GRAV_API_PREFIX || '/api/v1') + path;
}

function apiHeaders(json = false) {
    const h = { Accept: 'application/json' };
    const token = window.__GRAV_API_TOKEN;
    if (token) h['X-API-Token'] = token;
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizePath(value) {
    if (!value) {
        return '';
    }
    if (typeof value === 'object') {
        return normalizePath(value.path || value.name || value.filename || '');
    }
    let rel = String(value).trim();
    if (!rel) {
        return '';
    }
    try {
        if (/^https?:\/\//i.test(rel) || rel.startsWith('//')) {
            const abs = rel.startsWith('//') ? `${window.location.protocol}${rel}` : rel;
            rel = new URL(abs).pathname || '';
        }
    } catch {
        // keep original
    }
    rel = rel.replace(/^\/user\/media\//i, '').replace(/^\/+/, '');
    return rel;
}

function encodeMediaRel(rel) {
    return String(rel || '')
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
}

function siteMediaPreviewUrl(path) {
    if (!path) {
        return '';
    }
    const base = (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
    return `${base}/user/media/${encodeMediaRel(path)}`;
}

function ensureBadgerMediaPicker() {
    if (window.BadgerMediaPicker) {
        return Promise.resolve(window.BadgerMediaPicker);
    }
    if (!mediaPickerLoadPromise) {
        mediaPickerLoadPromise = (async () => {
            const resp = await fetch(apiPath('/gpm/plugins/badger-builder/fields'), {
                headers: apiHeaders(),
            });
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

class SiteMediaField extends HTMLElement {
    constructor() {
        super();
        this._value = '';
        this._field = null;
        this._alt = '';
        this._error = null;
    }

    set field(v) {
        this._field = v;
        if (this.isConnected) {
            this._render();
        }
    }
    get field() {
        return this._field;
    }

    set value(v) {
        const next = normalizePath(v);
        if (next !== this._value) {
            this._value = next;
            if (this.isConnected) {
                this._render();
            }
        }
    }
    get value() {
        return this._value;
    }

    connectedCallback() {
        this._ensureStylesheet();
        this._render();
        ensureBadgerMediaPicker().catch(() => {});
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

    _emit(newValue, { alt } = {}) {
        this._value = normalizePath(newValue);
        if (alt !== undefined) {
            this._alt = alt || '';
            this._syncCompanionAlt(this._alt);
        }
        this._error = null;
        this._render();
        this.dispatchEvent(new CustomEvent('change', {
            detail: this._value,
            bubbles: true,
        }));
    }

    _altFieldName() {
        if (this._field?.alt_field) {
            return String(this._field.alt_field);
        }
        const name = this._field?.name || '';
        return name ? `${name}_alt` : '';
    }

    _syncCompanionAlt(alt) {
        const altName = this._altFieldName();
        const form = this.closest('form') || document;
        if (altName) {
            const escaped = (window.CSS && CSS.escape) ? CSS.escape(altName) : altName.replace(/"/g, '\\"');
            const named = form.querySelector(
                `[name="${escaped}"], [data-name="${escaped}"], [name="data[${escaped}]"]`,
            );
            if (named) {
                this._writeControl(named, alt);
                return;
            }
        }
        const group = this.closest('.field, [data-field], .form-group') || this.parentElement;
        const next = group?.nextElementSibling;
        const input = next?.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
        if (input) {
            this._writeControl(input, alt);
        }
    }

    _writeControl(el, alt) {
        const value = alt || '';
        if (el.tagName && el.tagName.includes('-')) {
            el.value = value;
            el.dispatchEvent(new CustomEvent('change', { detail: value, bubbles: true }));
            return;
        }
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async _openPicker() {
        this._error = null;
        try {
            const picker = await ensureBadgerMediaPicker();
            await picker.open({
                title: this._field?.picker_title || 'Choose image',
                selectedPath: this._value || null,
                alt: this._alt || '',
                onInsert: ({ path, alt }) => {
                    this._emit(path, { alt: alt || '' });
                },
            });
        } catch (err) {
            this._error = err?.message || String(err);
            this._render();
            console.warn('[badger-builder] Site media picker failed', err);
        }
    }

    _clear() {
        this._emit('', { alt: '' });
    }

    _render() {
        const val = this._value || '';
        const thumb = val ? siteMediaPreviewUrl(val) : '';
        const preview = val
            ? (thumb
                ? `<img class="bb-admin-media-preview-img" src="${escapeHtml(thumb)}" alt="${escapeHtml(this._alt || val)}" />`
                : `<span class="bb-admin-media-preview-file">${escapeHtml(val)}</span>`)
            : `<span class="bb-admin-media-preview-empty">No image selected</span>`;
        const error = this._error
            ? `<div class="bb-admin-error">${escapeHtml(this._error)}</div>`
            : '';

        this.innerHTML = `
            <div class="bb-admin-field bb-admin-field-media">
                <div class="bb-admin-media-preview">${preview}</div>
                ${error}
                <div class="bb-admin-media-actions">
                    <button type="button" class="bb-admin-btn bb-admin-btn-primary" data-action="media-open">Choose from site media</button>
                    ${val ? '<button type="button" class="bb-admin-btn bb-admin-btn-ghost" data-action="media-clear">Clear</button>' : ''}
                </div>
            </div>
        `;

        const img = this.querySelector('.bb-admin-media-preview-img');
        if (img) {
            img.addEventListener('error', () => {
                const span = document.createElement('span');
                span.className = 'bb-admin-media-preview-file';
                span.textContent = val;
                img.replaceWith(span);
            });
        }

        this.querySelector('[data-action="media-open"]')
            ?.addEventListener('click', () => this._openPicker());
        this.querySelector('[data-action="media-clear"]')
            ?.addEventListener('click', () => this._clear());
    }
}

customElements.define(TAG, SiteMediaField);
