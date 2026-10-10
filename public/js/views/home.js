import { api, state, isOwner } from "../api.js";
import { esc, icon, media, timeAgo, sourceLabel } from "../ui.js";

const PAGE = 13; // 1 lead + 12 cards

const metaLine = (a) =>
  `<div class="meta"><span>${esc(sourceLabel(a))}</span><span class="dot"></span><span>${esc(timeAgo(a.publishedAt))}</span><span class="dot"></span><span>${a.readingMinutes} min read</span></div>`;

export const cardHTML = (a) => `
  <a class="card fade-in" href="/article/${encodeURIComponent(a.slug)}">
    ${media(a.coverImage)}
    <div class="body">
      <span class="tag">${esc(a.category)}</span>
      <h3>${esc(a.title)}</h3>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ""}
      ${metaLine(a)}
    </div>
  </a>`;

const leadHTML = (a) => `
  <a class="lead fade-in" href="/article/${encodeURIComponent(a.slug)}">
    ${media(a.coverImage)}
    <div class="body">
      <span class="tag">${esc(a.category)} · Top story</span>
      <h2>${esc(a.title)}</h2>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ""}
      ${metaLine(a)}
    </div>
  </a>`;

const skeletonGrid = () => `
  <div class="lead"><div class="media skeleton" style="border-radius:0"></div><div class="body"><div class="skeleton sk-line" style="width:30%"></div><div class="skeleton" style="height:30px;width:90%"></div><div class="skeleton" style="height:30px;width:70%"></div><div class="skeleton sk-line" style="width:60%"></div></div></div>
  <div class="grid">${'<div class="card"><div class="media skeleton" style="border-radius:0"></div><div class="body"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line" style="width:75%"></div></div></div>'.repeat(6)}</div>`;

function emptyState(category) {
  if (category) {
    return `<div class="empty fade-in"><img src="/img/logo.png" alt="" /><h2>No ${esc(category)} stories yet</h2><p>Check back soon — new stories are always sprouting.</p><a class="btn" href="/">See all news</a></div>`;
  }
  if (isOwner()) {
    return `<div class="empty fade-in"><img src="/img/logo.png" alt="" /><h2>Your newsroom is ready</h2><p>Publish your first story — write one from scratch or import from BBC, CNN, CBS News or The New York Times.</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn btn-primary" href="/studio/new">${icon("pen")} Write article</a><a class="btn" href="/studio/import">${icon("download")} Import article</a></div></div>`;
  }
  if (!state.config?.hasOwner) {
    return `<div class="empty fade-in"><img src="/img/logo.png" alt="" /><h2>Welcome to Sprout</h2><p>This newsroom hasn't been set up yet. The first account created becomes the owner and can publish stories.</p><a class="btn btn-primary" href="/signup">Create the owner account</a></div>`;
  }
  return `<div class="empty fade-in"><img src="/img/logo.png" alt="" /><h2>No stories yet</h2><p>The first headlines are on their way. Check back soon.</p></div>`;
}

function installBanner() {
  if (!state.installPrompt) return "";
  return `<div class="install-banner fade-in" id="install-banner"><div class="l"><img src="/icons/icon-192.png" alt="" /><div><strong>Install Sprout</strong><div class="muted">Add it to your home screen for a faster, app-like experience.</div></div></div><button class="btn btn-sm btn-primary" type="button" id="install-btn">Install</button></div>`;
}

function wireInstall(root) {
  const btn = root.querySelector("#install-btn");
  btn?.addEventListener("click", async () => {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => {});
    state.installPrompt = null;
    root.querySelector("#install-banner")?.remove();
  });
}

export async function homeView(main, { query, isCurrent }) {
  const category = query.get("category") || "";
  const cats = state.config?.categories || [];
  document.title = category ? `${category} · Sprout` : "Sprout — News, freshly grown";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  main.innerHTML = `
    <div class="container page">
      <div id="install-slot">${installBanner()}</div>
      <div class="page-head">
        <div><div class="date-line">${esc(today)}</div><h1 class="page-title">${category ? esc(category) : "Today's news"}</h1></div>
        ${isOwner() ? `<a class="btn btn-sm" href="/studio/new">${icon("plus")} New story</a>` : ""}
      </div>
      <div class="chips home-chips" role="tablist" aria-label="Categories">
        <a class="chip ${category ? "" : "active"}" href="/">All</a>
        ${cats.map((c) => `<a class="chip ${c === category ? "active" : ""}" href="/?category=${encodeURIComponent(c)}">${esc(c)}</a>`).join("")}
      </div>
      <div id="feed">${skeletonGrid()}</div>
    </div>`;
  wireInstall(main);
  const onInstallable = () => {
    const slot = main.querySelector("#install-slot");
    if (slot && !slot.innerHTML.trim()) {
      slot.innerHTML = installBanner();
      wireInstall(main);
    }
  };
  document.addEventListener("sprout:installable", onInstallable, { once: true });

  const feed = main.querySelector("#feed");
  let offset = 0;
  const qs = (o) => `/articles?limit=${PAGE}&offset=${o}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  const { articles, hasMore } = await api(qs(0));
  if (!isCurrent()) return;
  if (!articles.length) {
    feed.innerHTML = emptyState(category);
    return;
  }
  const [lead, ...rest] = articles;
  feed.innerHTML = `${leadHTML(lead)}<div class="grid" id="grid">${rest.map(cardHTML).join("")}</div>${hasMore ? `<div class="load-more"><button class="btn" id="more">Load more stories</button></div>` : ""}`;
  offset = articles.length;

  feed.querySelector("#more")?.addEventListener("click", async function onMore(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Loading`;
    try {
      const page = await api(qs(offset));
      offset += page.articles.length;
      feed.querySelector("#grid").insertAdjacentHTML("beforeend", page.articles.map(cardHTML).join(""));
      if (!page.hasMore) btn.parentElement.remove();
      else {
        btn.disabled = false;
        btn.textContent = "Load more stories";
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Try again";
    }
  });
}

export async function searchView(main, { query, isCurrent }) {
  document.title = "Search · Sprout";
  const q = query.get("q") || "";
  main.innerHTML = `
    <div class="container page narrow">
      <h1 class="page-title" style="margin-bottom:18px">Search</h1>
      <form class="search-box" role="search">${icon("search")}<input class="input" name="q" type="search" placeholder="Search headlines…" value="${esc(q)}" autocomplete="off" aria-label="Search headlines" /></form>
      <div id="results"></div>
    </div>`;
  const input = main.querySelector("input");
  const results = main.querySelector("#results");
  if (!q) input.focus();

  let timer;
  const run = async (term) => {
    history.replaceState(null, "", term ? `/search?q=${encodeURIComponent(term)}` : "/search");
    if (!term) {
      results.innerHTML = `<p class="muted">Type to search all published stories.</p>`;
      return;
    }
    results.innerHTML = `<p class="muted"><span class="spinner" style="display:inline-block;vertical-align:middle"></span> Searching…</p>`;
    const { articles } = await api(`/articles?limit=30&q=${encodeURIComponent(term)}`);
    if (!isCurrent() || input.value.trim() !== term) return;
    results.innerHTML = articles.length
      ? `<div class="grid grid-2">${articles.map(cardHTML).join("")}</div>`
      : `<div class="empty"><h2>No results</h2><p>Nothing matched “${esc(term)}”. Try a different keyword.</p></div>`;
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()).catch(() => {}), 250);
  });
  main.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(input.value.trim()).catch(() => {});
  });
  await run(q);
}
