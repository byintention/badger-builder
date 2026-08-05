/**
 * BadgerMediaPicker — site media browser using TinyMCE windowManager (tox skin).
 * No custom modal CSS. Loads site library via GET/POST /api/v1/media.
 */
(function (global) {
    'use strict';

    const MEDIA_PREFIX = '/user/media/';
    const DIALOG_ID = 'bb-media-picker';

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

    /**
     * TinyMCE dialogs have no public id/class option — stamp one for CSS hooks.
     * Re-apply after redial (DOM is rebuilt).
     */
    function markDialogDom() {
        const dialogs = document.querySelectorAll('.tox-dialog');
        const dialog = dialogs.length ? dialogs[dialogs.length - 1] : null;
        if (!dialog) {
            return;
        }
        dialog.id = DIALOG_ID;
        dialog.classList.add('bb-media-picker');
        const wrap = dialog.closest('.tox-dialog-wrap');
        if (wrap) {
            wrap.id = `${DIALOG_ID}-wrap`;
            wrap.classList.add('bb-media-picker-wrap');
        }
    }

    function scheduleMarkDialogDom() {
        requestAnimationFrame(() => {
            markDialogDom();
            // redial can paint a frame later
            requestAnimationFrame(markDialogDom);
        });
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Relative path under user/media (folder/file or file). */
    function itemRelativePath(item) {
        const folder = String(item.path || '').replace(/^\/+|\/+$/g, '');
        const name = item.filename || '';
        return folder ? `${folder}/${name}` : name;
    }

    /** Root-relative portable URL (no hostname). */
    function toPortableUrl(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }
        try {
            if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
                const abs = url.startsWith('//') ? `${global.location.protocol}${url}` : url;
                return new URL(abs).pathname || '';
            }
        } catch {
            // fall through
        }
        if (url.startsWith('/')) {
            return url;
        }
        return `/${url.replace(/^\/+/, '')}`;
    }

    function previewUrl(item) {
        const thumb = item.thumbnail_url || item.url || '';
        if (!thumb) return '';
        if (/^https?:\/\//i.test(thumb) || thumb.startsWith('/')) {
            if (thumb.startsWith('/api/') || thumb.includes('/thumbnails/')) {
                return thumb.startsWith('http') ? thumb : `${apiBase()}${thumb}`;
            }
            return thumb.startsWith('http') ? thumb : `${apiBase()}${thumb}`;
        }
        return thumb;
    }

    async function fetchMedia({ path = '', search = '' } = {}) {
        const params = new URLSearchParams();
        params.set('type', 'image');
        params.set('per_page', '100');
        if (path) params.set('path', path);
        if (search) params.set('search', search);
        const resp = await fetch(`${apiPath('/media')}?${params}`, { headers: headers() });
        if (!resp.ok) {
            throw new Error(`Media HTTP ${resp.status}`);
        }
        const json = await resp.json();
        const items = Array.isArray(json.data) ? json.data : [];
        const meta = json.meta || {};
        return {
            items: items.filter((m) => String(m.type || '').startsWith('image/')),
            folders: Array.isArray(meta.folders) ? meta.folders : [],
            path: meta.path || path || '',
        };
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
            throw new Error(`Upload HTTP ${resp.status}`);
        }
        return resp.json();
    }

    async function patchAlt(relativePath, alt) {
        const resp = await fetch(
            `${apiPath('/media/meta')}?path=${encodeURIComponent(relativePath)}`,
            {
                method: 'PATCH',
                headers: headers(true),
                body: JSON.stringify({ fields: { alt } }),
            },
        );
        if (!resp.ok) {
            console.warn('[BadgerMediaPicker] Failed to save alt meta', resp.status);
        }
    }

    function buildBrowserHtml(state) {
        const parts = [];
        parts.push('<div style="min-height:280px;max-height:360px;overflow:auto;">');

        // Breadcrumb / up
        const crumbs = ['<div style="margin-bottom:10px">'];
        crumbs.push(
            `<button type="button" class="tox-button" data-bb-folder="" style="margin-right:6px;">Site media</button>`,
        );
        if (state.path) {
            const segs = state.path.split('/').filter(Boolean);
            let acc = '';
            segs.forEach((seg, i) => {
                acc = acc ? `${acc}/${seg}` : seg;
                crumbs.push('<span style="margin:0 4px;">/</span>');
                if (i < segs.length - 1) {
                    crumbs.push(
                        `<button type="button" class="tox-button" data-bb-folder="${escapeHtml(acc)}">${escapeHtml(seg)}</button>`,
                    );
                } else {
                    crumbs.push(`<strong>${escapeHtml(seg)}</strong>`);
                }
            });
        }
        crumbs.push('</div>');
        parts.push(crumbs.join(''));

        if (state.error) {
            parts.push(
                `<p style="color:#b91c1c;font-size:13px;">${escapeHtml(state.error)}</p>`,
            );
        } else if (state.loading) {
            parts.push('<p style="font-size:13px;">Loading…</p>');
        } else {
            if (state.folders.length) {
                parts.push('<div style="margin-bottom:10px;">');
                state.folders.forEach((f) => {
                    const fp = f.path || f.name || '';
                    parts.push(
                        `<button type="button" class="tox-button" data-bb-folder="${escapeHtml(fp)}" ` +
                            `style="display:inline-block;margin:0 6px 6px 0;">📁 ${escapeHtml(f.name || fp)}</button>`,
                    );
                });
                parts.push('</div>');
            }

            if (!state.items.length) {
                parts.push('<p style="font-size:13px;">No images in this folder.</p>');
            } else {
                parts.push(
                    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;background:#eee;padding:10px;">',
                );
                state.items.forEach((item) => {
                    const rel = itemRelativePath(item);
                    const src = previewUrl(item);
                    const selected = state.selectedPath === rel;
                    const border = selected ? '2px solid #2563eb' : '1px solid #cbd5e1';
                    parts.push(
                        `<button type="button" data-bb-item="${escapeHtml(rel)}" ` +
                            `title="${escapeHtml(item.filename)}" ` +
                            `style="padding:4px;border:${border};background:#fff;cursor:pointer;border-radius:4px;height:auto;flex-direction:column;">` +
                            (src
                                ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" ` +
                                  `style="width:100%;height:72px;object-fit:cover;display:block;" />`
                                : `<span style="font-size:11px;">${escapeHtml(item.filename)}</span>`) +
                            `<span style="display:block;font-size:10px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.filename)}</span>` +
                            `</button>`,
                    );
                });
                parts.push('</div>');
            }
        }

        parts.push('</div>');
        if (state.selectedPath) {
            parts.push(
                `<p style="margin-top:8px;font-size:12px;">Selected: <code>${escapeHtml(state.selectedPath)}</code></p>`,
            );
        }
        return parts.join('');
    }

    function dialogSpec(state, options) {
        return {
            title: options.title || 'Select image',
            size: 'large',
            body: {
                type: 'panel',
                items: [
                    {
                        type: 'grid',
                        columns: 3,
                        items: [
                            {
                                type: 'input',
                                name: 'search',
                                label: 'Search',
                                inputMode: 'search',
                            },
                            {
                                type: 'button',
                                name: 'do_search',
                                text: 'Search',
                                buttonType: 'primary',
                            },
                            {
                                type: 'button',
                                name: 'do_upload',
                                text: 'Upload…',
                                buttonType: 'primary',
                            },
                        ],
                    },
                    {
                        type: 'htmlpanel',
                        html: buildBrowserHtml(state),
                    },
                    {
                        type: 'input',
                        name: 'alt',
                        label: 'Alt text',
                    },
                ],
            },
            buttons: [
                { type: 'cancel', text: 'Cancel' },
                {
                    type: 'submit',
                    text: 'Insert',
                    primary: true,
                    enabled: Boolean(state.selectedPath),
                },
            ],
            initialData: {
                search: state.search || '',
                alt: state.alt || '',
            },
        };
    }

    async function resolveEditor(preferred) {
        if (preferred && preferred.windowManager) {
            return preferred;
        }
        const tinymce = global.tinymce;
        if (!tinymce) {
            throw new Error('TinyMCE is not loaded yet.');
        }
        if (tinymce.activeEditor) {
            return tinymce.activeEditor;
        }
        if (tinymce.editors && tinymce.editors.length) {
            return tinymce.editors[0];
        }

        const ta = document.createElement('textarea');
        ta.setAttribute('aria-hidden', 'true');
        ta.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta);
        const eds = await tinymce.init({
            target: ta,
            license_key: 'gpl',
            menubar: false,
            toolbar: false,
            statusbar: false,
            branding: false,
            promotion: false,
            height: 1,
            base_url: tinymce.baseURL,
        });
        const ed = Array.isArray(eds) ? eds[0] : eds;
        ed.__badgerMediaPickerScratch = true;
        return ed;
    }

    /**
     * @param {object} options
     * @param {import('tinymce').Editor} [options.editor]
     * @param {string} [options.title]
     * @param {string|null} [options.selectedPath]
     * @param {string} [options.alt]
     * @param {boolean} [options.allowUpload]
     * @param {(result: {path:string,url:string,alt:string,filename:string}) => void} [options.onInsert]
     * @param {() => void} [options.onCancel]
     */
    async function open(options = {}) {
        const editor = await resolveEditor(options.editor);
        const allowUpload = options.allowUpload !== false;

        const state = {
            path: '',
            search: '',
            folders: [],
            items: [],
            loading: true,
            error: null,
            selectedPath: options.selectedPath || null,
            selectedItem: null,
            alt: options.alt || '',
        };

        let apiRef = null;
        let closed = false;

        const refresh = async () => {
            state.loading = true;
            state.error = null;
            if (apiRef) {
                apiRef.redial(buildFullSpec());
                scheduleMarkDialogDom();
            }
            try {
                const data = await fetchMedia({
                    path: state.search ? '' : state.path,
                    search: state.search,
                });
                state.folders = state.search ? [] : data.folders;
                state.items = data.items;
                if (state.selectedPath) {
                    state.selectedItem =
                        state.items.find((i) => itemRelativePath(i) === state.selectedPath) ||
                        state.selectedItem;
                }
            } catch (e) {
                state.error = e.message || String(e);
                state.folders = [];
                state.items = [];
            } finally {
                state.loading = false;
                if (apiRef && !closed) {
                    apiRef.redial(buildFullSpec());
                    scheduleMarkDialogDom();
                }
            }
        };

        const onDocClick = (e) => {
            if (closed || !apiRef) return;
            const folderBtn = e.target.closest('[data-bb-folder]');
            if (folderBtn && e.target.closest('.tox-dialog')) {
                e.preventDefault();
                state.path = folderBtn.getAttribute('data-bb-folder') || '';
                state.search = '';
                refresh();
                return;
            }
            const itemBtn = e.target.closest('[data-bb-item]');
            if (itemBtn && e.target.closest('.tox-dialog')) {
                e.preventDefault();
                const rel = itemBtn.getAttribute('data-bb-item') || '';
                state.selectedPath = rel;
                state.selectedItem =
                    state.items.find((i) => itemRelativePath(i) === rel) || null;
                const alt =
                    (state.selectedItem && state.selectedItem.alt) ||
                    apiRef.getData().alt ||
                    '';
                state.alt = alt;
                apiRef.redial(buildFullSpec());
                scheduleMarkDialogDom();
                apiRef.setData({ alt });
            }
        };

        const buildFullSpec = () => {
            const spec = dialogSpec(state, options);
            if (!allowUpload) {
                spec.body.items[0].items = spec.body.items[0].items.filter(
                    (it) => it.name !== 'do_upload',
                );
            }
            spec.onAction = async (api, details) => {
                apiRef = api;
                if (details.name === 'do_search') {
                    state.search = (api.getData().search || '').trim();
                    await refresh();
                    return;
                }
                if (details.name === 'do_upload' && allowUpload) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.style.display = 'none';
                    document.body.appendChild(input);
                    input.addEventListener('change', async () => {
                        const file = input.files && input.files[0];
                        input.remove();
                        if (!file) return;
                        api.block('Uploading…');
                        try {
                            await uploadFile(file, state.path);
                            state.search = '';
                            await refresh();
                        } catch (err) {
                            state.error = err.message || String(err);
                            api.redial(buildFullSpec());
                            scheduleMarkDialogDom();
                        } finally {
                            api.unblock();
                        }
                    });
                    input.click();
                }
            };
            spec.onSubmit = async (api) => {
                apiRef = api;
                if (!state.selectedPath) {
                    return;
                }
                const alt = (api.getData().alt || '').trim();
                const item = state.selectedItem;
                const filename = item?.filename || state.selectedPath.split('/').pop();
                const portableUrl = toPortableUrl(
                    item?.url || `${MEDIA_PREFIX}${state.selectedPath}`,
                );
                try {
                    await patchAlt(state.selectedPath, alt);
                } catch {
                    // non-fatal
                }
                closed = true;
                document.removeEventListener('click', onDocClick, true);
                api.close();
                if (typeof options.onInsert === 'function') {
                    options.onInsert({
                        path: state.selectedPath,
                        url: portableUrl,
                        alt,
                        filename,
                    });
                }
            };
            spec.onClose = () => {
                if (!closed && typeof options.onCancel === 'function') {
                    options.onCancel();
                }
                closed = true;
                document.removeEventListener('click', onDocClick, true);
            };
            return spec;
        };

        document.addEventListener('click', onDocClick, true);
        apiRef = editor.windowManager.open(buildFullSpec());
        scheduleMarkDialogDom();
        await refresh();
    }

    global.BadgerMediaPicker = {
        open,
        toPortableUrl,
        itemRelativePath,
        MEDIA_PREFIX,
        DIALOG_ID,
    };
})(typeof window !== 'undefined' ? window : globalThis);
