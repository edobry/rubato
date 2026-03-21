// Minimal service worker for PWA installability.
// No caching — the admin requires a live WebSocket connection.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
