// ==UserScript==
// @name         TwitchNoSub
// @namespace    https://github.com/besuper/TwitchNoSub
// @version      2.0.0
// @description  Watch sub only VODs on Twitch
// @author       besuper
// @updateURL    https://raw.githubusercontent.com/besuper/TwitchNoSub/master/userscript/twitchnosub.user.js
// @downloadURL  https://raw.githubusercontent.com/besuper/TwitchNoSub/master/userscript/twitchnosub.user.js
// @icon         https://raw.githubusercontent.com/besuper/TwitchNoSub/master/assets/icons/icon.png
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none

// ==/UserScript==
(function () {
    'use strict';

    if (window.__twitchNoSub) return;
    Object.defineProperty(window, '__twitchNoSub', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
    });

    const PATCH_URL = 'https://cdn.jsdelivr.net/gh/besuper/TwitchNoSub@master/src/patch_amazonworker.js';
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

    function chainLeadsToIvsWorker(initialUrl, maxDepth = 5) {
        let url = String(initialUrl);

        for (let i = 0; i < maxDepth; i++) {
            if (IVS_WORKER_RE.test(url)) return true;

            const src = fetchSync(url);
            if (!src) return false;

            IMPORT_RE.lastIndex = 0;
            let match, next = null;

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

    function buildPatchedBlobUrl(originalScriptURL) {
        const bootstrap = `"use strict";
    try { importScripts(${JSON.stringify(PATCH_URL)}); } catch (e) { console.error('[TNS] patch_amazonworker failed:', e); }
    importScripts(${JSON.stringify(String(originalScriptURL))});`;

        return URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    }

    const NativeWorker = window.Worker;

    if (typeof NativeWorker === 'function') {
        window.Worker = class Worker extends NativeWorker {
            constructor(scriptURL, options) {
                if (scriptURL == null || (options && options.type === 'module')) {
                    super(scriptURL, options);
                    return;
                }

                const leadsToIvs = chainLeadsToIvsWorker(scriptURL);

                if (!leadsToIvs) {
                    super(scriptURL, options);
                    return;
                }

                console.log('[TNS] Amazon IVS worker detected, applying patch.');
                const patchedUrl = buildPatchedBlobUrl(scriptURL);
                super(patchedUrl, options);
                setTimeout(() => URL.revokeObjectURL(patchedUrl), 0);
            }
        };
    }

    function removeFromNode(node) {
        if (!node || node.nodeType !== 1) return;
        if (node.classList?.contains('video-preview-card-restriction')) {
            node.remove();
            return;
        }
        const col = node.getElementsByClassName?.('video-preview-card-restriction');
        if (!col || !col.length) return;
        for (let i = col.length - 1; i >= 0; i--) col[i].remove();
    }

    function sweepExisting() {
        const col = document.getElementsByClassName('video-preview-card-restriction');
        while (col.length) col[0].remove();
    }

    sweepExisting();

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            if (m.addedNodes) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) removeFromNode(node);
                }
            }
            if (m.type === 'attributes' && m.target?.classList?.contains('video-preview-card-restriction')) {
                m.target.remove();
            }
        }
    });

    const root = document.documentElement || document.body;
    if (root) {
        observer.observe(root, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });
    }

    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true, passive: true });
})();