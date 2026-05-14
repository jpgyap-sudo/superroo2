// SuperRoo Dashboard — Service Worker
// Cache version: auto-bumped by deploy script via SW_CACHE_VERSION
const CACHE = self.__SW_CACHE_VERSION || "superroo-v2"
const ASSETS = ["/", "/manifest.json"]

self.addEventListener("install", (event) => {
	// Delete ALL old caches on install (new deploy = fresh start)
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => {
				// Delete any cache that isn't the current one
				return caches
					.keys()
					.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			})
			.then(() => self.skipWaiting()),
	)
})

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
	)
	self.clients.claim()
})

self.addEventListener("fetch", (event) => {
	// Only cache GET requests
	if (event.request.method !== "GET") return

	// Don't cache API calls
	if (event.request.url.includes("/api/")) {
		return
	}

	// Network-first: always try network, fall back to cache on failure
	// This ensures fresh content after deploy while still working offline
	event.respondWith(
		fetch(event.request)
			.then((response) => {
				// Only cache successful responses for static assets
				if (response.ok && response.type === "basic") {
					const clone = response.clone()
					caches.open(CACHE).then((cache) => cache.put(event.request, clone))
				}
				return response
			})
			.catch(() => caches.match(event.request)),
	)
})
