import yaml
import feedparser
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
import calendar

CONFIG = Path("config.yaml")

def load_config():
    with CONFIG.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def matches_topics(text, topics):
    text = (text or "").lower()
    matched = []
    score = 0

    for topic in topics:
        hits = sum(keyword.lower() in text for keyword in topic["keywords"])
        if hits:
            matched.append(topic["name"])
            score += hits * topic.get("weight", 1)

    return matched, score

def collect_articles(config):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=config["digest_hours"])
    articles = {}

    for source in config["sources"]:
        feed = feedparser.parse(source["url"])
        print(
            f"\nSource: {source['name']} | "
            f"Status: {feed.get('status', 'unknown')} | "
            f"Entries: {len(feed.entries)}"
        )

        for entry in feed.entries:
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            published = entry.get("published_parsed") or entry.get("updated_parsed")

            if not title or not link:
                continue

            if published:
                published_dt = datetime.fromtimestamp(
                    calendar.timegm(published),
                    tz=timezone.utc,
                )
                print(f"Article: {title}")
                print(f"Published: {published_dt} | Cutoff: {cutoff}")

                if published_dt < cutoff:
                    continue

            summary = entry.get("summary", "") or entry.get("description", "")
            text = f"{title} {summary}"
            matched, score = matches_topics(text, config["topics"])
            print(f"Topic matches: {matched}")
            if not matched:
                continue

            # Keep one version per URL.
            articles[link] = {
                "title": title,
                "link": link,
                "source": source["name"],
                "summary": summary,
                "topics": matched,
                "score": score,
            }

    ranked = sorted(
        articles.values(),
        key=lambda a: a["score"],
        reverse=True
    )

    return ranked[: config["max_articles"]]

def summarize(articles, config):
    if not articles:
        return "No new articles matched your configured topics."

    bullets = "\n".join(
        f"- {a['title']} — {a['source']}\n  {a['link']}\n  Topics: {', '.join(a['topics'])}"
        for a in articles
    )

    prompt = f"""Summarize the following AI-news items for a busy reader.
Group them by topic when useful. Be concise, factual, and avoid speculation.
For each important item, include its source and link.

Articles:
{bullets}
"""

    response = requests.post(
        "http://localhost:11434/api/chat",
        json={
            "model": config["model"],
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"num_ctx": 8192},
        },
        timeout=300,
    )

    response.raise_for_status()
    return response.json()["message"]["content"]

def write_digest(config, articles, summary):
    output = Path(config["output_file"])
    output.parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    links = "\n".join(
        f"- [{a['title']}]({a['link']}) — {a['source']}"
        for a in articles
    )

    output.write_text(
        f"# AI News Digest — {now}\n\n{summary}\n\n## Links\n\n{links}\n",
        encoding="utf-8",
    )

def main():
    config = load_config()
    articles = collect_articles(config)
    summary = summarize(articles, config)
    write_digest(config, articles, summary)
    print(f"Wrote {len(articles)} articles to {config['output_file']}")

if __name__ == "__main__":
    main()