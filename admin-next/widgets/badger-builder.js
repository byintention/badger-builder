/**
 * Autoload widget for the Admin Next Pages list.
 *
 * Admin Next has no page-list column API (unlike Users). This script paints
 * the same meta-description traffic lights used on the Metadata field onto
 * tree, list, and miller rows. showFab is false — the host still loads the
 * tag; work happens in the light DOM.
 */

const TAG = window.__GRAV_WIDGET_TAG || 'grav-badger-builder--widget';

const GREEN_MIN = 150;
const GREEN_MAX = 160;
const AMBER_MIN = 120;
const HEADER_LABEL = 'Meta';

const descriptions = new Map();

function lengthState(len) {
    if (len >= GREEN_MIN && len <= GREEN_MAX) {
        return 'green';
    }
    if (len >= AMBER_MIN && len < GREEN_MIN) {
        return 'amber';
    }
    return 'red';
}

function lengthWord(state) {
    if (state === 'green') {
        return 'Good';
    }
    if (state === 'amber') {
        return 'OK';
    }
    return 'Poor';
}

function lengthMessage(len, state) {
    const word = lengthWord(state);
    if (state === 'green') {
        return `${word} — ${len} characters`;
    }
    if (state === 'amber') {
        return `${word} — ${len} characters, a little short (aim for ${GREEN_MIN}–${GREEN_MAX})`;
    }
    if (len > GREEN_MAX) {
        return `${word} — ${len} characters, too long (aim for ${GREEN_MIN}–${GREEN_MAX})`;
    }
    return `${word} — ${len} characters, too short (aim for ${GREEN_MIN}–${GREEN_MAX})`;
}

function normalizeRoute(route) {
    if (route == null || route === '') {
        return '/';
    }
    const value = String(route);
    return value.startsWith('/') ? value : `/${value}`;
}

function descriptionFromPage(page) {
    const meta = page?.header?.metadata;
    if (!meta || typeof meta !== 'object') {
        return '';
    }
    const raw = meta.description;
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof raw === 'object' && typeof raw.content === 'string') {
        return raw.content;
    }
    return '';
}

function ingest(items) {
    if (!Array.isArray(items)) {
        return;
    }
    for (const page of items) {
        if (!page || typeof page !== 'object') {
            continue;
        }
        const desc = descriptionFromPage(page);
        if (page.route != null) {
            descriptions.set(normalizeRoute(page.route), desc);
        }
        if (page.raw_route != null) {
            descriptions.set(normalizeRoute(page.raw_route), desc);
        }
    }
}

function isPagesCollectionUrl(url) {
    try {
        const parsed = new URL(url, window.location.origin);
        const path = parsed.pathname.replace(/\/+$/, '');
        return path.endsWith('/pages');
    } catch {
        return false;
    }
}

function hookFetch() {
    if (window.__bbMetaDescFetchHooked || typeof window.fetch !== 'function') {
        return;
    }
    window.__bbMetaDescFetchHooked = true;
    const original = window.fetch.bind(window);
    window.fetch = function bbMetaDescFetch(input, init) {
        const pending = original(input, init);
        try {
            const url = typeof input === 'string'
                ? input
                : (input && typeof input === 'object' && 'url' in input ? String(input.url) : '');
            if (url && isPagesCollectionUrl(url)) {
                pending.then((response) => {
                    if (!response || !response.ok) {
                        return;
                    }
                    response.clone().json().then((body) => {
                        const items = Array.isArray(body?.data)
                            ? body.data
                            : (Array.isArray(body) ? body : []);
                        ingest(items);
                        schedulePaint();
                    }).catch(() => {});
                }).catch(() => {});
            }
        } catch {
            // Keep the original request going.
        }
        return pending;
    };
}

function apiUrl(path) {
    return (window.__GRAV_API_SERVER_URL || '')
        + (window.__GRAV_API_PREFIX || '/api/v1')
        + path;
}

function apiHeaders() {
    const headers = { Accept: 'application/json' };
    const token = window.__GRAV_API_TOKEN;
    if (token) {
        headers['X-API-Token'] = token;
    }
    return headers;
}

let backfilling = false;
let backfillTimer = 0;

