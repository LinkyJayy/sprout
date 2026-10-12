// About page: what Sprout is, the current version and a few live stats. The owner can edit it in place.
import { api, state, isOwner } from "../api.js";
import { esc, icon, toast, fullDate } from "../ui.js";

export async function aboutView(main, { isCurrent }) {
  document.title = "About · Sprout";
  main.innerHTML = `<div class="container narrow page"><div class="skeleton" style="height:180px;border-radius:18px"></div><div class="skeleton sk-line" style="margin-top:28px"></div><div class="skeleton sk-line" style="width:80%"></div></div>`;
  const about = await api("/about");
  if (!isCurrent()) return;
  renderView(main, about);
}

function renderView(main, about) {
  const { version, html, stats, latestUpdate, updatedAt } = about;
  const n = (v) => Number(v).toLocaleString();
  main.innerHTML = `
    <div class="container narrow page fade-in">
      <header class="about-hero">
        <img class="about-logo" src="/img/logo.png" alt="" />
        <div class="about-id">
          <h1>Sprout</h1>
          <p class="muted">News, freshly grown.</p>
          <div class="about-meta">
            <span class="badge badge-accent">Version ${esc(version)}</span>
            ${updatedAt ? `<span class="faint">Page updated ${esc(fullDate(updatedAt).split(" at ")[0])}</span>` : ""}
          </div>
        </div>
        ${isOwner() ? `<button class="btn btn-sm about-edit" id="edit" type="button">${icon("pen")} Edit page</button>` : ""}
      </header>

      <div class="about-stats">
        <div><strong>${n(stats.stories)}</strong><span>News stories</span></div>
        <div><strong>${n(stats.updates)}</strong><span>App updates</span></div>
        <div><strong>${n(stats.members)}</strong><span>Members</span></div>
      </div>

      ${
        latestUpdate
          ? `<a class="about-latest" href="/article/${encodeURIComponent(latestUpdate.slug)}">
              <span class="updates-badge">${icon("sprout")} Latest update</span>
              <strong>${esc(latestUpdate.title)}</strong>
              <span class="muted">${esc(new Date(latestUpdate.publishedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }))} · <span class="accent">See all updates</span></span>
            </a>`
          : ""
      }

      <article class="prose about-prose">${html}</article>

      <div class="about-links">
        <a class="btn" href="/updates">${icon("sprout")} Sprout Updates</a>
        ${state.user ? "" : `<a class="btn btn-primary" href="/signup">Create a free account</a>`}
      </div>
    </div>`;
  main.querySelector("#edit")?.addEventListener("click", () => renderEditor(main, about));
}

function renderEditor(main, about) {
  main.innerHTML = `
    <div class="container narrow page fade-in">
      <div class="studio-head"><div><h1 class="page-title">Edit About page</h1><p>Markdown is supported: ## headings, **bold**, - lists, [links](https://…).</p></div></div>
      <form class="panel panel-pad" id="about-form" style="display:grid;gap:16px" novalidate>
        <div class="field"><label for="version">Current version</label><input class="input" id="version" name="version" maxlength="40" value="${esc(about.version)}" required /><span class="hint">Shown on this page and in the footer, e.g. 1.2.0</span></div>
        <div class="field"><label for="body_md">Page content</label><textarea class="textarea body-editor" id="body_md" name="body_md">${esc(about.body_md)}</textarea></div>
        <p class="form-error" role="alert"></p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">Save changes</button>
          <button class="btn btn-ghost" type="button" id="cancel">Cancel</button>
        </div>
      </form>
    </div>`;
  const form = main.querySelector("#about-form");
  main.querySelector("#cancel").addEventListener("click", () => renderView(main, about));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const error = form.querySelector(".form-error");
    error.textContent = "";
    btn.disabled = true;
    try {
      await api("/studio/about", { method: "PUT", body: { version: form.version.value, body_md: form.body_md.value } });
      const fresh = await api("/about");
      state.config.version = fresh.version;
      document.getElementById("footer-version").textContent = `v${fresh.version}`;
      toast("About page saved");
      renderView(main, fresh);
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
    }
  });
}
