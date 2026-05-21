/*
 * Copyright (c) 2026 Wei-Chieh Hsia. All rights reserved.
 */

/* ============================================================
   BOOT
============================================================ */
document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    connectMQTT();

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('PWA Service Worker registered.'))
            .catch(err => console.warn('PWA registration failed (needs localhost/https):', err));
    }
});
