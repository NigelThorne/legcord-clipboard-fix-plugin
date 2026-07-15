const test = require("node:test");
const assert = require("node:assert/strict");

function createMockDocument() {
    const appended = [];
    let activeElement = { focus() {} };

    function makeElement(tagName) {
        const el = {
            tagName: tagName.toUpperCase(),
            children: [],
            attributes: {},
            style: {},
            value: "",
            textContent: "",
            _innerHTML: "",
            contentEditable: "",
            get innerHTML() {
                if (this._innerHTML) return this._innerHTML;
                return this.children.map(child => child.outerHTML ?? child.textContent ?? "").join("");
            },
            set innerHTML(value) {
                this._innerHTML = value;
            },
            get outerHTML() {
                const attrs = Object.entries(this.attributes).map(([key, value]) => ` ${key}="${value}"`).join("");
                if (this.tagName === "IMG") return `<img${attrs} src="${this.src ?? ""}" alt="${this.alt ?? ""}">`;
                return `<${this.tagName.toLowerCase()}${attrs}>${this.textContent}${this.innerHTML}</${this.tagName.toLowerCase()}>`;
            },
            appendChild(child) {
                this.children.push(child);
                child.parentNode = this;
                return child;
            },
            setAttribute(name, value) {
                this.attributes[name] = value;
            },
            focus() {
                activeElement = this;
            },
            select() {},
            setSelectionRange() {},
            remove() {
                const index = appended.indexOf(this);
                if (index !== -1) appended.splice(index, 1);
            },
        };
        return el;
    }

    return {
        appended,
        get activeElement() {
            return activeElement;
        },
        body: {
            appendChild(el) {
                appended.push(el);
                el.parentNode = this;
                return el;
            },
        },
        documentElement: null,
        createElement: makeElement,
        execCommand(command) {
            this.lastCommand = command;
            this.copiedHTML = appended[appended.length - 1]?.innerHTML ?? "";
            return this.copiedHTML.length > 0;
        },
        createRange() {
            return {
                selectNodeContents(node) {
                    this.node = node;
                },
            };
        },
        lastCommand: null,
        copiedHTML: "",
    };
}

function createLogger() {
    return {
        log() {},
        warn() {},
        error() {},
    };
}

test("patches navigator.clipboard.write and falls back for image ClipboardItems", async () => {
    const originalGlobals = {
        navigator: global.navigator,
        document: global.document,
        window: global.window,
        getSelection: global.getSelection,
    };

    const document = createMockDocument();
    const selection = {
        removeAllRangesCalled: 0,
        addRangeCalled: 0,
        removeAllRanges() {
            this.removeAllRangesCalled += 1;
        },
        addRange() {
            this.addRangeCalled += 1;
        },
    };

    try {
        global.document = document;
        global.window = {
            addEventListener() {},
            getSelection: () => selection,
        };
        global.getSelection = () => selection;
        Object.defineProperty(global, "navigator", {
            configurable: true,
            value: {
                clipboard: {
                    writeText: async () => {},
                    write: async () => {
                        throw new DOMException("Document is not focused", "NotAllowedError");
                    },
                },
            },
        });

        delete require.cache[require.resolve("./renderer.js")];
        const plugin = require("./renderer.js");
        plugin.activate({ logger: createLogger() });

        const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
        const item = {
            types: ["image/png"],
            getType: async type => {
                assert.equal(type, "image/png");
                return blob;
            },
        };

        await global.navigator.clipboard.write([item]);

        assert.equal(document.lastCommand, "copy");
        assert.match(document.copiedHTML, /<img/);
        assert.match(document.copiedHTML, /src="data:image\/png;base64,AQID"/);
        assert.equal(selection.addRangeCalled, 1);
        assert.equal(selection.removeAllRangesCalled, 2);
        assert.equal(document.appended.length, 0, "temporary copy element is removed");
    } finally {
        global.navigator = originalGlobals.navigator;
        global.document = originalGlobals.document;
        global.window = originalGlobals.window;
        global.getSelection = originalGlobals.getSelection;
    }
});
