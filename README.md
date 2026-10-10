# 🌱 Sprout

A clean, modern news app with AI summaries. It installs as a PWA and deploys to Railway.

- **Read freely.** You don't need an account to browse or read.
- **AI summaries for members.** Signed-in readers get a one-tap AI summary at the top of every article. Summaries are generated with Google Gemini and cached per article.
- **Owner studio.** The **first account ever created** becomes the owner. Only the owner can:
  - **Import** stories from **BBC News, CNN, CBS News or The New York Times**. Pick an outlet and section and browse its live headlines, or paste an article link. The story opens in the editor for review before you publish, and it always links back to the original.
  - **Write** original articles from scratch in Markdown, with a live preview.
  - Edit, unpublish (draft) or delete any article.
- **Dark and light themes.** Dark is the default. The choice is remembered per device.
- **Geist Mono everywhere.** Bold for titles and headings, SemiBold for text. The font is self-hosted.
- **Installable PWA.** Includes a manifest, maskable icons and an offline app shell. Articles you've already read stay available offline.

## Run locally

```bash
npm install
cp .env.example .env   # optional, add GEMINI_API_KEY for AI summaries
node --env-file-if-exists=.env src/server.js
# → http://localhost:3000
```

Open the app and click **Sign in → Create an account**. The first account becomes the owner and goes straight to the Studio.

## Deploy to Railway

1. Push this repo to GitHub, then in Railway choose **New Project → Deploy from GitHub repo**.
2. Add a database so accounts and articles survive redeploys. Pick one:
   - **Postgres (recommended):** add a PostgreSQL service and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the Sprout service.
   - **SQLite + Volume:** attach a Volume (for example at `/data`) and set `DATA_DIR=/data`.
3. Set `GEMINI_API_KEY` to enable AI summaries. You can get a key from [Google AI Studio](https://aistudio.google.com/apikey).
4. Under **Settings → Networking**, generate a domain.

`railway.json` sets the start command and a health check at `/api/health`. `PORT` is read from the environment.

> ⚠️ Without a database or volume, Railway's filesystem is wiped on every deploy, and accounts and articles go with it.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (Railway sets this automatically). |
| `GEMINI_API_KEY` | Enables AI summaries. |
| `GEMINI_MODEL` | Optional model override (default `gemini-flash-latest`). |
| `DATABASE_URL` | Use PostgreSQL. If unset, SQLite is used. |
| `DATA_DIR` | Where the SQLite file lives (default `./data`). |

## Project layout

```
src/
  server.js     Express app: API routes, security headers, static/SPA serving
  db.js         One async API over Postgres (DATABASE_URL) or SQLite
  auth.js       Accounts (bcrypt), cookie sessions, first-account-is-owner
  sources.js    BBC / CNN / CBS / NYT feeds + article extraction (Readability)
  summarize.js  Gemini summaries with per-article caching
public/
  index.html, css/app.css, js/…   Vanilla-JS single-page app (no build step)
  sw.js, manifest.webmanifest     PWA
  icons/, img/logo.png, fonts/    App icon, in-app logo, Geist Mono
```

## A note on imported content

Imported articles keep their byline, a source badge and a "Read on …" link back to the outlet. Republishing the full text of copyrighted articles may need permission from the publisher, so make sure you have the rights to the content you publish. Some sites, especially paywalled NYT stories, may only give a partial extract. When that happens the editor warns you so you can edit before publishing.
