// Service worker: guarda todos os arquivos do estúdio para funcionar sem internet.
// A versão do cache muda a cada publicação (o build do Vite escreve a versão e a lista de arquivos).
const CACHE = 'editor-cenas-__VERSAO__';
const ARQUIVOS = __ARQUIVOS__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('editor-cenas-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// A página (index.html): primeiro a rede, para pegar a versão nova assim que ela for publicada;
// sem internet, usa a cópia guardada. Os outros arquivos têm nome com código (ex.: index-BQLcGwd8.js),
// então podem vir direto do cache: uma versão nova sempre tem nomes novos.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copia)); return r; })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)),
  );
});

// O app pode pedir para limpar tudo (botão "Limpar cache do app" nos Ajustes).
self.addEventListener('message', (e) => {
  if (e.data === 'pular-espera') self.skipWaiting();
});
