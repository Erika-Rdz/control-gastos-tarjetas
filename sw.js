// App instalable de Control de Gastos.
// No guarda copias de la página: siempre carga la versión más reciente desde internet.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
