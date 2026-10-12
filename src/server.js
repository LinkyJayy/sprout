import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { db, getSetting, isUniqueViolation, now, setSetting } from "./db.js";
import {
  createUser,
  endSession,
  loadUser,
  publicUser,
  pruneSessions,
  requireOwner,
  requireUser,
  startSession,
  verifyLogin,
} from "./auth.js";
import { extractArticle, getFeed, listSources, SOURCES } from "./sources.js";
import { aiEnabled, getCachedSummary, summarizeArticle } from "./summarize.js";
import { getStreak, recordRead, resolveToday } from "./streaks.js";
import { notifyPublished, publicKey, removeSubscription, saveSubscription } from "./push.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PACKAGE_VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

export const CATEGORIES = ["World", "U.S.", "Politics", "Business", "Technology", "Science", "Health", "Culture", "Sports"];

app.set("trust proxy", 1); // Railway sits behind a proxy
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  next();
});
app.use(loadUser);

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });

function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (n > max) return res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
    next();
  };
}

const renderMarkdown = (md) =>
  sanitizeHtml(marked.parse(md || "", { gfm: true, breaks: false }), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "figure", "figcaption", "h1", "h2"]),
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      img: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, loading: "lazy", referrerpolicy: "no-referrer" } }),
    },
  });

const readingMinutes = (md) => Math.max(1, Math.round((md || "").split(/\s+/).filter(Boolean).length / 230));

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";

function articleCard(a) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    dek: a.dek,
    category: a.category,
    coverImage: a.cover_image,
    author: a.author,
    source: a.source,
    sourceName: a.source_name,
    status: a.status,
    section: a.section || "news",
    publishedAt: a.published_at,
    readingMinutes: readingMinutes(a.body_md),
  };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpUrl = (v) => {
  const s = str(v, 2000);
  return /^https?:\/\/\S+$/i.test(s) ? s : "";
};

function validateArticle(body) {
  const a = {
    title: str(body.title, 300),
    dek: str(body.dek, 600),
    body_md: str(body.body_md, 200_000),
    category: CATEGORIES.includes(body.category) ? body.category : "World",
    cover_image: httpUrl(body.cover_image),
    author: str(body.author, 200),
    source: SOURCES[body.source] ? body.source : "original",
    source_url: httpUrl(body.source_url),
    status: body.status === "draft" ? "draft" : "published",
    section: body.section === "sprout" ? "sprout" : "news",
    published_at:
      body.published_at && !Number.isNaN(Date.parse(body.published_at)) ? new Date(body.published_at).toISOString() : now(),
  };
  if (a.section === "sprout") {
    // Sprout updates are about the app itself: always original, never filed under a news category.
    Object.assign(a, { category: "Sprout", source: "original", source_url: "" });
  }
  a.source_name = a.source === "original" ? "Sprout" : SOURCES[a.source].name;
  if (!a.title) throw httpError(400, "A headline is required.");
  if (!a.body_md) throw httpError(400, "The article body can't be empty.");
  return a;
}

function notifyInBackground(article) {
  notifyPublished(article).catch((err) => console.error("[sprout] push notify failed:", err));
}

const DEFAULT_ABOUT = `## What is Sprout?

Sprout is a clean, modern news app. Read the day's top stories without the clutter: no account needed.

## What you can do

- **Read freely.** Every story is free to read, no sign-up required.
- **Get the gist fast.** Create a free account to unlock short AI summaries at the top of every news story.
- **Build a reading streak.** Read at least one story a day to keep your streak growing.
- **Stay in the loop.** Turn on notifications to hear about new stories the moment they're published.
- **Take it with you.** Install Sprout to your home screen for a fast, app-like experience that even works offline.

## Where the news comes from

Sprout publishes original stories and carefully selected reporting from trusted outlets, always credited and linked back to the original source.`;

async function appVersion() {
  return (await getSetting("app_version")) || PACKAGE_VERSION;
}

// ---------- system ----------
app.get("/api/health", (_req, res) => res.json({ ok: true, db: db.kind }));

app.get(
  "/api/config",
  wrap(async (req, res) => {
    const owner = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'");
    res.json({ version: await appVersion(), hasOwner: Number(owner.n) > 0, aiEnabled: aiEnabled(), categories: CATEGORIES, user: publicUser(req.user) });
  })
);

