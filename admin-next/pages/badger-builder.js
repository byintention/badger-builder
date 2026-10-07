/**
 * Badger Builder — Admin Next Updates page.
 * Tag: window.__GRAV_PAGE_TAG → grav-badger-builder--page
 */
const TAG = window.__GRAV_PAGE_TAG || 'grav-badger-builder--page';

function apiBase() {
    return (window.__GRAV_API_SERVER_URL || '') + (window.__GRAV_API_PREFIX || '/api/v1');
}

function apiHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    const token = window.__GRAV_API_TOKEN;
    if (token) headers['X-API-Token'] = token;
    return headers;
}

async function api(path, options = {}) {
    const res = await fetch(apiBase() + path, {
        ...options,
        headers: apiHeaders(options.headers || {}),
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = json?.error?.detail || json?.error?.message || `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return json.data;
}

class BadgerBuilderPage extends HTMLElement {
    constructor() {
        super();
        this._loading = true;
        this._applying = false;
        this._error = '';
        this._status = '';
        this._data = null;
    }

    connectedCallback() {
        this._ensureStyles();
        this._check();
    }

    _ensureStyles() {
        if (document.getElementById('bb-updates-admin-css')) return;
        const link = document.createElement('link');
        link.id = 'bb-updates-admin-css';
        link.rel = 'stylesheet';
        link.href = (window.__GRAV_API_SERVER_URL || '') + '/user/plugins/badger-builder/assets/css/badger-builder-updates.css';
        document.head.appendChild(link);
    }

    async _check() {
        this._loading = true;
        this._error = '';
        this._status = '';
        this._render();
        try {
            this._data = await api('/badger-builder/updates');
        } catch (err) {
            this._error = err.message || String(err);
            this._data = null;
        } finally {
            this._loading = false;
            this._render();
        }
    }

    async _apply() {
        const d = this._data;
        if (!d?.update_available || this._applying) return;

        const ok = await window.__GRAV_DIALOGS?.confirm({
            title: 'Install update?',
            message: `Install Badger Builder ${d.latest} from Gitea release ${d.tag || d.latest}? Site config and theme panels are not overwritten.`,
            confirmLabel: 'Install update',
            variant: 'default',
        });
        if (!ok) return;

        this._applying = true;
        this._error = '';
        this._status = 'Downloading and installing…';
        this._render();

        try {
            const body = {};
            if (d.tag) body.tag = d.tag;
            const result = await api('/badger-builder/updates/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            this._status = result?.message || 'Update installed.';
            this._data = await api('/badger-builder/updates');
        } catch (err) {
            this._error = err.message || String(err);
        } finally {
            this._applying = false;
            this._render();
        }
    }

    _escape(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _render() {
        const d = this._data;
        const bodyHtml = d?.body
            ? `<pre class="bb-updates-notes">${this._escape(d.body).slice(0, 4000)}</pre>`
            : '<p class="bb-updates-muted">No release notes.</p>';

        let stateHtml = '';
        if (this._loading) {
            stateHtml = '<p class="bb-updates-muted">Checking Gitea Releases…</p>';
        } else if (!d) {
            stateHtml = '';
        } else if (!d.enabled) {
            stateHtml = '<p class="bb-updates-warn">Private updates are disabled in plugin settings.</p>';
        } else if (!d.configured) {
            stateHtml = `<p class="bb-updates-warn">${this._escape(d.message || 'Not configured.')}</p>
                <p class="bb-updates-muted">Add <code>updates.token</code> (and repo settings) in <code>user/config/plugins/badger-builder.yaml</code> or Plugins → Badger Builder.</p>`;
        } else if (d.update_available) {
            stateHtml = `<p class="bb-updates-ok">Update available: <strong>${this._escape(d.latest)}</strong>${d.prerelease ? ' (prerelease)' : ''}</p>`;
        } else {
            stateHtml = `<p class="bb-updates-muted">${this._escape(d.message || 'Up to date.')}</p>`;
        }

        this.innerHTML = `
            <div class="bb-updates">
                <header class="bb-updates-head">
                    <div>
                        <h2 class="bb-updates-title">Badger Builder Updates</h2>
                        <p class="bb-updates-muted">Private updates from Gitea Releases (curated zip). Theme panels/templates are not updated.</p>
                    </div>
                    <div class="bb-updates-actions">
                        <button type="button" class="bb-updates-btn" data-action="check" ${this._loading || this._applying ? 'disabled' : ''}>Check for updates</button>
                        <button type="button" class="bb-updates-btn bb-updates-btn-primary" data-action="apply"
                            ${!d?.update_available || this._loading || this._applying ? 'disabled' : ''}>Install update</button>
                    </div>
                </header>

                ${this._error ? `<div class="bb-updates-error" role="alert">${this._escape(this._error)}</div>` : ''}
                ${this._status ? `<div class="bb-updates-status">${this._escape(this._status)}</div>` : ''}

                <section class="bb-updates-card">
                    <dl class="bb-updates-meta">
                        <div><dt>Installed</dt><dd>${this._escape(d?.current ?? '—')}</dd></div>
                        <div><dt>Latest</dt><dd>${this._escape(d?.latest ?? '—')}</dd></div>
                        <div><dt>Release</dt><dd>${this._escape(d?.release_name || d?.tag || '—')}</dd></div>
                        <div><dt>Asset</dt><dd>${this._escape(d?.asset_name ?? '—')}</dd></div>
                    </dl>
                    ${stateHtml}
                </section>

                <section class="bb-updates-card">
                    <h3 class="bb-updates-subtitle">Release notes</h3>
                    ${this._loading ? '<p class="bb-updates-muted">…</p>' : bodyHtml}
                </section>
            </div>
        `;

        this.querySelector('[data-action="check"]')?.addEventListener('click', () => this._check());
        this.querySelector('[data-action="apply"]')?.addEventListener('click', () => this._apply());
    }
}

if (!customElements.get(TAG)) {
    customElements.define(TAG, BadgerBuilderPage);
}