async function backfill() {
    if (backfilling) {
        return;
    }
    backfilling = true;
    try {
        let page = 1;
        let totalPages = 1;
        do {
            const response = await fetch(
                apiUrl(`/pages?per_page=200&page=${page}`),
                { headers: apiHeaders() },
            );
            if (!response.ok) {
                break;
            }
            const body = await response.json();
            ingest(Array.isArray(body?.data) ? body.data : []);
            totalPages = Number(body?.meta?.pagination?.total_pages) || 1;
            page += 1;
        } while (page <= totalPages);
        schedulePaint();
    } catch {
        // Listing still works without the column.
    } finally {
        backfilling = false;
    }
}

function visibleRowsNeedData() {
    const links = document.querySelectorAll('a[href*="/pages/edit"]');
    for (const link of links) {
        const route = routeFromHref(link.getAttribute('href'));
        const subtitle = link.querySelector('.truncate')?.textContent?.trim();
        if (lookupDescription(route) == null && lookupDescription(subtitle) == null) {
            return true;
        }
    }
    return links.length > 0 && descriptions.size === 0;
}

function startBackfill() {
    if (backfillTimer) {
        return;
    }
    backfillTimer = window.setTimeout(() => {
        backfillTimer = 0;
        if (!isPagesList()) {
            return;
        }
        if (visibleRowsNeedData()) {
            backfill();
        }
    }, 350);
}

