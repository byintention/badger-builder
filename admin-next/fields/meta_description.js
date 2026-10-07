/**
 * meta_description — Admin Next field with a live length status.
 *
 * Stores a plain string (header.metadata.description). Status sits under the
 * field help/tooltip: Good 150–160 chars, OK 120–149, Poor if shorter or longer.
 * Colour plus Poor/OK/Good text and a live character count.
 */

const TAG = window.__GRAV_FIELD_TAG;

const GREEN_MIN = 150;
const GREEN_MAX = 160;
const AMBER_MIN = 120;

function lengthState(len, greenMin, greenMax, amberMin) {
    if (len >= greenMin && len <= greenMax) {
        return 'green';
    }
    if (len >= amberMin && len < greenMin) {
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

function lengthMessage(len, state, greenMin, greenMax) {
    const word = lengthWord(state);
    if (state === 'green') {
        return `${word} — ${len} characters`;
    }
    if (state === 'amber') {
        return `${word} — ${len} characters, a little short (aim for ${greenMin}–${greenMax})`;
    }
    if (len > greenMax) {
        return `${word} — ${len} characters, too long (aim for ${greenMin}–${greenMax})`;
    }
    return `${word} — ${len} characters, too short (aim for ${greenMin}–${greenMax})`;
}

class MetaDescriptionField extends HTMLElement {
    constructor() {
        super();
        this._value = '';
        this._field = null;
        this._status = null;
        this._statusWord = null;
        this._statusCount = null;
        this._textarea = null;
        this._built = false;
    }

    set field(v) {
        this._field = v;
        if (this.isConnected) {
            this._placeIcon();
            this._updateIcon();
        }
    }
    get field() {
        return this._field;
    }

    set value(v) {
        const next = v == null ? '' : String(v);
        if (next !== this._value) {
            this._value = next;
            if (this._textarea && this._textarea.value !== next) {
                this._textarea.value = next;
            }
            this._updateIcon();
        }
    }
    get value() {
        return this._value;
    }

    connectedCallback() {
        this._ensureStylesheet();
        this._build();
        this._placeIcon();
        this._updateIcon();
        requestAnimationFrame(() => {
            this._placeIcon();
            this._updateIcon();
        });
    }

    disconnectedCallback() {
        this._status?.remove();
        this._status = null;
        this._statusWord = null;
        this._statusCount = null;
    }

    _limits() {
        const f = this._field || {};
        return {
            greenMin: Number(f.green_min) || GREEN_MIN,
            greenMax: Number(f.green_max) || GREEN_MAX,
            amberMin: Number(f.amber_min) || AMBER_MIN,
        };
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

    _build() {
        if (this._built) {
            return;
        }
        this._built = true;
        this.innerHTML = `<textarea class="bb-admin-meta-desc-input" rows="${this._field?.rows || 3}"></textarea>`;
        this._textarea = this.querySelector('textarea');
        this._textarea.value = this._value;
        this._textarea.addEventListener('input', () => {
            this._value = this._textarea.value;
            this._updateIcon();
            this.dispatchEvent(new CustomEvent('change', {
                detail: this._value,
                bubbles: true,
            }));
        });
    }

    _findHelp() {
        let node = this;
        for (let i = 0; i < 5 && node; i++) {
            node = node.parentElement;
            if (!node) {
                break;
            }
            const help = node.querySelector('p');
            if (help && !this.contains(help)) {
                return help;
            }
        }
        return null;
    }

    _findLabel() {
        let node = this;
        for (let i = 0; i < 5 && node; i++) {
            node = node.parentElement;
            if (!node) {
                break;
            }
            const label = node.querySelector('label');
            if (label && !this.contains(label)) {
                return label;
            }
        }
        return null;
    }

    _placeIcon() {
        if (!this._status) {
            this._status = document.createElement('span');
            this._status.className = 'bb-admin-meta-desc-status';
            this._status.setAttribute('role', 'status');
            const dot = document.createElement('span');
            dot.className = 'bb-admin-meta-desc-icon';
            dot.setAttribute('aria-hidden', 'true');
            this._statusWord = document.createElement('span');
            this._statusWord.className = 'bb-admin-meta-desc-word';
            this._statusCount = document.createElement('span');
            this._statusCount.className = 'bb-admin-meta-desc-count';
            this._status.append(dot, this._statusWord, this._statusCount);
        }
        const help = this._findHelp();
        if (help) {
            if (this._status.previousElementSibling !== help) {
                help.insertAdjacentElement('afterend', this._status);
            }
            return;
        }
        const label = this._findLabel();
        if (label) {
            if (this._status.previousElementSibling !== label) {
                label.insertAdjacentElement('afterend', this._status);
            }
            return;
        }
        if (this._textarea && this._status.nextElementSibling !== this._textarea) {
            this.insertBefore(this._status, this._textarea);
        }
    }

    _updateIcon() {
        if (this.isConnected) {
            this._placeIcon();
        }
        if (!this._status) {
            return;
        }
        const { greenMin, greenMax, amberMin } = this._limits();
        const len = this._value.length;
        const state = lengthState(len, greenMin, greenMax, amberMin);
        const word = lengthWord(state);
        const message = lengthMessage(len, state, greenMin, greenMax);
        this._status.classList.remove('is-green', 'is-amber', 'is-red');
        this._status.classList.add(`is-${state}`);
        this._status.title = message;
        this._status.setAttribute('aria-label', message);
        if (this._statusWord) {
            this._statusWord.textContent = word;
        }
        if (this._statusCount) {
            this._statusCount.textContent = String(len);
        }
    }
}

customElements.define(TAG, MetaDescriptionField);
