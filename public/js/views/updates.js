// "Sprout Updates": posts about the Sprout app itself, kept separate from the news feed.
import { api, isOwner } from "../api.js";
import { esc, icon } from "../ui.js";

const PAGE = 15;

const entryHTML = (a) => {
  const d = new Date(a.publishedAt);
  return `
    <a class="update-entry fade-in" href="/article/${encodeURIComponent(a.slug)}">
      <time class="update-date" datetime="${esc(a.publishedAt)}">
        <span class="m">${esc(d.toLocaleDateString(undefined, { month: "short" }))}</span>
        <span class="d">${d.getDate()}</span>
        <span class="y">${d.getFullYear()}</span>
      </time>
      <div class="update-body">
        <h2>${esc(a.title)}</h2>
        ${a.dek ? `<p>${esc(a.dek)}</p>` : ""}
        <span class="update-more">Read update ${icon("back")}</span>
      </div>
    </a>`;
};

export async function updatesView(main, { isCurrent }) {
  document.title = "Sprout Updates · Sprout";
  main.innerHTML = `
    <div class="container narrow page">
      <header class="updates-hero fade-in">
        <span class="updates-badge">${icon("sprout")} From the Sprout team</span>
        <h1 class="page-title">Sprout Updates</h1>
        <p class="muted">New features, improvements and announcements about the Sprout app. This is separate from the news feed.</p>
        ${isOwner() ? `<a class="btn btn-sm btn-primary" href="/studio/new?section=sprout">${icon("plus")} Post an update</a>` : ""}
      </header>
      <div id="updates"><div class="update-entry"><div class="update-date skeleton" style="height:64px"></div><div class="update-body"><div class="skeleton sk-line" style="width:60%"></div><div class="skeleton sk-line"></div></div></div></div>
    </div>`;

  const list = main.querySelector("#updates");
  const load = (offset) => api(`/articles?section=sprout&limit=${PAGE}&offset=${offset}`);
  const { articles, hasMore } = await load(0);
  if (!isCurrent()) return;
  if (!articles.length) {
    list.innerHTML = `<div class="empty fade-in"><img src="/img/logo-v2.png" alt="" /><h2>No updates yet</h2><p>News about the Sprout app will appear here.</p>${
      isOwner() ? `<a class="btn btn-primary" href="/studio/new?section=sprout">${icon("plus")} Post the first update</a>` : ""
    }</div>`;
    return;
  }
  list.innerHTML = `<div class="update-list">${articles.map(entryHTML).join("")}</div>${hasMore ? `<div class="load-more"><button class="btn" id="more">Older updates</button></div>` : ""}`;
  let offset = articles.length;
  list.querySelector("#more")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const page = await load(offset);
      offset += page.articles.length;
      list.querySelector(".update-list").insertAdjacentHTML("beforeend", page.articles.map(entryHTML).join(""));
      if (!page.hasMore) btn.parentElement.remove();
    } finally {
      btn.disabled = false;
    }
  });
}
