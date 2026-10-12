import { api, state, isOwner } from "../api.js";
import { esc, icon, media, timeAgo, toast, sourceLabel } from "../ui.js";
import { navigate } from "../app.js";

let pendingDraft = null; // filled by the importer, consumed by the editor
let selectedSource = "bbc";
let selectedSection = "top";

const SOURCE_MARKS = { bbc: "BBC", cnn: "CNN", cbs: "CBS", nyt: "NYT" };

export async function studioView(main, { params, query, isCurrent }) {
  if (!state.user) return navigate(`/signin?next=${encodeURIComponent(location.pathname)}`, { replace: true });
  if (!isOwner()) {
    main.innerHTML = `<div class="container page"><div class="empty"><img src="/img/logo.png" alt="" /><h2>Owner only</h2><p>The Studio is reserved for the owner of this Sprout.</p><a class="btn" href="/">Back to the news</a></div></div>`;
    return;
  }
  const sub = params[0] || "";
  const tab = sub.startsWith("edit") ? "edit" : sub || "articles";
  document.title = "Studio · Sprout";

  main.innerHTML = `
    <div class="container page">
      <div class="studio-head">
        <div><h1 class="page-title">Studio</h1><p>Write original stories or bring in reporting from BBC, CNN, CBS News and The New York Times.</p></div>
        <nav class="tabs" aria-label="Studio sections">
          <a class="tab ${tab === "articles" ? "active" : ""}" href="/studio">${icon("grid")} Articles</a>
          <a class="tab ${tab === "import" ? "active" : ""}" href="/studio/import">${icon("download")} Import</a>
          <a class="tab ${tab === "new" || tab === "edit" ? "active" : ""}" href="/studio/new">${icon("pen")} ${tab === "edit" ? "Edit" : "Write"}</a>
        </nav>
      </div>
      <div id="studio-body"></div>
    </div>`;
  const body = main.querySelector("#studio-body");

  if (tab === "articles") return articlesTab(body, isCurrent);
  if (tab === "import") return importTab(body, isCurrent);
  if (tab === "edit") {
    const id = Number(sub.split("/")[1]);
    const { article } = await api(`/studio/articles/${id}`);
    if (!isCurrent()) return;
    return editor(body, article);
  }
  const draft = pendingDraft;
  pendingDraft = null;
  return editor(body, draft || (query.get("section") === "sprout" ? { section: "sprout" } : null));
}