// ---------- auth ----------
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.post(
  "/api/auth/signup",
  authLimiter,
  wrap(async (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!name) throw httpError(400, "Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Please enter a valid email address.");
    if (password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
    if (password.length > 200) throw httpError(400, "Password is too long.");
    const user = await createUser({ name, email, password });
    await startSession(req, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  })
);

app.post(
  "/api/auth/login",
  authLimiter,
  wrap(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = await verifyLogin(email, password);
    if (!user) throw httpError(401, "Incorrect email or password.");
    await startSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  })
);

app.post(
  "/api/auth/logout",
  wrap(async (req, res) => {
    await endSession(req, res);
    res.json({ ok: true });
  })
);

app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- reading streaks ----------
app.get(
  "/api/streak",
  requireUser,
  wrap(async (req, res) => {
    res.json({ streak: await getStreak(req.user.id, resolveToday(req.query.today)) });
  })
);

app.post(
  "/api/streak/read",
  requireUser,
  wrap(async (req, res) => {
    // Only opening a real, published article counts toward the streak.
    const slug = str(req.body?.slug, 200);
    const article = slug && (await db.get("SELECT id FROM articles WHERE slug = ? AND status = 'published'", [slug]));
    if (!article) throw httpError(404, "Article not found.");
    res.json({ streak: await recordRead(req.user.id, resolveToday(req.body?.today)) });
  })
);

// ---------- push notifications ----------
const pushLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

app.get(
  "/api/push/key",
  wrap(async (_req, res) => res.json({ publicKey: await publicKey() }))
);

app.post(
  "/api/push/subscribe",
  pushLimiter,
  wrap(async (req, res) => {
    await saveSubscription(req.body?.subscription, req.user?.id);
    res.status(201).json({ ok: true });
  })
);

app.post(
  "/api/push/unsubscribe",
  pushLimiter,
  wrap(async (req, res) => {
    await removeSubscription(req.body?.endpoint);
    res.json({ ok: true });
  })
);

// ---------- about ----------
app.get(
  "/api/about",
  wrap(async (_req, res) => {
    const md = await getSetting("about_md", DEFAULT_ABOUT);
    const [stories, updates, members, latest] = await Promise.all([
      db.get("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND section = 'news'"),
      db.get("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND section = 'sprout'"),
      db.get("SELECT COUNT(*) AS n FROM users"),
      db.get("SELECT * FROM articles WHERE status = 'published' AND section = 'sprout' ORDER BY published_at DESC LIMIT 1"),
    ]);
    res.json({
      version: await appVersion(),
      body_md: md,
      html: renderMarkdown(md),
      updatedAt: await getSetting("about_updated_at"),
      stats: { stories: Number(stories.n), updates: Number(updates.n), members: Number(members.n) },
      latestUpdate: latest ? articleCard(latest) : null,
    });
  })
);

