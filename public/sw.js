self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event: FetchEvent) => {
  // pass-through — coi-serviceworker intercepts to inject COOP/COEP headers
});