// ───────── Articles list ─────────
async function articlesTab(body, isCurrent) {
  body.innerHTML = `<div class="panel"><div class="list">${'<div class="list-row"><div class="thumb skeleton"></div><div><div class="skeleton sk-line" style="width:70%"></div><div class="skeleton sk-line" style="width:40%"></div></div><div></div></div>'.repeat(4)}</div></div>`;
  const { articles } = await api("/studio/articles");
  if (!isCurrent()) return;
  if (!articles.length) {
    body.innerHTML = `<div class="empty fade-in"><img src="/img/logo.png" alt="" /><h2>No articles yet</h2><p>Start by writing your own story or importing one from a trusted outlet.</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><a class="btn btn-primary" href="/studio/new">${icon("pen")} Write article</a><a class="btn" href="/studio/import">${icon("download")} Import article</a></div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="panel fade-in"><div class="list">
      ${articles
        .map(
          (a) => `
        <div class="list-row" data-id="${a.id}">
          ${media(a.coverImage, "thumb")}
          <div style="min-width:0">
            <h4>${esc(a.title)}</h4>
            <div class="meta">
              ${a.status === "draft" ? `<span class="badge">Draft</span>` : `<span class="badge badge-accent">Live</span>`}
              ${a.section === "sprout" ? `<span class="badge">${icon("sprout")}&nbsp;App update</span>` : ""}
              <span>${esc(a.category)}</span><span class="dot"></span><span>${esc(sourceLabel(a))}</span><span class="dot"></span><span>${esc(timeAgo(a.publishedAt))}</span>
            </div>
          </div>
          <div class="row-actions">
            <a class="btn btn-sm btn-ghost" href="/article/${encodeURIComponent(a.slug)}" title="View">${icon("eye")}<span class="sr-only">View</span></a>
            <a class="btn btn-sm" href="/studio/edit/${a.id}">${icon("pen")} Edit</a>
            <button class="btn btn-sm btn-danger" data-delete="${a.id}" type="button" title="Delete">${icon("trash")}<span class="sr-only">Delete</span></button>
          </div>
        </div>`
        )
        .join("")}
    </div></div>`;
  body.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delete]");
    if (!del) return;
    const row = del.closest(".list-row");
    const title = row.querySelector("h4").textContent;
    if (!confirm(`Delete “${title}”? This can't be undone.`)) return;
    try {
      await api(`/studio/articles/${del.dataset.delete}`, { method: "DELETE" });
      row.remove();
      toast("Article deleted");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ───────── Import ─────────
async function importTab(body, isCurrent) {
  const { sources } = await api("/studio/sources");
  if (!isCurrent()) return;

  body.innerHTML = `
    <div class="fade-in">
      <div class="source-grid" role="radiogroup" aria-label="News source">
        ${sources
          .map(
            (s) => `<button class="source-card ${s.id === selectedSource ? "active" : ""}" type="button" role="radio" aria-checked="${s.id === selectedSource}" data-source="${s.id}"><span class="mark">${SOURCE_MARKS[s.id] || s.id}</span><span class="name">${esc(s.name)}</span></button>`
          )
          .join("")}
      </div>
      <form class="url-import" id="url-form">
        <input class="input" name="url" type="url" placeholder="…or paste a BBC, CNN, CBS or NYT article link" aria-label="Article URL" />
        <button class="btn btn-primary" type="submit">${icon("download")} Import link</button>
      </form>
      <div class="chips" id="sections" style="margin-bottom:14px"></div>
      <div class="panel" id="feed"></div>
      <p class="hint" style="margin-top:14px">${icon("info")} Imported stories open in the editor so you can review them before publishing. Each one links back to the original outlet — make sure you have the rights to republish full articles.</p>
    </div>`;

  const feedEl = body.querySelector("#feed");
  const sectionsEl = body.querySelector("#sections");

  const loadFeed = async () => {
    const src = sources.find((s) => s.id === selectedSource);
    if (!src.sections.includes(selectedSection)) selectedSection = "top";
    sectionsEl.innerHTML = src.sections
      .map((s) => `<button type="button" class="chip ${s === selectedSection ? "active" : ""}" data-section="${s}">${s === "top" ? "Top stories" : s[0].toUpperCase() + s.slice(1)}</button>`)
      .join("");
    feedEl.innerHTML = `<div class="list">${'<div class="feed-item"><div><div class="skeleton sk-line" style="width:80%"></div><div class="skeleton sk-line" style="width:50%"></div></div><div></div></div>'.repeat(6)}</div>`;
    const key = `${selectedSource}:${selectedSection}`;
    try {
      const { items } = await api(`/studio/sources/${selectedSource}/feed?section=${selectedSection}`);
      if (!isCurrent() || key !== `${selectedSource}:${selectedSection}`) return;
      feedEl.innerHTML = items.length
        ? items
            .map(
              (it) => `
          <div class="feed-item">
            <div style="min-width:0">
              <h4>${esc(it.title)}</h4>
              ${it.summary ? `<p>${esc(it.summary)}</p>` : ""}
              <div class="meta" style="margin-top:6px">${it.publishedAt ? `<span>${esc(timeAgo(it.publishedAt))}</span><span class="dot"></span>` : ""}<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" class="accent">Open original ${icon("external")}</a></div>
            </div>
            <button class="btn btn-sm" type="button" data-import="${esc(it.url)}" data-image="${esc(it.image)}">${icon("download")} Import</button>
          </div>`
            )
            .join("")
        : `<div class="panel-pad muted">No stories found in this feed right now.</div>`;
    } catch (err) {
      if (!isCurrent()) return;
      feedEl.innerHTML = `<div class="panel-pad"><p class="form-error">${esc(err.message)}</p><p class="hint">The outlet may be blocking requests from this server. You can still paste an article link above.</p></div>`;
    }
  };

  const doImport = async (url, btn, fallbackImage = "") => {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Importing`;
    try {
      const { draft } = await api("/studio/extract", { method: "POST", body: { url } });
      if (!draft.cover_image && fallbackImage) draft.cover_image = fallbackImage;
      if (draft.partial) toast("Only part of this article could be extracted — review it before publishing.", "error");
      pendingDraft = draft;
      navigate("/studio/new");
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
      btn.innerHTML = label;
    }
  };

  body.querySelector(".source-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-source]");
    if (!card) return;
    selectedSource = card.dataset.source;
    body.querySelectorAll("[data-source]").forEach((c) => {
      c.classList.toggle("active", c === card);
      c.setAttribute("aria-checked", String(c === card));
    });
    loadFeed();
  });
  sectionsEl.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-section]");
    if (!chip) return;
    selectedSection = chip.dataset.section;
    loadFeed();
  });
  feedEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-import]");
    if (btn) doImport(btn.dataset.import, btn, btn.dataset.image);
  });
  body.querySelector("#url-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = e.currentTarget.url.value.trim();
    if (!url) return toast("Paste an article link first.", "error");
    doImport(url, e.currentTarget.querySelector("button"));
  });
  loadFeed();
}

// ───────── Editor ─────────
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function editor(body, existing) {
  const a = existing || {};
  const editing = Boolean(a.id);
  const imported = a.source && a.source !== "original";
  const cats = state.config?.categories || ["World"];
  const category = cats.includes(a.category) ? a.category : guessCategory(a, cats);

  body.innerHTML = `
    <form class="editor fade-in" id="editor" novalidate>
      <div class="editor-main">
        <div class="field"><label for="title">Headline</label><input class="input title-input" id="title" name="title" maxlength="300" placeholder="Write a clear, compelling headline" value="${esc(a.title)}" required /></div>
        <div class="field"><label for="dek">Subheadline</label><textarea class="textarea" id="dek" name="dek" rows="2" maxlength="600" placeholder="One or two sentences that set up the story">${esc(a.dek)}</textarea></div>
        <div class="field">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <label for="body_md">Story</label>
            <div class="tabs" style="padding:3px"><button type="button" class="tab active" data-mode="write" style="height:28px">Write</button><button type="button" class="tab" data-mode="preview" style="height:28px">Preview</button></div>
          </div>
          <textarea class="textarea body-editor" id="body_md" name="body_md" placeholder="Write your story here. Markdown is supported: ## headings, **bold**, *italic*, [links](https://…), > quotes, - lists.">${esc(a.body_md)}</textarea>
          <div class="preview prose" id="preview" hidden></div>
          <span class="hint">Markdown supported.</span>
        </div>
      </div>
      <aside class="editor-side">
        <div class="panel panel-pad" style="display:grid;gap:14px">
          <div class="field"><label for="section">Post to</label>
            <select class="select" id="section" name="section" ${imported ? "disabled" : ""}>
              <option value="news" ${a.section !== "sprout" ? "selected" : ""}>News feed</option>
              <option value="sprout" ${a.section === "sprout" ? "selected" : ""}>Sprout Updates</option>
            </select>
            ${imported ? `<span class="hint">Imported stories always go to the news feed.</span>` : ""}
          </div>
          <div class="field"><label for="status">Status</label>
            <select class="select" id="status" name="status">
              <option value="published" ${a.status !== "draft" ? "selected" : ""}>Published</option>
              <option value="draft" ${a.status === "draft" ? "selected" : ""}>Draft</option>
            </select>
          </div>
          <div class="field" id="category-field"><label for="category">Category</label>
            <select class="select" id="category" name="category">${cats.map((c) => `<option ${c === category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
          </div>
          <div class="field"><label for="author">Author</label><input class="input" id="author" name="author" maxlength="200" value="${esc(a.author ?? (imported ? "" : state.user.name))}" /></div>
          <div class="field"><label for="published_at">Publish date</label><input class="input" id="published_at" name="published_at" type="datetime-local" value="${toLocalInput(a.published_at)}" /></div>
          <div class="field"><label for="cover_image">Cover image URL</label><input class="input" id="cover_image" name="cover_image" type="url" placeholder="https://…" value="${esc(a.cover_image)}" /></div>
          <div id="cover-preview">${a.cover_image ? media(a.cover_image) : ""}</div>
          ${
            imported
              ? `<div class="attribution">${icon("link")} Source: <strong>${esc(a.source_name)}</strong><br /><a href="${esc(a.source_url)}" target="_blank" rel="noopener noreferrer">${esc(a.source_url)}</a></div>`
              : `<div class="attribution">${icon("pen")} Sprout Original</div>`
          }
          <p class="form-error" role="alert"></p>
          <button class="btn btn-primary btn-block" type="submit">${editing ? "Save changes" : "Publish"}</button>
          <span class="hint" id="notify-hint">${icon("bell")} Publishing sends a notification to everyone who turned them on.</span>
          ${editing ? `<a class="btn btn-ghost btn-block" href="/studio">Cancel</a>` : ""}
        </div>
      </aside>
    </form>`;

  const form = body.querySelector("#editor");
  const textarea = form.querySelector("#body_md");
  const preview = form.querySelector("#preview");
  const submit = form.querySelector("button[type=submit]");
  const statusSel = form.querySelector("#status");
  const sectionSel = form.querySelector("#section");
  const syncSection = () => {
    // Sprout updates aren't filed under a news category.
    form.querySelector("#category-field").hidden = sectionSel.value === "sprout";
  };
  sectionSel.addEventListener("change", syncSection);
  syncSection();
  const syncSubmitLabel = () => {
    // Only a first-time publish notifies subscribers.
    form.querySelector("#notify-hint").hidden = statusSel.value === "draft" || (editing && a.notified_at);
    if (!editing) submit.textContent = statusSel.value === "draft" ? "Save draft" : "Publish";
  };
  statusSel.addEventListener("change", syncSubmitLabel);
  syncSubmitLabel();

  form.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", async () => {
      const mode = b.dataset.mode;
      form.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
      textarea.hidden = mode === "preview";
      preview.hidden = mode !== "preview";
      if (mode === "preview") {
        preview.innerHTML = `<p class="muted">Rendering…</p>`;
        try {
          const { html } = await api("/studio/preview", { method: "POST", body: { body_md: textarea.value } });
          preview.innerHTML = html || `<p class="muted">Nothing to preview yet.</p>`;
        } catch (err) {
          preview.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
        }
      }
    })
  );

  const coverInput = form.querySelector("#cover_image");
  coverInput.addEventListener("change", () => {
    const v = coverInput.value.trim();
    form.querySelector("#cover-preview").innerHTML = /^https?:\/\//.test(v) ? media(v) : "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = form.querySelector(".form-error");
    error.textContent = "";
    const f = new FormData(form);
    const payload = {
      title: f.get("title"),
      dek: f.get("dek"),
      body_md: f.get("body_md"),
      status: f.get("status"),
      section: imported ? "news" : f.get("section"),
      category: f.get("category"),
      author: f.get("author"),
      cover_image: f.get("cover_image"),
      published_at: f.get("published_at") ? new Date(f.get("published_at")).toISOString() : null,
      source: a.source || "original",
      source_url: a.source_url || "",
    };
    if (!payload.title.trim()) return (error.textContent = "A headline is required.");
    if (!payload.body_md.trim()) return (error.textContent = "The story can't be empty.");
    submit.disabled = true;
    const label = submit.textContent;
    submit.innerHTML = `<span class="spinner"></span> Saving`;
    try {
      const { article } = editing
        ? await api(`/studio/articles/${a.id}`, { method: "PUT", body: payload })
        : await api("/studio/articles", { method: "POST", body: payload });
      toast(article.status === "draft" ? "Draft saved" : editing ? "Changes saved" : article.section === "sprout" ? "Update published" : "Story published");
      navigate(`/article/${encodeURIComponent(article.slug)}`);
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  if (!editing) form.querySelector("#title").focus();
}

function guessCategory(a, cats) {
  const hay = `${a.source_url || ""} ${a.title || ""}`.toLowerCase();
  const rules = [
    ["Technology", /tech|technology|\bai\b|artificial intelligence|software|apple|google|microsoft/],
    ["Business", /business|money|market|economy|stocks|moneywatch/],
    ["Politics", /politic|election|congress|senate|white house|parliament/],
    ["Science", /science|space|climate|nasa|environment/],
    ["Health", /health|medical|covid|vaccine|disease/],
    ["Sports", /sport|football|soccer|nba|nfl|olympic|tennis/],
    ["Culture", /entertainment|culture|arts|film|music|movie|style/],
    ["U.S.", /\/us\/|\/us-|u\.s\./],
  ];
  for (const [cat, re] of rules) if (cats.includes(cat) && re.test(hay)) return cat;
  return cats.includes("World") ? "World" : cats[0];
}
