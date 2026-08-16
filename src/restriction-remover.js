(function () {
    'use strict';

    function removeFromNode(node) {
        if (!node || node.nodeType !== 1) return;

        if (node.classList && node.classList.contains('video-preview-card-restriction')) {
            node.remove();
            return;
        }

        var col = node.getElementsByClassName && node.getElementsByClassName('video-preview-card-restriction');
        if (!col || !col.length) return;

        // Iterate backwards because the live HTMLCollection shrinks as we remove
        for (var i = col.length - 1; i >= 0; i--) {
            col[i].remove();
        }
    }

    function sweepExisting() {
        var col = document.getElementsByClassName('video-preview-card-restriction');
        while (col.length) {
            col[0].remove();
        }
    }

    // Run as early as possible (content script is document_start)
    sweepExisting();

    var observer = new MutationObserver(function (mutations) {
        for (var mi = 0; mi < mutations.length; mi++) {
            var m = mutations[mi];
            if (m.addedNodes) {
                for (var ni = 0; ni < m.addedNodes.length; ni++) {
                    var node = m.addedNodes[ni];
                    if (node.nodeType === 1) removeFromNode(node);
                }
            }
            // Also catch class changes that turn an element into a restriction card
            if (m.type === 'attributes' && m.target && m.target.classList &&
                m.target.classList.contains('video-preview-card-restriction')) {
                m.target.remove();
            }
        }
    });

    var root = document.documentElement || document.body;
    if (root) {
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    window.addEventListener('beforeunload', function () {
        observer.disconnect();
    }, { once: true, passive: true });
})();
