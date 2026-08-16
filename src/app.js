(function () {
    'use strict';

    // Prevent double-injection (e.g. multiple content-script frames / reloads)
    if (window.__twitchNoSub) return;
    Object.defineProperty(window, '__twitchNoSub', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
    });

    // patch_url is provided by the browser-specific injector (src/chrome/app.js or src/firefox/app.js)
    if (typeof patch_url === 'undefined' || !patch_url) {
        console.error('[TNS] patch_url is not defined – worker patch cannot be applied');
        return;
    }

    const IVS_WORKER_RE = /amazon-ivs-wasmworker[\w.-]*\.js/i;
    const IMPORT_RE = /importScripts\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    function fetchSync(url) {
        try {
            const req = new XMLHttpRequest();
            req.open('GET', url, false);
            req.overrideMimeType('text/javascript');
            req.send();
            if (req.status === 0 || (req.status >= 200 && req.status < 300)) {
                return req.responseText || '';
            }
        } catch (e) {
            console.warn('[TNS] fetch worker source failed:', url, e);
        }
        return null;
    }

    /**
     * Walk a possible importScripts chain (blob → blob → …) looking for the
     * Amazon IVS wasm worker. Only those workers need the patch.
     */
    function chainLeadsToIvsWorker(initialUrl, maxDepth) {
        if (maxDepth === undefined) maxDepth = 5;
        var url = String(initialUrl);
        for (var i = 0; i < maxDepth; i++) {
            if (IVS_WORKER_RE.test(url)) return true;
            var src = fetchSync(url);
            if (!src) return false;
            IMPORT_RE.lastIndex = 0;
            var match, next = null;
            while ((match = IMPORT_RE.exec(src))) {
                if (IVS_WORKER_RE.test(match[1])) return true;
                if (!next && match[1].startsWith('blob:')) next = match[1];
            }
            if (!next) return false;
            url = next;
        }
        console.warn('[TNS] Max chain depth reached without finding amazon-ivs-wasmworker');
        return false;
    }

    /**
     * Build a tiny bootstrap blob that loads the patch first, then the original
     * worker script via importScripts. This avoids inlining the whole worker
     * source (more efficient and less fragile).
     */
    function buildPatchedBlobUrl(originalScriptURL) {
        var bootstrap = '"use strict";\n' +
            'try { importScripts(' + JSON.stringify(patch_url) + '); } catch (e) { console.error("[TNS] patch_amazonworker failed:", e); }\n' +
            'importScripts(' + JSON.stringify(String(originalScriptURL)) + ');';
        return URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    }

    var NativeWorker = window.Worker;
    if (typeof NativeWorker !== 'function') return;

    window.Worker = class Worker extends NativeWorker {
        constructor(scriptURL, options) {
            // Leave module workers and null URLs alone
            if (scriptURL == null || (options && options.type === 'module')) {
                super(scriptURL, options);
                return;
            }

            var leadsToIvs = chainLeadsToIvsWorker(scriptURL);
            if (!leadsToIvs) {
                super(scriptURL, options);
                return;
            }

            var patchedUrl = buildPatchedBlobUrl(scriptURL);
            super(patchedUrl, options);
            // Revoke as soon as the worker has started loading the blob
            setTimeout(function () { URL.revokeObjectURL(patchedUrl); }, 0);
        }
    };
})();
