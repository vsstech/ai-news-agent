"use strict";

const DIGEST_URL = new URL("./data/latest.json", document.baseURI);
const PREFERENCES_KEY = "ai-digest-selected-topics-v1";

const elements = {
  refresh: document.querySelector("#refresh-button"),
  clearFilters: document.querySelector("#clear-filters"),
  updatedAt: document.querySelector("#updated-at"),
  connection: document.querySelector("#connection-status"),
  filters: document.querySelector("#topic-filters"),
  count: document.querySelector("#result-count"),
  message: document.querySelector("#message"),
  articles: document.querySelector("#articles")
};

let digest = null;
let selectedTopics = readPreferences();
let loading = false;

function readPreferences() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(PREFERENCES_KEY) || "[]"
    );

    return new Set(
      Array.isArray(saved)
        ? saved.filter(topic => typeof topic === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

function savePreferences() {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify([...selectedTopics])
    );
  } catch {
    // Filtering still works when browser storage is unavailable.
  }
}

function formatDate(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function safeArticleUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);

    return ["https:", "http:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeDigest(data) {
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Digest must contain an items array.");
  }

  const items = data.items
    .filter(item => item && typeof item === "object")
    .map(item => ({
      title: String(item.title || "Untitled article"),
      summary: String(item.summary || ""),
      source: String(item.source || "Original source"),
      url: safeArticleUrl(item.url),
      published_at: item.published_at || null,
      topics: Array.isArray(item.topics)
        ? [...new Set(
            item.topics.filter(
              topic => typeof topic === "string" && topic.trim()
            )
          )]
        : []
    }));

  return {
    generated_at: data.generated_at || null,
    items
  };
}

function setMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.hidden = !text;
  elements.message.classList.toggle("error", isError);
}

function updateConnectionStatus() {
  elements.connection.textContent = navigator.onLine
    ? "Online"
    : "Offline — showing saved content if available.";
}

function renderTopicFilters() {
  elements.filters.replaceChildren();

  const topics = [...new Set(
    digest.items.flatMap(item => item.topics)
  )].sort((a, b) => a.localeCompare(b));

  const availableTopics = new Set(topics);
  const hasUnavailableSelection = [...selectedTopics].some(
    topic => !availableTopics.has(topic)
  );

  topics.forEach(topic => {
    const button = document.createElement("button");
    const selected = selectedTopics.has(topic);

    button.type = "button";
    button.className = "topic-button";
    button.textContent = topic;
    button.setAttribute("aria-pressed", String(selected));

    button.addEventListener("click", () => {
      if (selectedTopics.has(topic)) {
        selectedTopics.delete(topic);
      } else {
        selectedTopics.add(topic);
      }

      savePreferences();
      renderTopicFilters();
      renderArticles();
    });

    elements.filters.append(button);
  });

  if (!topics.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No topics are included in this digest.";
    elements.filters.append(note);
  }

  if (hasUnavailableSelection) {
    const note = document.createElement("p");
    note.className = "muted filter-note";
    note.textContent =
      "Some saved topic selections are absent from this digest. " +
      "Choose Show all to clear your selections.";
    elements.filters.append(note);
  }
}

function createArticleCard(item) {
  const card = document.createElement("article");
  card.className = "article-card";

  const metadata = document.createElement("p");
  metadata.className = "article-meta";
  metadata.textContent = item.published_at
    ? `${item.source} · ${formatDate(item.published_at)}`
    : item.source;

  const heading = document.createElement("h3");
  heading.textContent = item.title;

  const summary = document.createElement("p");
  summary.className = "article-summary";
  summary.textContent =
    item.summary || "Open the original article for details.";

  const tags = document.createElement("div");
  tags.className = "article-tags";

  item.topics.forEach(topic => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = topic;
    tags.append(tag);
  });

  card.append(metadata, heading, summary, tags);

  if (item.url) {
    const link = document.createElement("a");
    link.className = "article-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Read original article";
    card.append(link);
  }

  return card;
}

function renderArticles() {
  const visibleItems = digest.items.filter(item => {
    if (selectedTopics.size === 0) return true;

    return item.topics.some(topic => selectedTopics.has(topic));
  });

  elements.articles.replaceChildren();

  const fragment = document.createDocumentFragment();

  visibleItems.forEach(item => {
    fragment.append(createArticleCard(item));
  });

  elements.articles.append(fragment);

  elements.count.textContent =
    `${visibleItems.length} of ${digest.items.length} articles`;

  if (!digest.items.length) {
    setMessage("No articles were published in this digest.");
  } else if (!visibleItems.length) {
    setMessage(
      "No articles match your selected topics. Choose Show all to reset."
    );
  } else {
    setMessage("");
  }
}

async function loadDigest() {
  if (loading) return;

  loading = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Refreshing...";
  elements.articles.setAttribute("aria-busy", "true");

  if (!digest) {
    setMessage("Loading your digest...");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(DIGEST_URL, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    digest = normalizeDigest(await response.json());

    elements.updatedAt.textContent =
      `Digest generated: ${formatDate(digest.generated_at)}`;

    renderTopicFilters();
    renderArticles();
  } catch (error) {
    console.error("Failed to load digest:", error);

    setMessage(
      digest
        ? "Could not refresh. The previously loaded digest is still shown."
        : "Could not load the digest. Check your connection and confirm " +
          "that data/latest.json has been published.",
      true
    );

    if (!digest) {
      elements.updatedAt.textContent = "Digest unavailable";
    }
  } finally {
    clearTimeout(timeout);
    loading = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Refresh";
    elements.articles.setAttribute("aria-busy", "false");
    updateConnectionStatus();
  }
}

elements.refresh.addEventListener("click", loadDigest);

elements.clearFilters.addEventListener("click", () => {
  selectedTopics.clear();
  savePreferences();

  if (digest) {
    renderTopicFilters();
    renderArticles();
  }
});

window.addEventListener("online", () => {
  updateConnectionStatus();
  loadDigest();
});

window.addEventListener("offline", updateConnectionStatus);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js", {
        updateViaCache: "none"
      });
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

updateConnectionStatus();
loadDigest();