function ensureStylesheet() {
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

function isPagesList() {
    const path = (window.location.pathname || '').replace(/\/+$/, '') || '/';
    return path.endsWith('/pages');
}

function routeFromHref(href) {
    if (!href) {
        return null;
    }
    try {
        const parsed = new URL(href, window.location.origin);
        const marker = '/pages/edit';
        const idx = parsed.pathname.indexOf(marker);
        if (idx === -1) {
            return null;
        }
        const rest = parsed.pathname.slice(idx + marker.length);
        if (rest === '' || rest === '/') {
            return '/';
        }
        return rest.startsWith('/') ? rest : `/${rest}`;
    } catch {
        return null;
    }
}

function lookupDescription(route) {
    if (route == null) {
        return null;
    }
    const key = normalizeRoute(route);
    if (descriptions.has(key)) {
        return descriptions.get(key);
    }
    if (key !== '/' && descriptions.has(`${key}/`)) {
        return descriptions.get(`${key}/`);
    }
    return null;
}

function fillLight(host, description) {
    const len = description.length;
    const state = lengthState(len);
    const message = lengthMessage(len, state);
    host.classList.remove('is-green', 'is-amber', 'is-red');
    host.classList.add(`is-${state}`);
    host.title = message;
    host.setAttribute('aria-label', `Meta description: ${message}`);
}

function makeLight(description) {
    const wrap = document.createElement('span');
    wrap.className = 'bb-admin-meta-desc-status';
    wrap.setAttribute('role', 'img');
    const dot = document.createElement('span');
    dot.className = 'bb-admin-meta-desc-icon';
    dot.setAttribute('aria-hidden', 'true');
    wrap.appendChild(dot);
    fillLight(wrap, description);
    return wrap;
}

function makeColumn(description) {
    const col = document.createElement('div');
    col.className = 'flex w-10 justify-center bb-admin-meta-desc-col';
    col.dataset.bbMetaDescCol = '1';
    col.appendChild(makeLight(description));
    return col;
}

function makeHeader() {
    const col = document.createElement('div');
    col.className = 'w-10 text-center bb-admin-meta-desc-col';
    col.dataset.bbMetaDescHeader = '1';
    col.dataset.bbMetaDescCol = '1';
    const span = document.createElement('span');
    span.className = 'bb-admin-meta-desc-col-header';
    span.textContent = HEADER_LABEL;
    col.title = 'Meta description';
    col.appendChild(span);
    return col;
}

function isTemplateColumn(el) {
    return el
        && el.matches('div.hidden.w-20.text-center.md\\:block, div.w-20.text-center');
}

function paintHeaders() {
    const dots = document.querySelectorAll('div.w-6.text-center');
    for (const el of dots) {
        if (el.dataset.bbMetaDescHeader) {
            continue;
        }
        const label = (el.textContent || '').trim();
        if (label !== '·') {
            continue;
        }
        const prev = el.previousElementSibling;
        if (!isTemplateColumn(prev)) {
            continue;
        }
        const next = el.nextElementSibling;
        if (next && next.dataset && next.dataset.bbMetaDescHeader) {
            continue;
        }
        el.insertAdjacentElement('afterend', makeHeader());
    }
}

function pageLinkFrom(node) {
    return node.parentElement?.querySelector('a[href*="/pages/edit"]') || null;
}

function paintRowColumns() {
    const cells = document.querySelectorAll('div.flex.w-6.justify-center');
    for (const el of cells) {
        if (el.dataset.bbMetaDescCol) {
            continue;
        }
        const prev = el.previousElementSibling;
        if (!prev || !prev.classList.contains('w-20')) {
            continue;
        }
        const next = el.nextElementSibling;
        if (next && next.dataset && next.dataset.bbMetaDescCol && !next.dataset.bbMetaDescHeader) {
            const link = pageLinkFrom(el);
            const route = routeFromHref(link?.getAttribute('href'));
            const subtitle = link?.querySelector('.truncate')?.textContent?.trim();
            const desc = lookupDescription(route) ?? lookupDescription(subtitle);
            if (desc != null) {
                const status = next.querySelector('.bb-admin-meta-desc-status');
                if (status) {
                    fillLight(status, desc);
                }
            }
            continue;
        }
        const link = pageLinkFrom(el);
        const route = routeFromHref(link?.getAttribute('href'));
        const subtitle = link?.querySelector('.truncate')?.textContent?.trim();
        const desc = lookupDescription(route) ?? lookupDescription(subtitle);
        if (desc == null) {
            continue;
        }
        el.insertAdjacentElement('afterend', makeColumn(desc));
    }
}

function paintMiller() {
    const rows = document.querySelectorAll('[data-miller-row]');
    for (const row of rows) {
        const link = row.querySelector('a[href*="/pages/edit"]');
        if (!link) {
            continue;
        }
        const cluster = row.querySelector('[class*="gap-1.5"]');
        if (!cluster) {
            continue;
        }
        const route = routeFromHref(link.getAttribute('href'));
        const desc = lookupDescription(route);
        if (desc == null) {
            continue;
        }
        let col = cluster.querySelector('[data-bb-meta-desc-col]');
        if (!col) {
            col = document.createElement('span');
            col.className = 'bb-admin-meta-desc-col';
            col.dataset.bbMetaDescCol = '1';
            col.appendChild(makeLight(desc));
            cluster.appendChild(col);
        } else {
            const status = col.querySelector('.bb-admin-meta-desc-status');
            if (status) {
                fillLight(status, desc);
            }
        }
    }
}

function clearInjected() {
    document.querySelectorAll('[data-bb-meta-desc-col]').forEach((node) => node.remove());
}

let painting = false;
let paintQueued = false;

function pruneOrphans() {
    document.querySelectorAll('[data-bb-meta-desc-header]').forEach((col) => {
        const prev = col.previousElementSibling;
        const label = (prev?.textContent || '').trim();
        if (!(prev && prev.classList.contains('w-6') && label === '·')) {
            col.remove();
        }
    });
    document.querySelectorAll('[data-bb-meta-desc-col]:not([data-bb-meta-desc-header])').forEach((col) => {
        if (col.closest('[data-miller-row]')) {
            return;
        }
        const prev = col.previousElementSibling;
        if (!(prev && prev.classList.contains('w-6') && prev.classList.contains('justify-center'))) {
            col.remove();
        }
    });
}

function paint() {
    if (painting) {
        return;
    }
    painting = true;
    try {
        if (!isPagesList()) {
            clearInjected();
            return;
        }
        pruneOrphans();
        paintHeaders();
        paintRowColumns();
        paintMiller();
    } finally {
        painting = false;
    }
}

function schedulePaint() {
    if (paintQueued) {
        return;
    }
    paintQueued = true;
    requestAnimationFrame(() => {
        paintQueued = false;
        paint();
    });
}

function startObserver() {
    if (window.__bbMetaDescObserver) {
        return;
    }
    const observer = new MutationObserver(() => {
        if (painting) {
            return;
        }
        schedulePaint();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__bbMetaDescObserver = observer;
}

class BadgerBuilderWidget extends HTMLElement {
    connectedCallback() {
        this.style.display = 'none';
        ensureStylesheet();
        hookFetch();
        startObserver();
        schedulePaint();
        startBackfill();
    }
}

try {
    if (!customElements.get(TAG)) {
        customElements.define(TAG, BadgerBuilderWidget);
    }
} catch {
    // Host already defined the tag.
}

ensureStylesheet();
hookFetch();
startObserver();
schedulePaint();
startBackfill();
