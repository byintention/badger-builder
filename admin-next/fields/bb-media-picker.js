/**
 * BadgerMediaPicker — site media browser overlay (Admin Next three-pane layout).
 * Tree left, file grid centre, details pane right. Uses GET/POST /api/v1/media*.
 * Details Edit loads Filerobot for crop/rotate/resize (save as new, or replace).
 */
(function (global) {
    'use strict';

    const MEDIA_PREFIX = '/user/media/';
    const DIALOG_ID = 'bb-media-picker';
    const DRAG_TYPE = 'application/x-bb-media-path';
    const STYLESHEET_ID = 'badger-builder-admin-stylesheet';
    const FILEROBOT_SRC = '/user/plugins/badger-builder/assets/vendor/filerobot-image-editor/filerobot-image-editor.min.js';
    const MAX_UPLOAD_EDGE = 1920;

    /** @type {Promise<unknown>|null} */
    let filerobotLoadPromise = null;

    /** @type {null | { close: () => void }} */
    let activeSession = null;

    function apiBase() {
        return (global.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');
    }

    function apiPrefix() {
        return global.__GRAV_API_PREFIX || '/api/v1';
    }

    function apiPath(path) {
        return apiBase() + apiPrefix() + path;
    }

    function headers(json) {
        const h = { Accept: 'application/json' };
        const token = global.__GRAV_API_TOKEN;
        if (token) h['X-API-Token'] = token;
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }

    function encodeMediaPath(path) {
        return String(path || '')
            .split('/')
            .filter(Boolean)
            .map(encodeURIComponent)
            .join('/');
    }

    function dirname(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        parts.pop();
        return parts.join('/');
    }

    function basename(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
    }

    function joinPath(folder, name) {
        const dir = String(folder || '').replace(/^\/+|\/+$/g, '');
        const file = String(name || '').replace(/^\/+/, '');
        return dir ? `${dir}/${file}` : file;
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function itemRelativePath(item) {
        const folder = String(item.path || '').replace(/^\/+|\/+$/g, '');
        const name = item.filename || '';
        return folder ? `${folder}/${name}` : name;
    }

    /** Percent-encode each path segment without double-encoding. */
    function encodePathname(pathname) {
        return String(pathname || '')
            .split('/')
            .map((seg) => {
                if (!seg) return seg;
                try {
                    seg = decodeURIComponent(seg);
                } catch {
                    // keep as-is
                }
                return encodeURIComponent(seg);
            })
            .join('/');
    }

    function toPortableUrl(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }
        try {
            if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
                const abs = url.startsWith('//') ? `${global.location.protocol}${url}` : url;
                return encodePathname(new URL(abs).pathname || '');
            }
        } catch {
            // fall through
        }
        if (url.startsWith('/')) {
            return encodePathname(url);
        }
        return encodePathname(`/${url.replace(/^\/+/, '')}`);
    }

    function encodeMediaUrl(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }
        try {
            if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
                const abs = url.startsWith('//') ? `${global.location.protocol}${url}` : url;
                const parsed = new URL(abs);
                parsed.pathname = encodePathname(parsed.pathname);
                return parsed.toString();
            }
        } catch {
            // fall through
        }
        return encodePathname(url.startsWith('/') ? url : `/${url.replace(/^\/+/, '')}`);
    }

    function previewUrl(item) {
        const thumb = item.thumbnail_url || item.url || '';
        if (!thumb) return '';
        if (/^https?:\/\//i.test(thumb) || thumb.startsWith('/')) {
            const resolved = thumb.startsWith('http') ? thumb : `${apiBase()}${thumb}`;
            return encodeMediaUrl(resolved);
        }
        return encodeMediaUrl(thumb);
    }

    function fullPreviewUrl(item) {
        const src = item.url || '';
        if (!src) return previewUrl(item);
        if (/^https?:\/\//i.test(src) || src.startsWith('/')) {
            const resolved = src.startsWith('http') ? src : `${apiBase()}${src}`;
            return encodeMediaUrl(resolved);
        }
        return encodeMediaUrl(src);
    }

    function formatSize(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        const units = ['KB', 'MB', 'GB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i += 1;
        }
        return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
    }

    function formatModified(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString();
    }

    async function readError(resp) {
        try {
            const json = await resp.json();
            return json.detail || json.title || json.message || `HTTP ${resp.status}`;
        } catch {
            return `HTTP ${resp.status}`;
        }
    }

    function isImageFile(file) {
        if (!file) return false;
        if (file.type && file.type.startsWith('image/')) return true;
        return /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(file.name || '');
    }

    function isSvgFile(file) {
        const type = String(file?.type || '').toLowerCase();
        if (type.includes('svg')) return true;
        return /\.svg$/i.test(file?.name || '');
    }

    function isUploadLimitError(err) {
        const status = err?.status;
        if (status === 413 || status === 422) return true;
        const msg = String(err?.message || '').toLowerCase();
        return /exceeds|too large|upload size|post_max|upload_max|allowed size|memory/.test(msg);
    }

    async function inspectImage(file) {
        if (!file || isSvgFile(file)) return null;
        if (typeof createImageBitmap === 'function') {
            try {
                let bitmap;
                try {
                    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
                } catch {
                    bitmap = await createImageBitmap(file);
                }
                return {
                    width: bitmap.width,
                    height: bitmap.height,
                    draw(ctx, w, h) {
                        ctx.drawImage(bitmap, 0, 0, w, h);
                    },
                    close() {
                        if (typeof bitmap.close === 'function') bitmap.close();
                    },
                };
            } catch {
                // fall through to Image()
            }
        }
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('Could not read image'));
                el.src = url;
            });
            return {
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                draw(ctx, w, h) {
                    ctx.drawImage(img, 0, 0, w, h);
                },
                close() {
                    URL.revokeObjectURL(url);
                },
            };
        } catch (e) {
            URL.revokeObjectURL(url);
            throw e;
        }
    }

    function outputMimeForResize(file) {
        const type = String(file?.type || '').toLowerCase();
        const name = String(file?.name || '');
        if (type === 'image/png' || /\.png$/i.test(name)) return 'image/png';
        if (type === 'image/webp' || /\.webp$/i.test(name)) return 'image/webp';
        return 'image/jpeg';
    }

    function resizedFileName(name, mime) {
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const stem = String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
        return `${stem}.${ext}`;
    }

    async function downscaleImageFile(file, inspect, { maxEdge = MAX_UPLOAD_EDGE, force = false } = {}) {
        const info = inspect || await inspectImage(file);
        if (!info) return file;
        try {
            const longest = Math.max(info.width, info.height) || 1;
            const scale = longest > maxEdge ? maxEdge / longest : 1;
            if (scale >= 1 && !force) return file;
            const w = Math.max(1, Math.round(info.width * scale));
            const h = Math.max(1, Math.round(info.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not resize image');
            const mime = outputMimeForResize(file);
            if (mime === 'image/jpeg') {
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, w, h);
            }
            info.draw(ctx, w, h);
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('Could not resize image'))),
                    mime,
                    0.85,
                );
            });
            return new File([blob], resizedFileName(file.name, mime), {
                type: mime,
                lastModified: Date.now(),
            });
        } finally {
            info.close();
        }
    }

    function ensureStylesheet() {
        if (document.getElementById(STYLESHEET_ID)) {
            return;
        }
        const link = document.createElement('link');
        link.id = STYLESHEET_ID;
        link.rel = 'stylesheet';
        link.href = `${apiBase()}/user/plugins/badger-builder/assets/css/badger-builder-admin.css`;
        document.head.appendChild(link);
    }

    function loadFilerobot() {
        if (global.FilerobotImageEditor) {
            return Promise.resolve(global.FilerobotImageEditor);
        }
        if (filerobotLoadPromise) {
            return filerobotLoadPromise;
        }
        filerobotLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${apiBase()}${FILEROBOT_SRC}`;
            script.async = true;
            script.onload = () => {
                if (global.FilerobotImageEditor) {
                    resolve(global.FilerobotImageEditor);
                    return;
                }
                filerobotLoadPromise = null;
                reject(new Error('Image editor failed to initialise.'));
            };
            script.onerror = () => {
                filerobotLoadPromise = null;
                reject(new Error('Failed to load the image editor.'));
            };
            document.head.appendChild(script);
        });
        return filerobotLoadPromise;
    }

    function isSvgItem(item) {
        const type = String(item?.type || '').toLowerCase();
        if (type.includes('svg')) return true;
        return /\.svg$/i.test(item?.filename || '');
    }

    function extFromMime(mime, fallbackName) {
        const map = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
        };
        if (map[mime]) return map[mime];
        const ext = (String(fallbackName || '').split('.').pop() || 'png').toLowerCase();
        return ext === 'jpeg' ? 'jpg' : ext || 'png';
    }

    async function imageDataToFile(imageData, filename) {
        const mime = imageData?.mimeType || 'image/png';
        if (imageData?.imageBase64) {
            const res = await fetch(imageData.imageBase64);
            const blob = await res.blob();
            return new File([blob], filename, { type: blob.type || mime });
        }
        const canvas = imageData?.imageCanvas;
        if (canvas && typeof canvas.toBlob === 'function') {
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('Could not export the edited image.'))),
                    mime,
                    0.92,
                );
            });
            return new File([blob], filename, { type: mime });
        }
        throw new Error('The editor did not return image data.');
    }

    async function fetchMedia({ path = '', search = '', page = 1 } = {}) {
        const params = new URLSearchParams();
        params.set('type', 'image');
        params.set('per_page', '100');
        params.set('page', String(page));
        if (path) params.set('path', path);
        if (search) params.set('search', search);
        const resp = await fetch(`${apiPath('/media')}?${params}`, { headers: headers() });
        if (resp.status === 403 || resp.status === 401) {
            const err = new Error(await readError(resp));
            err.status = resp.status;
            throw err;
        }
        if (!resp.ok) {
            throw new Error(await readError(resp));
        }
        const json = await resp.json();
        const items = Array.isArray(json.data) ? json.data : [];
        const meta = json.meta || {};
        const pagination = meta.pagination || {};
        const pageNum = Number(pagination.page || page);
        const last = Number(pagination.last_page || pagination.total_pages || 1);
        return {
            items: items.filter((m) => String(m.type || '').startsWith('image/')),
            folders: Array.isArray(meta.folders) ? meta.folders : [],
            path: meta.path || path || '',
            page: pageNum,
            hasMore: pageNum < last,
        };
    }

    async function apiJson(method, path, body) {
        const opts = { method, headers: headers(body !== undefined) };
        if (body !== undefined) {
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch(apiPath(path), opts);
        if (!resp.ok) {
            const err = new Error(await readError(resp));
            err.status = resp.status;
            throw err;
        }
        if (resp.status === 204) {
            return null;
        }
        return resp.json();
    }

    async function uploadFile(file, folderPath) {
        const body = new FormData();
        body.append('file', file);
        const qs = folderPath ? `?path=${encodeURIComponent(folderPath)}` : '';
        const h = headers();
        delete h['Content-Type'];
        const resp = await fetch(`${apiPath('/media')}${qs}`, {
            method: 'POST',
            headers: h,
            body,
        });
        if (!resp.ok) {
            const err = new Error(await readError(resp));
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    }

    async function patchMeta(relativePath, fields) {
        const resp = await fetch(
            `${apiPath('/media/meta')}?path=${encodeURIComponent(relativePath)}`,
            {
                method: 'PATCH',
                headers: headers(true),
                body: JSON.stringify({ fields }),
            },
        );
        if (!resp.ok) {
            throw new Error(await readError(resp));
        }
        return resp.json();
    }

    async function fetchMeta(relativePath) {
        const resp = await fetch(
            `${apiPath('/media/meta')}?path=${encodeURIComponent(relativePath)}`,
            { headers: headers() },
        );
        if (!resp.ok) {
            throw new Error(await readError(resp));
        }
        const json = await resp.json();
        return json.data || json;
    }

    function folderIcon() {
        return '<svg class="bb-media-picker-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
    }

    /**
     * @param {object} options
     * @param {string} [options.title]
     * @param {string|null} [options.selectedPath]
     * @param {string} [options.alt]
     * @param {boolean} [options.allowUpload]
     * @param {(result: {path:string,url:string,alt:string,filename:string}) => void} [options.onInsert]
     * @param {() => void} [options.onCancel]
     */
    async function open(options = {}) {
        ensureStylesheet();

        if (activeSession) {
            activeSession.close();
        }

        const allowWrite = options.allowUpload !== false;
        const initialPath = options.selectedPath ? dirname(options.selectedPath) : '';

        const state = {
            path: initialPath,
            search: '',
            folders: [],
            items: [],
            loading: true,
            error: null,
            status: '',
            selectedPath: options.selectedPath || null,
            selectedItem: null,
            metaFields: [],
            metaGen: 0,
            tree: {},
            canWrite: allowWrite,
            busy: false,
            dropPath: null,
            draggingPath: null,
            page: 1,
            hasMore: false,
            confirm: null,
            newFolder: false,
            renameFolder: false,
            uploadLock: false,
        };

        const ui = {};
        let closed = false;
        let inserted = false;
        let editorInstance = null;
        let editorGen = 0;
        const previousFocus = document.activeElement;

        const session = { close: () => closePicker(false) };
        activeSession = session;

        function editorIsOpen() {
            return Boolean(editorInstance) || (ui.editor && !ui.editor.hidden);
        }

        function closeEditor() {
            editorGen += 1;
            const inst = editorInstance;
            editorInstance = null;
            if (inst) {
                try {
                    inst.terminate();
                } catch {
                    // already unmounted
                }
            }
            if (ui.editor) {
                ui.editor.hidden = true;
            }
            if (ui.editorStage) {
                ui.editorStage.replaceChildren();
            }
            document.querySelectorAll('body > .SfxModal-Wrapper, body > .SfxPopper-wrapper').forEach((n) => n.remove());
        }

        function closePicker(didInsert) {
            if (closed) return;
            closed = true;
            inserted = Boolean(didInsert);
            closeEditor();
            if (state.confirm) {
                finishConfirm(false);
            }
            ui.confirm?.remove();
            if (activeSession === session) {
                activeSession = null;
            }
            document.removeEventListener('keydown', onDocKey, true);
            window.removeEventListener('pointerdown', onConfirmPointer, true);
            window.removeEventListener('click', onConfirmPointer, true);
            ui.wrap?.remove();
            document.body.classList.remove('bb-media-picker-open');
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus();
            }
            if (!inserted && typeof options.onCancel === 'function') {
                options.onCancel();
            }
        }

        function setTreeNode(path, folders, expanded) {
            const key = path || '';
            const prev = state.tree[key] || {};
            state.tree[key] = {
                folders: folders || prev.folders || [],
                loaded: true,
                expanded: expanded !== undefined ? expanded : (prev.expanded ?? true),
            };
        }

        async function ensureTreePath(path) {
            const chain = [''];
            let acc = '';
            String(path || '').split('/').filter(Boolean).forEach((seg) => {
                acc = acc ? `${acc}/${seg}` : seg;
                chain.push(acc);
            });
            for (const p of chain) {
                if (state.tree[p]?.loaded) {
                    state.tree[p].expanded = true;
                    continue;
                }
                const data = await fetchMedia({ path: p, page: 1 });
                setTreeNode(p, data.folders, true);
            }
        }

        async function refresh({ append = false } = {}) {
            if (!append) {
                state.loading = true;
                state.error = null;
                state.page = 1;
                renderChrome();
            }
            try {
                const data = await fetchMedia({
                    path: state.search ? '' : state.path,
                    search: state.search,
                    page: state.page,
                });
                if (state.search) {
                    state.folders = [];
                    state.items = append ? state.items.concat(data.items) : data.items;
                } else {
                    state.folders = data.folders;
                    state.items = append ? state.items.concat(data.items) : data.items;
                    setTreeNode(state.path, data.folders, true);
                    await ensureTreePath(state.path);
                }
                state.hasMore = data.hasMore;
                if (state.selectedPath) {
                    state.selectedItem =
                        state.items.find((i) => itemRelativePath(i) === state.selectedPath) ||
                        state.selectedItem;
                }
            } catch (e) {
                state.error = e.message || String(e);
                if (e.status === 403) {
                    state.canWrite = false;
                }
                if (!append) {
                    state.folders = [];
                    state.items = [];
                }
            } finally {
                state.loading = false;
                renderAll();
                if (state.selectedPath && state.selectedItem) {
                    loadDetails(state.selectedPath);
                }
            }
        }

        async function loadTreeNode(path) {
            try {
                const data = await fetchMedia({ path, page: 1 });
                setTreeNode(path, data.folders, true);
                renderTree();
            } catch (e) {
                state.status = e.message || String(e);
                renderFooter();
            }
        }

        async function loadDetails(rel) {
            const gen = ++state.metaGen;
            state.metaFields = [];
            renderDetails();
            try {
                const meta = await fetchMeta(rel);
                if (gen !== state.metaGen || state.selectedPath !== rel) {
                    return;
                }
                state.metaFields = Array.isArray(meta.fields) ? meta.fields : [];
                const altField = state.metaFields.find((f) => f.key === 'alt');
                if (altField && options.alt && !altField.value) {
                    altField.value = options.alt;
                }
            } catch {
                if (gen !== state.metaGen) return;
                state.metaFields = [
                    { key: 'alt', label: 'Alt text', type: 'text', value: options.alt || state.selectedItem?.alt || '' },
                ];
            }
            renderDetails();
        }

        function collectMetaFields() {
            const fields = {};
            if (!ui.details) return fields;
            ui.details.querySelectorAll('[data-bb-meta]').forEach((el) => {
                const key = el.getAttribute('data-bb-meta');
                if (!key) return;
                const type = el.getAttribute('data-bb-meta-type') || 'text';
                if (type === 'tags') {
                    fields[key] = String(el.value || '')
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean);
                } else {
                    fields[key] = el.value || '';
                }
            });
            return fields;
        }

        function altFromFields(fields) {
            if (fields.alt !== undefined) return String(fields.alt || '').trim();
            return String(state.selectedItem?.alt || options.alt || '').trim();
        }

        async function saveMetaQuiet() {
            if (!state.selectedPath || !state.canWrite) return;
            const fields = collectMetaFields();
            if (!Object.keys(fields).length) return;
            try {
                await patchMeta(state.selectedPath, fields);
                if (state.selectedItem && fields.alt !== undefined) {
                    state.selectedItem.alt = fields.alt;
                }
            } catch (e) {
                console.warn('[BadgerMediaPicker] Failed to save meta', e);
            }
        }

        async function handleWrite(fn) {
            if (!state.canWrite || state.busy) return;
            state.busy = true;
            state.status = '';
            state.error = null;
            renderFooter();
            try {
                await fn();
            } catch (e) {
                if (e.status === 403) {
                    state.canWrite = false;
                }
                state.error = e.message || String(e);
            } finally {
                state.busy = false;
                renderFooter();
            }
        }

        function askConfirm({ title, message, confirmLabel, destructive }) {
            return new Promise((resolve) => {
                if (state.confirm) {
                    const prev = state.confirm;
                    state.confirm = null;
                    prev.resolve(false);
                }
                state.confirm = {
                    title,
                    message,
                    confirmLabel: confirmLabel || 'Confirm',
                    destructive: Boolean(destructive),
                    resolve,
                };
                renderConfirm();
            });
        }

        function finishConfirm(ok) {
            const c = state.confirm;
            state.confirm = null;
            renderConfirm();
            if (c) c.resolve(ok);
        }

        function confirmEventEl(e) {
            const t = e.target;
            if (t && t.nodeType === 1) return t;
            return t && t.parentElement ? t.parentElement : null;
        }

        function onConfirmPointer(e) {
            if (!state.confirm || !ui.confirm || ui.confirm.hidden) return;
            const el = confirmEventEl(e);
            if (!el) return;
            const yes = el.closest('[data-bb-confirm-yes]');
            const no = el.closest('[data-bb-confirm-no]');
            const onLayer = el === ui.confirm || ui.confirm.contains(el);
            if (!onLayer) return;
            if (yes) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                finishConfirm(true);
                return;
            }
            if (no || el === ui.confirm) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                finishConfirm(false);
            }
        }

        async function insertSelected() {
            if (!state.selectedPath) return;
            const fields = collectMetaFields();
            const alt = altFromFields(fields);
            if (state.canWrite) {
                try {
                    await saveMetaQuiet();
                } catch {
                    // non-fatal
                }
            }
            const item = state.selectedItem;
            const filename = item?.filename || basename(state.selectedPath);
            const portableUrl = toPortableUrl(
                item?.url || `${MEDIA_PREFIX}${state.selectedPath}`,
            );
            closePicker(true);
            if (typeof options.onInsert === 'function') {
                options.onInsert({
                    path: state.selectedPath,
                    url: portableUrl,
                    alt,
                    filename,
                });
            }
        }

        function selectItem(rel, item) {
            state.selectedPath = rel;
            state.selectedItem = item || state.items.find((i) => itemRelativePath(i) === rel) || null;
            renderGrid();
            loadDetails(rel);
            renderFooter();
        }

        async function navigateTo(path) {
            state.path = path || '';
            state.search = '';
            if (ui.search) ui.search.value = '';
            state.selectedPath = null;
            state.selectedItem = null;
            state.metaFields = [];
            await refresh();
        }

        async function uploadList(files, folderPath) {
            const list = Array.from(files || []).filter(isImageFile);
            if (!list.length) {
                state.status = 'Drop image files to upload.';
                renderFooter();
                return;
            }
            if (state.uploadLock) return;
            state.uploadLock = true;
            try {
            const prepared = [];
            for (const file of list) {
                let inspect = null;
                if (!isSvgFile(file)) {
                    try {
                        inspect = await inspectImage(file);
                    } catch {
                        inspect = null;
                    }
                }
                const over = Boolean(
                    inspect && Math.max(inspect.width, inspect.height) > MAX_UPLOAD_EDGE,
                );
                if (inspect) inspect.close();
                prepared.push({ file, over });
            }

            const toUpload = [];
            for (const item of prepared) {
                if (item.over) {
                    state.status = `Resizing “${item.file.name}” to ${MAX_UPLOAD_EDGE}px…`;
                    renderFooter();
                    try {
                        const smaller = await downscaleImageFile(item.file);
                        if (smaller === item.file) {
                            throw new Error('Could not resize image');
                        }
                        toUpload.push({ file: smaller, resized: true });
                    } catch (e) {
                        state.error = `Could not resize “${item.file.name}”: ${e.message || e}`;
                        renderFooter();
                    }
                } else {
                    toUpload.push({ file: item.file, resized: false });
                }
            }

            if (closed) return;
            if (!toUpload.length) return;

            await handleWrite(async () => {
                if (closed) return;
                state.status = `Uploading ${toUpload.length} file${toUpload.length === 1 ? '' : 's'}…`;
                renderFooter();
                let lastRel = null;
                for (const item of toUpload) {
                    let file = item.file;
                    try {
                        const json = await uploadFile(file, folderPath);
                        const created = Array.isArray(json.data) ? json.data[0] : json.data;
                        if (created) {
                            lastRel = itemRelativePath(created);
                        }
                    } catch (e) {
                        if (isUploadLimitError(e)) {
                            state.status = `Resizing “${file.name}” and retrying…`;
                            renderFooter();
                            const smaller = await downscaleImageFile(file, null, { force: true });
                            if (smaller === file) {
                                throw e;
                            }
                            const json = await uploadFile(smaller, folderPath);
                            const created = Array.isArray(json.data) ? json.data[0] : json.data;
                            if (created) {
                                lastRel = itemRelativePath(created);
                            }
                            continue;
                        }
                        throw e;
                    }
                }
                state.search = '';
                if (ui.search) ui.search.value = '';
                if (folderPath !== undefined && folderPath !== state.path) {
                    state.path = folderPath || '';
                }
                await refresh();
                if (lastRel) {
                    const found = state.items.find((i) => itemRelativePath(i) === lastRel);
                    if (found) selectItem(lastRel, found);
                }
                state.status = '';
            });
            } finally {
                state.uploadLock = false;
            }
        }

        function uniqueEditedName(origName, mime, preferred) {
            const ext = extFromMime(mime, origName);
            const stem = String(origName || 'image').replace(/\.[^.]+$/, '') || 'image';
            const existing = new Set(
                (state.items || []).map((i) => String(i.filename || '').toLowerCase()),
            );
            const available = (name) => {
                const n = String(name || '').trim();
                if (!n) return false;
                if (n.toLowerCase() === String(origName || '').toLowerCase()) return false;
                return !existing.has(n.toLowerCase());
            };
            if (available(preferred)) return preferred;
            const first = `${stem}-edited.${ext}`;
            if (available(first)) return first;
            let i = 2;
            while (!available(`${stem}-edited-${i}.${ext}`)) {
                i += 1;
            }
            return `${stem}-edited-${i}.${ext}`;
        }

        function createdRelativePath(json, folder, name) {
            const created = Array.isArray(json?.data) ? json.data[0] : json?.data;
            if (created) return itemRelativePath(created);
            return joinPath(folder, name);
        }

        async function persistEdited(imageData, replace) {
            if (!state.canWrite) {
                throw new Error('You do not have permission to save images.');
            }
            if (state.busy) {
                throw new Error('Another file operation is in progress.');
            }
            const origPath = state.selectedPath;
            const origName = state.selectedItem?.filename || basename(origPath);
            const folder = dirname(origPath);
            const mime = imageData?.mimeType || 'image/png';
            const stem = String(origName || 'image').replace(/\.[^.]+$/, '') || 'image';
            const preferred = imageData?.fullName
                || (imageData?.name && imageData?.extension
                    ? `${imageData.name}.${imageData.extension}`
                    : '');
            const name = replace
                ? uniqueEditedName(origName, mime)
                : uniqueEditedName(origName, mime, preferred);

            state.busy = true;
            state.status = replace ? 'Replacing image…' : 'Saving edited image…';
            state.error = null;
            renderFooter();
            try {
                const file = await imageDataToFile(imageData, name);
                const json = await uploadFile(file, folder);
                let rel = createdRelativePath(json, folder, name);

                if (replace && origPath && rel !== origPath) {
                    try {
                        const finalExt = extFromMime(mime, name);
                        const finalPath = joinPath(folder, `${stem}.${finalExt}`);
                        await apiJson('DELETE', `/media/${encodeMediaPath(origPath)}`);
                        if (rel !== finalPath) {
                            await apiJson('POST', '/media/rename', { from: rel, to: finalPath });
                            rel = finalPath;
                        }
                    } catch (e) {
                        state.status = 'Saved a new file; could not replace the original.';
                    }
                }

                closeEditor();
                await refresh();
                const item = state.items.find((i) => itemRelativePath(i) === rel);
                if (item) {
                    selectItem(rel, item);
                } else {
                    state.selectedPath = rel;
                    state.selectedItem = null;
                }
                if (!state.status || state.status.startsWith('Saving') || state.status.startsWith('Replacing')) {
                    state.status = replace && rel === origPath
                        ? 'Replaced original.'
                        : 'Saved as a new file.';
                }
            } catch (e) {
                if (e.status === 403) {
                    state.canWrite = false;
                }
                state.error = e.message || String(e);
                throw e;
            } finally {
                state.busy = false;
                renderFooter();
            }
        }

        async function openEditor() {
            const item = state.selectedItem;
            if (!state.canWrite || !item || isSvgItem(item) || editorIsOpen()) {
                return;
            }
            const src = fullPreviewUrl(item);
            if (!src) {
                state.error = 'This image has no preview URL to edit.';
                renderFooter();
                return;
            }
            const gen = editorGen + 1;
            editorGen = gen;
            if (ui.editor) ui.editor.hidden = false;
            if (ui.editorStage) {
                ui.editorStage.innerHTML = '<p class="bb-media-picker-muted">Loading editor…</p>';
            }
            try {
                const Filerobot = await loadFilerobot();
                if (closed || gen !== editorGen || !ui.editorStage) {
                    return;
                }
                ui.editorStage.replaceChildren();
                await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                if (closed || gen !== editorGen || !ui.editorStage) {
                    return;
                }
                const TABS = Filerobot.TABS || {};
                const TOOLS = Filerobot.TOOLS || {};
                const tabsIds = [TABS.ADJUST || 'Adjust', TABS.RESIZE || 'Resize'];
                const origName = item.filename || basename(state.selectedPath);
                const stem = String(origName).replace(/\.[^.]+$/, '') || 'image';
                editorInstance = new Filerobot(ui.editorStage, {
                    source: src,
                    defaultSavedImageName: `${stem}-edited`,
                    defaultSavedImageType: 'webp',
                    tabsIds,
                    defaultTabId: TABS.ADJUST || 'Adjust',
                    defaultToolId: TOOLS.CROP || 'Crop',
                    useBackendTranslations: false,
                    closeAfterSave: false,
                    avoidChangesNotSavedAlertOnLeave: true,
                    observePluginContainerSize: true,
                    Crop: {
                        ratio: 'custom',
                        ratioTitleKey: 'custom',
                        noPresets: false,
                        presetsItems: [
                            { titleKey: 'custom', descriptionKey: 'custom', ratio: 'custom' },
                            { titleKey: 'original', descriptionKey: 'original', ratio: 'original' },
                            { titleKey: 'square', descriptionKey: '1:1', ratio: 1 },
                            { titleKey: 'classicTv', descriptionKey: '4:3', ratio: 4 / 3 },
                            { titleKey: 'landscape', descriptionKey: '16:9', ratio: 16 / 9 },
                            { titleKey: 'portrait', descriptionKey: '9:16', ratio: 9 / 16 },
                        ],
                    },
                    onSave: (imageData) => persistEdited(imageData, false),
                    moreSaveOptions: [
                        {
                            label: 'Replace original',
                            onClick: (triggerSaveModal) => {
                                askConfirm({
                                    title: 'Replace original?',
                                    message: `Overwrite “${origName}” with this edit? This cannot be undone.`,
                                    confirmLabel: 'Replace',
                                    destructive: true,
                                }).then((ok) => {
                                    if (!ok) return;
                                    triggerSaveModal((imageData) => persistEdited(imageData, true));
                                });
                            },
                        },
                    ],
                });
                editorInstance.render({
                    onClose: () => closeEditor(),
                    observePluginContainerSize: true,
                });
            } catch (e) {
                if (gen === editorGen) {
                    closeEditor();
                    state.error = e.message || String(e);
                    renderFooter();
                }
            }
        }

        function onDocKey(e) {
            if (closed) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (state.confirm) {
                    finishConfirm(false);
                    return;
                }
                if (editorIsOpen()) {
                    closeEditor();
                    return;
                }
                closePicker(false);
                return;
            }
            if (e.key === 'Enter' && e.target === ui.search) {
                e.preventDefault();
                state.search = (ui.search.value || '').trim();
                refresh();
            }
        }

        function highlightDrop(path) {
            state.dropPath = path;
            ui.wrap.querySelectorAll('.is-drop').forEach((el) => el.classList.remove('is-drop'));
            if (path === null) {
                return;
            }
            const attr = CSS.escape ? CSS.escape(path) : path.replace(/"/g, '\\"');
            ui.wrap.querySelectorAll(`[data-bb-drop-folder="${attr}"]`).forEach((el) => {
                el.classList.add('is-drop');
                el.closest('.bb-media-picker-tree-item')?.classList.add('is-drop');
            });
            if (path === (state.path || '')) {
                ui.grid.classList.add('is-drop');
            }
        }

        function dropDestFromEvent(e, fallback) {
            const row = e.target.closest('[data-bb-drop-folder]');
            if (row) {
                return row.getAttribute('data-bb-drop-folder') || '';
            }
            return fallback;
        }

        function isDnD(e) {
            const types = Array.from(e.dataTransfer?.types || []);
            return types.includes('Files') || types.includes(DRAG_TYPE) || Boolean(state.draggingPath);
        }

        async function handleDrop(e, fallbackPath) {
            if (!state.canWrite) return;
            const files = e.dataTransfer?.files?.length ? Array.from(e.dataTransfer.files) : [];
            const movePath = e.dataTransfer?.getData(DRAG_TYPE) || state.draggingPath;
            if (!files.length && !movePath) return;
            e.preventDefault();
            e.stopPropagation();
            const dest = dropDestFromEvent(e, fallbackPath);
            highlightDrop(null);
            if (movePath) {
                const destPath = joinPath(dest, basename(movePath));
                if (movePath === destPath || dirname(movePath) === (dest || '')) {
                    return;
                }
                await handleWrite(async () => {
                    await apiJson('POST', '/media/rename', { from: movePath, to: destPath });
                    if (state.selectedPath === movePath) {
                        state.selectedPath = destPath;
                    }
                    if (dest !== state.path) {
                        state.path = dest || '';
                    }
                    await refresh();
                });
                return;
            }
            await uploadList(files, dest);
        }

        function wireContainerDnd(el, fallbackPathFn) {
            el.addEventListener('dragover', (e) => {
                if (!state.canWrite || !isDnD(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const types = Array.from(e.dataTransfer.types || []);
                e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) ? 'move' : 'copy';
                highlightDrop(dropDestFromEvent(e, fallbackPathFn()));
            });
            el.addEventListener('dragleave', (e) => {
                if (el.contains(e.relatedTarget)) return;
                highlightDrop(null);
            });
            el.addEventListener('drop', (e) => handleDrop(e, fallbackPathFn()));
        }

        function renderTreeNodes(parentPath) {
            const node = state.tree[parentPath || ''];
            if (!node || !node.expanded) return '';
            return (node.folders || []).map((f) => {
                const fp = f.path || f.name || '';
                const child = state.tree[fp];
                const expanded = Boolean(child?.expanded);
                const hasChildren =
                    Number(f.children_count) > 0 || (child?.folders && child.folders.length > 0);
                const current = (state.path || '') === fp;
                const drop = state.dropPath === fp;
                const cls = [
                    'bb-media-picker-tree-item',
                    current ? 'is-current' : '',
                    drop ? 'is-drop' : '',
                ].filter(Boolean).join(' ');
                const toggle = hasChildren
                    ? `<button type="button" class="bb-media-picker-tree-toggle${expanded ? ' is-open' : ''}" data-bb-tree-toggle="${escapeHtml(fp)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="Toggle folder"><span></span></button>`
                    : '<span class="bb-media-picker-tree-spacer"></span>';
                return (
                    `<div class="${cls}">` +
                    `<div class="bb-media-picker-tree-row" data-bb-drop-folder="${escapeHtml(fp)}">` +
                    toggle +
                    `<button type="button" class="bb-media-picker-tree-label" data-bb-folder="${escapeHtml(fp)}">` +
                    `${folderIcon()}<span>${escapeHtml(f.name || fp)}</span></button>` +
                `</div>` +
                (expanded ? renderTreeNodes(fp) : '') +
                `</div>`
                );
            }).join('');
        }

        function renderTree() {
            if (!ui.tree) return;
            const rootDrop = state.dropPath === '';
            const rootCurrent = !state.path;
            ui.tree.innerHTML =
                `<div class="bb-media-picker-tree-item${rootCurrent ? ' is-current' : ''}${rootDrop ? ' is-drop' : ''}">` +
                `<div class="bb-media-picker-tree-row" data-bb-drop-folder="">` +
                `<span class="bb-media-picker-tree-spacer"></span>` +
                `<button type="button" class="bb-media-picker-tree-label" data-bb-folder="">` +
                `${folderIcon()}<span>Site media</span></button>` +
                `</div>` +
                renderTreeNodes('') +
                `</div>`;
        }

        function renderBreadcrumb() {
            if (!ui.crumb) return;
            const parts = ['<button type="button" class="bb-media-picker-crumb" data-bb-folder="">Site media</button>'];
            if (state.path) {
                const segs = state.path.split('/').filter(Boolean);
                let acc = '';
                segs.forEach((seg, i) => {
                    acc = acc ? `${acc}/${seg}` : seg;
                    parts.push('<span class="bb-media-picker-crumb-sep">/</span>');
                    if (i < segs.length - 1) {
                        parts.push(
                            `<button type="button" class="bb-media-picker-crumb" data-bb-folder="${escapeHtml(acc)}">${escapeHtml(seg)}</button>`,
                        );
                    } else {
                        parts.push(`<span class="bb-media-picker-crumb-current">${escapeHtml(seg)}</span>`);
                    }
                });
            }
            ui.crumb.innerHTML = parts.join('');
        }

        function renderGrid() {
            if (!ui.grid) return;
            const droppingHere = state.dropPath === (state.path || '') && state.dropPath !== null;
            ui.grid.classList.toggle('is-drop', droppingHere);

            if (state.loading && !state.items.length && !state.folders.length) {
                ui.grid.innerHTML = '<p class="bb-media-picker-muted">Loading…</p>';
                return;
            }
            if (state.error && !state.items.length && !state.folders.length) {
                ui.grid.innerHTML = `<p class="bb-media-picker-error">${escapeHtml(state.error)}</p>`;
                return;
            }

            const cards = [];
            if (!state.search) {
                state.folders.forEach((f) => {
                    const fp = f.path || f.name || '';
                    const drop = state.dropPath === fp;
                    cards.push(
                        `<button type="button" class="bb-media-picker-card bb-media-picker-card-folder${drop ? ' is-drop' : ''}" data-bb-folder="${escapeHtml(fp)}" data-bb-drop-folder="${escapeHtml(fp)}">` +
                        `<span class="bb-media-picker-card-thumb">${folderIcon()}</span>` +
                        `<span class="bb-media-picker-card-name">${escapeHtml(f.name || fp)}</span>` +
                        `<span class="bb-media-picker-card-meta">${Number(f.file_count) || 0} files</span>` +
                        `</button>`,
                    );
                });
            }
            state.items.forEach((item) => {
                const rel = itemRelativePath(item);
                const src = previewUrl(item);
                const selected = state.selectedPath === rel;
                cards.push(
                    `<button type="button" class="bb-media-picker-card${selected ? ' is-selected' : ''}" data-bb-item="${escapeHtml(rel)}" draggable="${state.canWrite ? 'true' : 'false'}" title="${escapeHtml(item.filename)}">` +
                    (src
                        ? `<img class="bb-media-picker-card-img" src="${escapeHtml(src)}" alt="" loading="lazy" />`
                        : `<span class="bb-media-picker-card-thumb">${escapeHtml(item.filename)}</span>`) +
                    `<span class="bb-media-picker-card-name">${escapeHtml(item.filename)}</span>` +
                    `</button>`,
                );
            });

            if (!cards.length) {
                const hint = state.canWrite
                    ? 'No images in this folder. Drop files here to upload.'
                    : 'No images in this folder.';
                ui.grid.innerHTML = `<p class="bb-media-picker-muted">${hint}</p>`;
            } else {
                ui.grid.innerHTML =
                    `<div class="bb-media-picker-cards">${cards.join('')}</div>` +
                    (state.hasMore
                        ? '<button type="button" class="bb-media-picker-btn" data-bb-more>Load more</button>'
                        : '');
            }

            ui.grid.querySelectorAll('[data-bb-item][draggable="true"]').forEach((card) => {
                card.addEventListener('dragstart', (e) => {
                    const rel = card.getAttribute('data-bb-item') || '';
                    state.draggingPath = rel;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData(DRAG_TYPE, rel);
                    e.dataTransfer.setData('text/plain', rel);
                });
                card.addEventListener('dragend', () => {
                    state.draggingPath = null;
                    highlightDrop(null);
                });
            });
        }

        function renderDetails() {
            if (!ui.details) return;
            const item = state.selectedItem;
            if (!state.selectedPath || !item) {
                ui.details.innerHTML =
                    '<p class="bb-media-picker-muted">Select an image to see details</p>';
                return;
            }
            const src = fullPreviewUrl(item);
            const dims = item.dimensions
                ? `${item.dimensions.width} × ${item.dimensions.height}`
                : '';
            const fields = state.metaFields.map((f) => {
                const raw = f.type === 'tags'
                    ? (Array.isArray(f.value) ? f.value.join(', ') : '')
                    : (f.value ?? '');
                if (f.type === 'textarea') {
                    return (
                        `<label class="bb-media-picker-field">` +
                        `<span>${escapeHtml(f.label || f.key)}</span>` +
                        `<textarea data-bb-meta="${escapeHtml(f.key)}" data-bb-meta-type="textarea" rows="2">${escapeHtml(raw)}</textarea>` +
                        `</label>`
                    );
                }
                return (
                    `<label class="bb-media-picker-field">` +
                    `<span>${escapeHtml(f.label || f.key)}</span>` +
                    `<input type="text" data-bb-meta="${escapeHtml(f.key)}" data-bb-meta-type="${escapeHtml(f.type || 'text')}" value="${escapeHtml(raw)}" />` +
                    `</label>`
                );
            }).join('');

            const writeBtns = state.canWrite
                ? `<div class="bb-media-picker-details-actions">` +
                  (isSvgItem(item) ? '' : `<button type="button" class="bb-media-picker-btn" data-bb-edit>Edit</button>`) +
                  `<button type="button" class="bb-media-picker-btn" data-bb-rename>Rename</button>` +
                  `<button type="button" class="bb-media-picker-btn bb-media-picker-btn-danger" data-bb-delete-file>Delete</button>` +
                  `</div>`
                : '';

            ui.details.innerHTML =
                (src
                    ? `<img class="bb-media-picker-details-preview" src="${escapeHtml(src)}" alt="" />`
                    : '') +
                `<div class="bb-media-picker-details-name">${escapeHtml(item.filename)}</div>` +
                `<dl class="bb-media-picker-facts">` +
                `<div><dt>Type</dt><dd>${escapeHtml(item.type || '')}</dd></div>` +
                `<div><dt>Size</dt><dd>${escapeHtml(formatSize(item.size))}</dd></div>` +
                (dims ? `<div><dt>Dimensions</dt><dd>${escapeHtml(dims)}</dd></div>` : '') +
                (item.modified ? `<div><dt>Modified</dt><dd>${escapeHtml(formatModified(item.modified))}</dd></div>` : '') +
                `</dl>` +
                fields +
                writeBtns;
        }

        function renderChrome() {
            renderBreadcrumb();
            if (ui.upload) ui.upload.hidden = !state.canWrite;
            if (ui.newFolderBtn) ui.newFolderBtn.hidden = !state.canWrite || Boolean(state.search);
            if (ui.renameFolderBtn) {
                ui.renameFolderBtn.hidden = !state.canWrite || !state.path || Boolean(state.search);
            }
            if (ui.deleteFolderBtn) {
                ui.deleteFolderBtn.hidden = !state.canWrite || !state.path || Boolean(state.search);
            }
            if (ui.folderForm) {
                ui.folderForm.hidden = !state.newFolder && !state.renameFolder;
                if (ui.folderLabel) {
                    ui.folderLabel.textContent = state.renameFolder ? 'Rename folder' : 'New folder';
                }
                if (ui.folderInput && document.activeElement !== ui.folderInput) {
                    if (state.renameFolder) {
                        ui.folderInput.value = basename(state.path);
                    } else if (state.newFolder && !ui.folderInput.value) {
                        ui.folderInput.value = '';
                    }
                }
            }
        }

        function renderFooter() {
            if (ui.insert) {
                ui.insert.disabled = !state.selectedPath || state.busy;
            }
            const bits = [];
            if (state.busy) bits.push('Working…');
            if (state.status) bits.push(state.status);
            if (state.error) bits.push(state.error);
            if (ui.status) {
                ui.status.textContent = bits.join(' — ');
                ui.status.classList.toggle('is-error', Boolean(state.error));
            }
        }

        function renderConfirm() {
            if (!ui.confirm) return;
            if (!state.confirm) {
                ui.confirm.hidden = true;
                ui.confirm.innerHTML = '';
                if (ui.wrap) ui.wrap.style.pointerEvents = '';
                return;
            }
            const c = state.confirm;
            ui.confirm.hidden = false;
            if (ui.wrap) ui.wrap.style.pointerEvents = 'none';
            ui.confirm.innerHTML =
                `<div class="bb-media-picker-confirm-card">` +
                `<h3>${escapeHtml(c.title)}</h3>` +
                `<p>${escapeHtml(c.message)}</p>` +
                `<div class="bb-media-picker-confirm-actions">` +
                `<button type="button" class="bb-media-picker-btn" data-bb-confirm-no>Cancel</button>` +
                `<button type="button" class="bb-media-picker-btn ${c.destructive ? 'bb-media-picker-btn-danger' : 'bb-media-picker-btn-primary'}" data-bb-confirm-yes">${escapeHtml(c.confirmLabel)}</button>` +
                `</div></div>`;
            const yesBtn = ui.confirm.querySelector('[data-bb-confirm-yes]');
            const noBtn = ui.confirm.querySelector('[data-bb-confirm-no]');
            const bind = (btn, ok) => {
                if (!btn) return;
                const go = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finishConfirm(ok);
                };
                btn.addEventListener('pointerdown', go);
                btn.addEventListener('click', go);
            };
            bind(yesBtn, true);
            bind(noBtn, false);
        }

        function renderAll() {
            renderChrome();
            renderTree();
            renderGrid();
            renderDetails();
            renderFooter();
            renderConfirm();
        }

        function buildShell() {
            const wrap = document.createElement('div');
            wrap.id = `${DIALOG_ID}-wrap`;
            wrap.className = 'bb-media-picker-wrap';
            wrap.innerHTML =
                `<div class="bb-media-picker" id="${DIALOG_ID}" role="dialog" aria-modal="true" aria-labelledby="${DIALOG_ID}-title">` +
                `<header class="bb-media-picker-head">` +
                `<h2 id="${DIALOG_ID}-title">${escapeHtml(options.title || 'Select image')}</h2>` +
                `<button type="button" class="bb-media-picker-icon-btn" data-bb-close aria-label="Close">×</button>` +
                `</header>` +
                `<div class="bb-media-picker-body">` +
                `<aside class="bb-media-picker-tree" aria-label="Folders"></aside>` +
                `<section class="bb-media-picker-main">` +
                `<div class="bb-media-picker-toolbar">` +
                `<div class="bb-media-picker-crumbbar"></div>` +
                `<div class="bb-media-picker-tools">` +
                `<input type="search" class="bb-media-picker-search" placeholder="Search images" aria-label="Search images" />` +
                `<button type="button" class="bb-media-picker-btn" data-bb-search>Search</button>` +
                `<button type="button" class="bb-media-picker-btn bb-media-picker-btn-primary" data-bb-upload>Upload</button>` +
                `<button type="button" class="bb-media-picker-btn" data-bb-new-folder>New folder</button>` +
                `<button type="button" class="bb-media-picker-btn" data-bb-rename-folder>Rename folder</button>` +
                `<button type="button" class="bb-media-picker-btn bb-media-picker-btn-danger" data-bb-delete-folder>Delete folder</button>` +
                `</div>` +
                `<form class="bb-media-picker-folder-form" hidden>` +
                `<span class="bb-media-picker-folder-label">New folder</span>` +
                `<input type="text" class="bb-media-picker-folder-input" maxlength="80" />` +
                `<button type="submit" class="bb-media-picker-btn bb-media-picker-btn-primary">Save</button>` +
                `<button type="button" class="bb-media-picker-btn" data-bb-folder-cancel>Cancel</button>` +
                `</form>` +
                `</div>` +
                `<div class="bb-media-picker-grid" tabindex="0"></div>` +
                `</section>` +
                `<aside class="bb-media-picker-details" aria-label="Image details"></aside>` +
                `</div>` +
                `<footer class="bb-media-picker-foot">` +
                `<p class="bb-media-picker-status"></p>` +
                `<div class="bb-media-picker-foot-actions">` +
                `<button type="button" class="bb-media-picker-btn" data-bb-cancel>Cancel</button>` +
                `<button type="button" class="bb-media-picker-btn bb-media-picker-btn-primary" data-bb-insert disabled>Insert</button>` +
                `</div>` +
                `</footer>` +
                `<input type="file" class="bb-media-picker-file" accept="image/*" multiple hidden />` +
                `<div class="bb-media-picker-editor" hidden>` +
                `<div class="bb-media-picker-editor-stage"></div>` +
                `</div>` +
                `</div>`;

            ui.wrap = wrap;
            ui.dialog = wrap.querySelector('.bb-media-picker');
            ui.tree = wrap.querySelector('.bb-media-picker-tree');
            ui.grid = wrap.querySelector('.bb-media-picker-grid');
            ui.details = wrap.querySelector('.bb-media-picker-details');
            ui.crumb = wrap.querySelector('.bb-media-picker-crumbbar');
            ui.search = wrap.querySelector('.bb-media-picker-search');
            ui.upload = wrap.querySelector('[data-bb-upload]');
            ui.newFolderBtn = wrap.querySelector('[data-bb-new-folder]');
            ui.renameFolderBtn = wrap.querySelector('[data-bb-rename-folder]');
            ui.deleteFolderBtn = wrap.querySelector('[data-bb-delete-folder]');
            ui.folderForm = wrap.querySelector('.bb-media-picker-folder-form');
            ui.folderLabel = wrap.querySelector('.bb-media-picker-folder-label');
            ui.folderInput = wrap.querySelector('.bb-media-picker-folder-input');
            ui.status = wrap.querySelector('.bb-media-picker-status');
            ui.insert = wrap.querySelector('[data-bb-insert]');
            ui.file = wrap.querySelector('.bb-media-picker-file');
            ui.editor = wrap.querySelector('.bb-media-picker-editor');
            ui.editorStage = wrap.querySelector('.bb-media-picker-editor-stage');
            const confirm = document.createElement('div');
            confirm.className = 'bb-media-picker-confirm';
            confirm.hidden = true;
            document.body.appendChild(confirm);
            ui.confirm = confirm;
            window.addEventListener('pointerdown', onConfirmPointer, true);
            window.addEventListener('click', onConfirmPointer, true);

            wrap.addEventListener('click', (e) => {
                if (e.target === wrap) closePicker(false);
            });
            wrap.addEventListener('dragover', (e) => {
                if (isDnD(e) || e.dataTransfer?.files?.length) e.preventDefault();
            });
            wrap.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.target === wrap) return;
                handleDrop(e, state.path || '');
            });
            ui.dialog.addEventListener('click', (e) => {
                const t = e.target.closest('[data-bb-close], [data-bb-cancel], [data-bb-insert], [data-bb-search], [data-bb-upload], [data-bb-new-folder], [data-bb-rename-folder], [data-bb-delete-folder], [data-bb-folder-cancel], [data-bb-folder], [data-bb-tree-toggle], [data-bb-item], [data-bb-more], [data-bb-edit], [data-bb-rename], [data-bb-delete-file], [data-bb-confirm-yes], [data-bb-confirm-no]');
                if (!t) return;

                if (t.hasAttribute('data-bb-close') || t.hasAttribute('data-bb-cancel')) {
                    closePicker(false);
                    return;
                }
                if (t.hasAttribute('data-bb-insert')) {
                    insertSelected();
                    return;
                }
                if (t.hasAttribute('data-bb-search')) {
                    state.search = (ui.search.value || '').trim();
                    refresh();
                    return;
                }
                if (t.hasAttribute('data-bb-upload')) {
                    ui.file.click();
                    return;
                }
                if (t.hasAttribute('data-bb-new-folder')) {
                    state.newFolder = true;
                    state.renameFolder = false;
                    renderChrome();
                    ui.folderInput.value = '';
                    ui.folderInput.focus();
                    return;
                }
                if (t.hasAttribute('data-bb-rename-folder')) {
                    state.renameFolder = true;
                    state.newFolder = false;
                    renderChrome();
                    ui.folderInput.value = basename(state.path);
                    ui.folderInput.focus();
                    ui.folderInput.select();
                    return;
                }
                if (t.hasAttribute('data-bb-folder-cancel')) {
                    state.newFolder = false;
                    state.renameFolder = false;
                    renderChrome();
                    return;
                }
                if (t.hasAttribute('data-bb-delete-folder')) {
                    askConfirm({
                        title: 'Delete folder?',
                        message: `Delete empty folder “${basename(state.path)}”?`,
                        confirmLabel: 'Delete',
                        destructive: true,
                    }).then((ok) => {
                        if (!ok) return;
                        handleWrite(async () => {
                            await apiJson('DELETE', `/media/folders/${encodeMediaPath(state.path)}`);
                            await navigateTo(dirname(state.path));
                        });
                    });
                    return;
                }
                if (t.hasAttribute('data-bb-tree-toggle')) {
                    e.preventDefault();
                    const fp = t.getAttribute('data-bb-tree-toggle') || '';
                    const node = state.tree[fp];
                    if (node?.expanded) {
                        node.expanded = false;
                        renderTree();
                        return;
                    }
                    if (node?.loaded) {
                        node.expanded = true;
                        renderTree();
                        return;
                    }
                    loadTreeNode(fp);
                    return;
                }
                if (t.hasAttribute('data-bb-folder')) {
                    e.preventDefault();
                    navigateTo(t.getAttribute('data-bb-folder') || '');
                    return;
                }
                if (t.hasAttribute('data-bb-item')) {
                    e.preventDefault();
                    const rel = t.getAttribute('data-bb-item') || '';
                    selectItem(rel);
                    return;
                }
                if (t.hasAttribute('data-bb-more')) {
                    state.page += 1;
                    refresh({ append: true });
                    return;
                }
                if (t.hasAttribute('data-bb-edit')) {
                    openEditor();
                    return;
                }
                if (t.hasAttribute('data-bb-rename')) {
                    const nameInput = document.createElement('input');
                    nameInput.type = 'text';
                    nameInput.className = 'bb-media-picker-inline-rename';
                    nameInput.value = state.selectedItem?.filename || basename(state.selectedPath);
                    const existing = ui.details.querySelector('.bb-media-picker-details-name');
                    if (existing) {
                        existing.replaceWith(nameInput);
                        nameInput.focus();
                        nameInput.select();
                        const commit = () => {
                            const nextName = (nameInput.value || '').trim();
                            nameInput.removeEventListener('blur', commit);
                            if (!nextName || nextName === (state.selectedItem?.filename || '')) {
                                renderDetails();
                                return;
                            }
                            const to = joinPath(dirname(state.selectedPath), nextName);
                            handleWrite(async () => {
                                await saveMetaQuiet();
                                await apiJson('POST', '/media/rename', {
                                    from: state.selectedPath,
                                    to,
                                });
                                state.selectedPath = to;
                                await refresh();
                            });
                        };
                        nameInput.addEventListener('blur', commit);
                        nameInput.addEventListener('keydown', (ev) => {
                            if (ev.key === 'Enter') {
                                ev.preventDefault();
                                nameInput.blur();
                            }
                            if (ev.key === 'Escape') {
                                ev.preventDefault();
                                nameInput.removeEventListener('blur', commit);
                                renderDetails();
                            }
                        });
                    }
                    return;
                }
                if (t.hasAttribute('data-bb-delete-file')) {
                    const name = state.selectedItem?.filename || basename(state.selectedPath);
                    askConfirm({
                        title: 'Delete image?',
                        message: `Delete “${name}”? This cannot be undone.`,
                        confirmLabel: 'Delete',
                        destructive: true,
                    }).then((ok) => {
                        if (!ok) return;
                        handleWrite(async () => {
                            await apiJson('DELETE', `/media/${encodeMediaPath(state.selectedPath)}`);
                            state.selectedPath = null;
                            state.selectedItem = null;
                            state.metaFields = [];
                            await refresh();
                        });
                    });
                    return;
                }
                if (t.hasAttribute('data-bb-confirm-yes')) {
                    finishConfirm(true);
                    return;
                }
                if (t.hasAttribute('data-bb-confirm-no')) {
                    finishConfirm(false);
                }
            });

            ui.dialog.addEventListener('dblclick', (e) => {
                const item = e.target.closest('[data-bb-item]');
                if (!item) return;
                e.preventDefault();
                const rel = item.getAttribute('data-bb-item') || '';
                selectItem(rel);
                insertSelected();
            });

            ui.folderForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = (ui.folderInput.value || '').trim().replace(/^\/+|\/+$/g, '');
                if (!name) return;
                const target = joinPath(state.path, name);
                const renaming = state.renameFolder;
                state.newFolder = false;
                state.renameFolder = false;
                handleWrite(async () => {
                    if (renaming) {
                        await apiJson('POST', '/media/folders/rename', {
                            from: state.path,
                            to: target,
                        });
                        await navigateTo(target);
                    } else {
                        await apiJson('POST', '/media/folders', { path: target });
                        await refresh();
                    }
                });
            });

            ui.file.addEventListener('change', async () => {
                const files = ui.file.files;
                ui.file.value = '';
                if (!files || !files.length) return;
                await uploadList(files, state.path);
            });

            ui.details.addEventListener('blur', (e) => {
                if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-bb-meta')) {
                    saveMetaQuiet();
                }
            }, true);

            wireContainerDnd(ui.tree, () => '');
            wireContainerDnd(ui.grid, () => state.path || '');
            renderChrome();

            document.body.appendChild(wrap);
            document.body.classList.add('bb-media-picker-open');
            document.addEventListener('keydown', onDocKey, true);
            ui.search.focus();
        }

        buildShell();
        await refresh();
    }

    global.BadgerMediaPicker = {
        open,
        toPortableUrl,
        encodePathname,
        itemRelativePath,
        MEDIA_PREFIX,
        DIALOG_ID,
    };
})(typeof window !== 'undefined' ? window : globalThis);
