// Gioco disponibile anche offline: i file dell'app e il dizionario restano in cache.
// Cambia VERSION a ogni aggiornamento, così i dispositivi scaricano i file nuovi.
const VERSION = "passaparola-v4";
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
  // Dizionario e icone: dalla cache (non cambiano quasi mai); il resto dell'app: prima la rete,
  // così dopo un aggiornamento arriva subito il codice nuovo, e la cache serve solo offline.
  const cacheFirst = /\/(parole\.txt|icons\/)/.test(url.pathname);
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (cacheFirst && hit) return hit;
    try {
      const res = await Promise.race([
        fetch(e.request, { cache: "no-cache" }),
        new Promise((_, no) => setTimeout(() => no(new Error("lenta")), hit ? 4000 : 30000)),
      ]);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (hit) return hit;
      throw err;
    }
  }));
});
