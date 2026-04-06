const CACHE_VERSION = "v4"
const SHELL_CACHE = `do-sync-shell-${CACHE_VERSION}`
const ASSET_CACHE = `do-sync-assets-${CACHE_VERSION}`
const OFFLINE_SHELL_URL = new URL("/__offline_shell__", self.location.origin).toString()

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name !== SHELL_CACHE && name !== ASSET_CACHE)
          .map((name) => caches.delete(name))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("message", (event) => {
  const data = event.data
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return

  event.waitUntil(cacheUrls(data.urls))
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  if (shouldCacheAsset(request, url)) {
    event.respondWith(handleAssetRequest(request))
  }
})

async function cacheUrls(urls) {
  const uniqueUrls = [...new Set(urls)].filter((value) => isCacheableSameOriginUrl(value))
  await Promise.all(uniqueUrls.map((value) => cacheUrl(value)))
}

async function cacheUrl(url) {
  try {
    const request = new Request(url, { credentials: "same-origin", cache: "no-store" })
    const response = await fetch(request)
    if (!response || !response.ok) return

    if (isHtmlResponse(response)) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(request.url, response.clone())
      await cache.put(OFFLINE_SHELL_URL, response.clone())
      return
    }

    const cache = await caches.open(ASSET_CACHE)
    await cache.put(request.url, response.clone())
  } catch {
    // Ignore transient cache seeding failures.
  }
}

async function handleNavigationRequest(request) {
  const cache = await caches.open(SHELL_CACHE)

  try {
    const response = await fetch(request)
    if (response && response.ok) {
      await cache.put(request.url, response.clone())
      await cache.put(OFFLINE_SHELL_URL, response.clone())
    }
    return response
  } catch {
    return (
      (await cache.match(request.url)) ||
      (await cache.match(OFFLINE_SHELL_URL)) ||
      new Response("Offline", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    )
  }
}

async function handleAssetRequest(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request.url)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response && response.ok) {
      await cache.put(request.url, response.clone())
    }
    return response
  } catch {
    return Response.error()
  }
}

function shouldCacheAsset(request, url) {
  if (request.destination === "script") return true
  if (request.destination === "style") return true
  if (request.destination === "worker") return true
  if (request.destination === "manifest") return true
  if (request.destination === "font") return true
  if (request.destination === "image") return true

  if (url.pathname.startsWith("/assets/")) return true
  if (url.pathname.endsWith(".js")) return true
  if (url.pathname.endsWith(".css")) return true
  if (url.pathname.endsWith(".wasm")) return true

  return false
}

function isHtmlResponse(response) {
  const contentType = response.headers.get("content-type") || ""
  return contentType.includes("text/html")
}

function isCacheableSameOriginUrl(value) {
  try {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin) return false
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (url.pathname.startsWith("/api/")) return false
    if (url.pathname.startsWith("/ws/")) return false
    return true
  } catch {
    return false
  }
}
