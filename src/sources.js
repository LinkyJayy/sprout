// News sources the owner can import from: BBC, CNN, CBS News and The New York Times.
// Listing uses each outlet's public RSS feeds (CNN uses its text-only "lite" site,
// as its RSS feeds are no longer updated). Importing fetches the article page and
// extracts the readable content with Mozilla Readability.
import { XMLParser } from "fast-xml-parser";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export const SOURCES = {
  bbc: {
    name: "BBC News",
    hosts: ["bbc.co.uk", "bbc.com"],
    sections: {
      top: "https://feeds.bbci.co.uk/news/rss.xml",
      world: "https://feeds.bbci.co.uk/news/world/rss.xml",
      business: "https://feeds.bbci.co.uk/news/business/rss.xml",
      technology: "https://feeds.bbci.co.uk/news/technology/rss.xml",
      science: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      health: "https://feeds.bbci.co.uk/news/health/rss.xml",
    },
  },
  cnn: {
    name: "CNN",
    hosts: ["cnn.com"],
    sections: {
      top: "lite:https://lite.cnn.com/",
      world: "https://rss.cnn.com/rss/edition_world.rss",
      business: "https://rss.cnn.com/rss/money_latest.rss",
      technology: "https://rss.cnn.com/rss/edition_technology.rss",
    },
  },
  cbs: {
    name: "CBS News",
    hosts: ["cbsnews.com"],
    sections: {
      top: "https://www.cbsnews.com/latest/rss/main",
      world: "https://www.cbsnews.com/latest/rss/world",
      us: "https://www.cbsnews.com/latest/rss/us",
      politics: "https://www.cbsnews.com/latest/rss/politics",
      business: "https://www.cbsnews.com/latest/rss/moneywatch",
      technology: "https://www.cbsnews.com/latest/rss/technology",
      health: "https://www.cbsnews.com/latest/rss/health",
    },
  },
  nyt: {
    name: "The New York Times",
    hosts: ["nytimes.com"],
    sections: {
      top: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
      world: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
      us: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
      politics: "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
      business: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      technology: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
      science: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
      health: "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml",
    },
  },
};

export const listSources = () =>
  Object.entries(SOURCES).map(([id, s]) => ({ id, name: s.name, sections: Object.keys(s.sections) }));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn(`[sprout] fetch ${url} failed:`, err.cause?.code || err.message);
    throw Object.assign(new Error("Couldn't reach the news source. Please try again."), { status: 502 });
  }
  if (!res.ok) throw Object.assign(new Error(`Source responded with ${res.status}`), { status: 502 });
  return { text: await res.text(), url: res.url };
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const text = (v) => (typeof v === "object" && v !== null ? v["#text"] ?? "" : v ?? "").toString().trim();
const stripTags = (s) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function parseRss(body) {
  const doc = xml.parse(body);
  let items = doc?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return items
    .map((it) => {
      const media = it["media:content"] ?? it["media:thumbnail"];
      const firstMedia = Array.isArray(media) ? media[media.length - 1] : media;
      return {
        title: stripTags(text(it.title)),
        url: text(it.link) || text(it.guid),
        summary: stripTags(text(it.description)),
        publishedAt: it.pubDate ? new Date(text(it.pubDate)).toISOString() : null,
        image: firstMedia?.["@url"] || it.enclosure?.["@url"] || "",
      };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.url));
}

function parseCnnLite(body, base) {
  const dom = new JSDOM(body, { url: base });
  const seen = new Set();
  return [...dom.window.document.querySelectorAll("a[href]")]
    .map((a) => ({ title: a.textContent.trim(), href: a.href }))
    .filter((a) => /\/\d{4}\/\d{2}\/\d{2}\//.test(a.href) && a.title && !seen.has(a.href) && seen.add(a.href))
    .map((a) => ({
      title: a.title,
      url: a.href.replace("lite.cnn.com", "www.cnn.com"),
      summary: "",
      publishedAt: (() => {
        const m = a.href.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toISOString() : null;
      })(),
      image: "",
    }));
}

const feedCache = new Map();
const FEED_TTL = 5 * 60 * 1000;

export async function getFeed(sourceId, section = "top") {
  const source = SOURCES[sourceId];
  if (!source) throw Object.assign(new Error("Unknown source."), { status: 400 });
  const feedUrl = source.sections[section] ?? source.sections.top;
  const key = `${sourceId}:${section}`;
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.at < FEED_TTL) return cached.items;

  let items;
  if (feedUrl.startsWith("lite:")) {
    const { text: body, url } = await fetchText(feedUrl.slice(5));
    items = parseCnnLite(body, url);
  } else {
    items = parseRss((await fetchText(feedUrl)).text);
  }
  items = items.slice(0, 40);
  feedCache.set(key, { at: Date.now(), items });
  return items;
}

export function sourceForUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  for (const [id, s] of Object.entries(SOURCES)) {
    if (s.hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return { id, ...s, url };
  }
  return null;
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "form", "button", "svg"]);

const meta = (doc, ...names) => {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    if (el?.content) return el.content.trim();
  }
  return "";
};

// Fetches an article from one of the supported outlets and returns an editable draft.
export async function extractArticle(rawUrl) {
  const source = sourceForUrl(rawUrl);
  if (!source) {
    throw Object.assign(new Error("Only BBC, CNN, CBS News and New York Times links can be imported."), {
      status: 400,
    });
  }
  const { text: html, url: finalUrl } = await fetchText(source.url.toString());
  if (!sourceForUrl(finalUrl)) throw Object.assign(new Error("The link redirected to an unsupported site."), { status: 400 });

  const virtualConsole = new VirtualConsole(); // swallow CSS parse noise
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole });
  const doc = dom.window.document;

  const image = meta(doc, "og:image", "twitter:image");
  const publishedAt = meta(doc, "article:published_time", "og:article:published_time", "date", "pubdate");
  const metaDescription = meta(doc, "og:description", "description", "twitter:description");
  const metaTitle = meta(doc, "og:title", "twitter:title");

  const parsed = new Readability(doc, { charThreshold: 300 }).parse();
  let body = parsed?.content ? turndown.turndown(parsed.content) : "";
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const title = (metaTitle || parsed?.title || "").replace(/\s+[-|–]\s+(BBC News|CNN.*|CBS News|The New York Times)$/i, "").trim();
  return {
    title,
    dek: metaDescription || parsed?.excerpt || "",
    body_md: body,
    cover_image: image,
    author: (parsed?.byline || meta(doc, "author") || "").replace(/^By\s+/i, "").trim(),
    source: source.id,
    source_name: source.name,
    source_url: finalUrl,
    published_at: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString() : null,
    partial: body.length < 400, // paywalled or script-rendered pages may only yield a teaser
  };
}
