// Gioco disponibile anche offline: i file dell'app e il dizionario restano in cache.
// Cambia VERSION a ogni aggiornamento, così i dispositivi scaricano i file nuovi.
const VERSION = "passaparola-v3";
const FILES = [
  "./", "index.html", "style.css", "app.js", "board.js", "game.js", "online.js", "firebase-config.js",
  "parole.txt", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Firebase e il server di gioco: sempre dalla rete
  if (/firebase|googleapis\.com\/identitytoolkit|gstatic\.com\/firebasejs/.test(url.href)) return;
  // Font di Google: dalla cache se ci sono, altrimenti rete e poi cache
  if (url.origin !== location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
      e.respondWith(caches.open(VERSION).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        c.put(e.request, res.clone());
        return res;
      }));
    }
    return;
  }
  // File dell'app: cache, aggiornata in background quando c'è rete
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
