// SuperRoo Dashboard — Service Worker
const CACHE = "superroo-v1"
const ASSETS = ["/", "/manifest.json"]

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
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

	event.respondWith(
		caches.match(event.request).then((cached) => {
			// Return cached if available, otherwise fetch and cache
			const fetchPromise = fetch(event.request)
				.then((response) => {
					if (response.ok && response.type === "basic") {
						const clone = response.clone()
						caches.open(CACHE).then((cache) => cache.put(event.request, clone))
					}
					return response
				})
				.catch(() => cached)
			return cached || fetchPromise
		}),
	)
})
