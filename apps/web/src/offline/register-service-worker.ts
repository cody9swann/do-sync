const SERVICE_WORKER_URL = "/sw.js"
const PERSISTENCE_ASSET_URLS = ["/assets/opfs-worker-CCciqEMo.js", "/assets/wa-sqlite.wasm"]
const CACHE_VERSION = "v4"
const SHELL_CACHE = `do-sync-shell-${CACHE_VERSION}`
const ASSET_CACHE = `do-sync-assets-${CACHE_VERSION}`

function isCacheableSameOriginUrl(value: string) {
  try {
    const url = new URL(value, window.location.href)
    if (url.origin !== window.location.origin) return false
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    if (url.pathname.startsWith("/api/")) return false
    if (url.pathname.startsWith("/ws/")) return false
    return true
  } catch {
    return false
  }
}

function collectAppShellUrls() {
  const urls = new Set<string>()

  urls.add(new URL("/", window.location.href).toString())
  urls.add(window.location.href)

  for (const path of PERSISTENCE_ASSET_URLS) {
    urls.add(new URL(path, window.location.href).toString())
  }

  for (const node of document.querySelectorAll('link[rel="stylesheet"], link[rel="modulepreload"]')) {
    const href = node.getAttribute("href")
    if (!href) continue
    urls.add(new URL(href, window.location.href).toString())
  }

  for (const node of document.querySelectorAll("script[src]")) {
    const src = node.getAttribute("src")
    if (!src) continue
    urls.add(new URL(src, window.location.href).toString())
  }

  for (const entry of performance.getEntriesByType("resource")) {
    if (!("name" in entry) || typeof entry.name !== "string") continue
    if (!isCacheableSameOriginUrl(entry.name)) continue
    urls.add(new URL(entry.name, window.location.href).toString())
  }

  return Array.from(urls).filter(isCacheableSameOriginUrl)
}

function postUrlsToServiceWorker(registration: ServiceWorkerRegistration) {
  const worker =
    navigator.serviceWorker.controller ??
    registration.active ??
    registration.waiting ??
    registration.installing

  if (!worker) return

  worker.postMessage({
    type: "CACHE_URLS",
    urls: collectAppShellUrls(),
  })
}

async function precacheUrl(url: string) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!response.ok) return

  const contentType = response.headers.get("content-type") || ""
  const cacheName = contentType.includes("text/html") ? SHELL_CACHE : ASSET_CACHE
  const cache = await caches.open(cacheName)

  await cache.put(url, response.clone())
  if (cacheName === SHELL_CACHE) {
    await cache.put(new URL("/__offline_shell__", window.location.origin).toString(), response.clone())
  }
}

async function warmOfflineCaches() {
  if (!("caches" in window)) return

  const urls = collectAppShellUrls()
  await Promise.allSettled(urls.map((url) => precacheUrl(url)))
}

export async function registerOfflineServiceWorker() {
  if (typeof window === "undefined") return
  if (!("serviceWorker" in navigator)) return
  if (import.meta.env.DEV) return

  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: "/",
      updateViaCache: "none",
    })

    await registration.update()

    const seedCache = () => {
      void warmOfflineCaches()
      postUrlsToServiceWorker(registration)
    }

    navigator.serviceWorker.addEventListener("controllerchange", seedCache, { once: true })
    window.addEventListener("load", seedCache, { once: true })
    window.setTimeout(seedCache, 1_500)

    const readyRegistration = await navigator.serviceWorker.ready
    postUrlsToServiceWorker(readyRegistration)
  } catch (error) {
    console.warn("[do-sync] failed to register offline service worker", error)
  }
}