// ---------- public articles ----------
app.get(
  "/api/articles",
  wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = ["status = 'published'", "section = ?"];
    const params = [req.query.section === "sprout" ? "sprout" : "news"];
    if (CATEGORIES.includes(req.query.category)) {
      where.push("category = ?");
      params.push(req.query.category);
    }
    const q = str(req.query.q, 100);
    if (q) {
      where.push("(LOWER(title) LIKE ? OR LOWER(dek) LIKE ?)");
      params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }
    const rows = await db.all(
      `SELECT * FROM articles WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      [...params, limit + 1, offset]
    );
    res.json({ articles: rows.slice(0, limit).map(articleCard), hasMore: rows.length > limit });
  })
);

async function findArticle(slug, req) {
  const a = await db.get("SELECT * FROM articles WHERE slug = ?", [slug]);
  if (!a || (a.status !== "published" && req.user?.role !== "owner")) throw httpError(404, "Article not found.");
  return a;
}

app.get(
  "/api/articles/:slug",
  wrap(async (req, res) => {
    const a = await findArticle(req.params.slug, req);
    const summary = req.user ? await getCachedSummary(a) : null;
    res.json({
      article: { ...articleCard(a), sourceUrl: a.source_url, updatedAt: a.updated_at, html: renderMarkdown(a.body_md) },
      summary,
    });
  })
);

const summaryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: (req) => `u${req.user?.id}` });

app.post(
  "/api/articles/:slug/summary",
  requireUser,
  summaryLimiter,
  wrap(async (req, res) => {
    const a = await findArticle(req.params.slug, req);
    if (a.section === "sprout") throw httpError(400, "AI summaries are only available for news stories.");
    res.json(await summarizeArticle(a));
  })
);

// ---------- owner studio ----------
const studio = express.Router();
studio.use(requireOwner);

studio.get("/sources", (_req, res) => res.json({ sources: listSources() }));

studio.get(
  "/sources/:id/feed",
  wrap(async (req, res) => {
    res.json({ items: await getFeed(req.params.id, str(req.query.section, 30) || "top") });
  })
);

studio.post(
  "/extract",
  wrap(async (req, res) => {
    res.json({ draft: await extractArticle(str(req.body.url, 2000)) });
  })
);

studio.put(
  "/about",
  wrap(async (req, res) => {
    const version = str(req.body?.version, 40);
    const md = str(req.body?.body_md, 50_000);
    if (!version) throw httpError(400, "Please enter a version.");
    if (!md) throw httpError(400, "The About text can't be empty.");
    await setSetting("app_version", version);
    await setSetting("about_md", md);
    await setSetting("about_updated_at", now());
    res.json({ ok: true });
  })
);

studio.post("/preview", (req, res) => res.json({ html: renderMarkdown(str(req.body.body_md, 200_000)) }));

studio.get(
  "/articles",
  wrap(async (_req, res) => {
    const rows = await db.all("SELECT * FROM articles ORDER BY updated_at DESC LIMIT 200");
    res.json({ articles: rows.map(articleCard) });
  })
);

studio.get(
  "/articles/:id",
  wrap(async (req, res) => {
    const a = await db.get("SELECT * FROM articles WHERE id = ?", [Number(req.params.id)]);
    if (!a) throw httpError(404, "Article not found.");
    res.json({ article: a });
  })
);

studio.post(
  "/articles",
  wrap(async (req, res) => {
    const a = validateArticle(req.body);
    const base = slugify(a.title);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
      try {
        const row = await db.get(
          `INSERT INTO articles (slug, title, dek, body_md, category, cover_image, author, source, source_name, source_url, status, section, published_at, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          [slug, a.title, a.dek, a.body_md, a.category, a.cover_image, a.author, a.source, a.source_name, a.source_url, a.status, a.section, a.published_at, now(), now(), req.user.id]
        );
        if (row.status === "published") notifyInBackground(row);
        return res.status(201).json({ article: articleCard(row) });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw httpError(500, "Couldn't generate a unique link for this article.");
  })
);

studio.put(
  "/articles/:id",
  wrap(async (req, res) => {
    const a = validateArticle(req.body);
    const row = await db.get(
      `UPDATE articles SET title = ?, dek = ?, body_md = ?, category = ?, cover_image = ?, author = ?, source = ?, source_name = ?, source_url = ?, status = ?, section = ?, published_at = ?, updated_at = ?
       WHERE id = ? RETURNING *`,
      [a.title, a.dek, a.body_md, a.category, a.cover_image, a.author, a.source, a.source_name, a.source_url, a.status, a.section, a.published_at, now(), Number(req.params.id)]
    );
    if (!row) throw httpError(404, "Article not found.");
    // A draft being published for the first time notifies; edits to live articles don't (notified_at guards it).
    if (row.status === "published") notifyInBackground(row);
    res.json({ article: articleCard(row) });
  })
);

studio.delete(
  "/articles/:id",
  wrap(async (req, res) => {
    const r = await db.run("DELETE FROM articles WHERE id = ?", [Number(req.params.id)]);
    if (!r.changes) throw httpError(404, "Article not found.");
    res.json({ ok: true });
  })
);

app.use("/api/studio", studio);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// ---------- static + SPA ----------
const pub = join(root, "public");
app.get("/sw.js", (_req, res) => {
  res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
  res.sendFile(join(pub, "sw.js"));
});
app.use(
  express.static(pub, {
    index: false,
    setHeaders(res, path) {
      if (/\/(fonts|icons|img)\//.test(path)) res.set("Cache-Control", "public, max-age=2592000, immutable");
      else res.set("Cache-Control", "no-cache");
      if (path.endsWith(".webmanifest")) res.type("application/manifest+json");
    },
  })
);
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(join(pub, "index.html"));
});

// ---------- errors ----------
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (!err.status && !err.statusCode) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? "Something went wrong." : err.message });
});

pruneSessions().catch(() => {});
setInterval(() => pruneSessions().catch(() => {}), 6 * 60 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌱 Sprout running on http://localhost:${PORT} (${db.kind})`);
});
