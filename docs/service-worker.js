"use strict";

// Increment this version when publishing changes to the app shell.
const CACHE_PREFIX = "ai-digest-";
const CACHE_VERSION = "v1";

const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}data-${CACHE_VERSION}`;

const BASE_URL = new URL("./", self.location.href);
const INDEX_URL = new URL("index.html", BASE_URL).href;
const DATA_PATH = new URL("data/", BASE_URL).pathname;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest"
].map(path => new URL(path, BASE_URL).href);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES))
  );

  // Let an updated worker wait until existing app windows close.
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter(name =>
            name.startsWith(CACHE_PREFIX) &&
            name !== SHELL_CACHE &&
            name !== DATA_CACHE
          )
          .map(name => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, cacheName, navigation = false) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, {
      cache: "no-store"
    });

    if (response.ok) {
      try {
        await cache.put(request, response.clone());
      } catch (error) {
        console.warn("Could not cache response:", error);
      }
    }

    // Return HTTP errors directly rather than hiding a broken deployment.
    return response;
  } catch {
    const cached = await cache.match(request);

    if (cached) return cached;

    if (navigation) {
      const appShell = await cache.match(INDEX_URL);
      if (appShell) return appShell;
    }

    return new Response(
      navigation
        ? "The app is unavailable offline. Connect and try again."
        : "Resource unavailable offline.",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== BASE_URL.origin) return;
  if (!url.pathname.startsWith(BASE_URL.pathname)) return;

  if (url.pathname.startsWith(DATA_PATH)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, true));
    return;
  }

  // Only cache known app files, not arbitrary same-origin resources.
  if (SHELL_FILES.includes(url.href)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
