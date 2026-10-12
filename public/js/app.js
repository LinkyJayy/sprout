import { api, state, isOwner, localDay } from "./api.js";
import { esc, icon, toast } from "./ui.js";
import { currentSubscription, disablePush, enablePush, pushSupported } from "./push.js";
import { homeView, searchView } from "./views/home.js";
import { articleView } from "./views/article.js";
import { signInView, signUpView, accountView } from "./views/auth.js";
import { studioView } from "./views/studio.js";
import { updatesView } from "./views/updates.js";
import { aboutView } from "./views/about.js";

const main = document.getElementById("main");

// ───────── Routing ─────────
const routes = [
  [/^\/$/, homeView],
  [/^\/search$/, searchView],
  [/^\/updates$/, updatesView],
  [/^\/about$/, aboutView],
  [/^\/article\/([^/]+)$/, articleView],
  [/^\/signin$/, signInView],
  [/^\/signup$/, signUpView],
  [/^\/account$/, accountView],
  [/^\/studio(?:\/(new|import|edit\/\d+))?$/, studioView],
];

let renderId = 0;
export async function render() {
  const id = ++renderId;
  const { pathname, search } = location;
  const query = new URLSearchParams(search);
  const match = routes.map(([re, view]) => [pathname.match(re), view]).find(([m]) => m);
  document.querySelectorAll(".header-actions [data-link]").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === pathname));
  setActiveNav({ "/": "news", "/updates": "updates", "/about": "about", "/search": "search" }[pathname] || (pathname.startsWith("/article/") ? "news" : ""));
  if (!match) return notFound();
  const [m, view] = match;
  try {
    await view(main, { params: m.slice(1), query, isCurrent: () => id === renderId });
  } catch (err) {
    if (id !== renderId) return;
    console.error(err);
    main.innerHTML = `<div class="container page"><div class="empty"><img src="/img/logo-v2.png" alt="" /><h2>Couldn't load this page</h2><p>${esc(err.message)}</p><a class="btn" href="/">Go home</a></div></div>`;
  }
}

// Highlights the current section in the header nav and the mobile tab bar.
export function setActiveNav(key) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === key;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function notFound() {
  document.title = "Not found · Sprout";
  main.innerHTML = `<div class="container page"><div class="empty fade-in"><img src="/img/logo-v2.png" alt="" /><h2>Nothing grew here</h2><p>The page you're looking for doesn't exist.</p><a class="btn btn-primary" href="/">Back to the news</a></div></div>`;
}

export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.scrollTo({ top: 0, behavior: "instant" });
  render();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === "_blank" || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.preventDefault();
  if (url.pathname + url.search === location.pathname + location.search) return;
  navigate(url.pathname + url.search);
});
window.addEventListener("popstate", render);

// ───────── Theme ─────────
const themeBtn = document.getElementById("theme-toggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeBtn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  document.getElementById("theme-color").setAttribute("content", theme === "dark" ? "#0a0c0b" : "#f6f8f6");
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("sprout-theme", next);
  } catch {}
  applyTheme(next);
});
applyTheme(document.documentElement.getAttribute("data-theme") || "dark");
document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

// ───────── Push notifications ─────────
const pushBtn = document.getElementById("push-toggle");
function renderPush(on) {
  pushBtn.hidden = false;
  pushBtn.classList.toggle("active", on);
  pushBtn.innerHTML = icon(on ? "bellOn" : "bell");
  const label = on ? "Turn off new-story notifications" : "Get notified about new stories";
  pushBtn.setAttribute("aria-label", label);
  pushBtn.title = label;
  pushBtn.setAttribute("aria-pressed", String(on));
}
if (pushSupported()) {
  currentSubscription()
    .then((sub) => renderPush(Boolean(sub) && Notification.permission === "granted"))
    .catch(() => renderPush(false));
  pushBtn.addEventListener("click", async () => {
    pushBtn.disabled = true;
    try {
      if (pushBtn.classList.contains("active")) {
        await disablePush();
        renderPush(false);
        toast("Notifications turned off");
      } else {
        await enablePush();
        renderPush(true);
        toast("You'll be notified when new stories are published");
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      pushBtn.disabled = false;
    }
  });
}

// ───────── Account slot ─────────
let closeMenu = null;
export function renderHeader() {
  if (closeMenu) document.removeEventListener("click", closeMenu);
  closeMenu = null;
  const slot = document.getElementById("account-slot");
  const u = state.user;
  if (!u) {
    slot.innerHTML = `<a href="/signin" class="btn btn-sm btn-primary">Sign in</a>`;
    return;
  }
  const initial = esc((u.name || u.email).trim()[0]?.toUpperCase() || "?");
  const st = state.streak;
  const streakPill = st
    ? `<a href="/account" class="streak-pill ${st.readToday ? "lit" : st.current ? "at-risk" : ""}" title="${
        st.readToday ? "You've read today. Streak safe!" : st.current ? "Read an article today to keep your streak" : "Read an article to start a streak"
      }" aria-label="Reading streak: ${st.current} day${st.current === 1 ? "" : "s"}">${icon("flame")}<span>${st.current}</span></a>`
    : "";
  slot.innerHTML = `
    ${streakPill}
    <div class="account">
      <button class="avatar" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${initial}</button>
      <div class="menu" role="menu">
        <div class="who"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div>
        ${isOwner() ? `<a href="/studio" role="menuitem">${icon("grid")} Studio</a><a href="/studio/new" role="menuitem">${icon("pen")} Write article</a><a href="/studio/import" role="menuitem">${icon("download")} Import article</a>` : ""}
        <a href="/account" role="menuitem">${icon("user")} Account</a>
        <button type="button" data-logout role="menuitem">${icon("logout")} Sign out</button>
      </div>
    </div>`;
  const btn = slot.querySelector(".avatar");
  const menu = slot.querySelector(".menu");
  const close = () => {
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a,button")) close();
  });
  closeMenu = close;
  document.addEventListener("click", close);
  slot.querySelector("[data-logout]").addEventListener("click", logout);
}

export async function refreshStreak() {
  if (!state.user) return;
  try {
    ({ streak: state.streak } = await api(`/streak?today=${localDay()}`));
    renderHeader();
  } catch {}
}

export function setStreak(streak) {
  state.streak = streak;
  renderHeader();
}

export async function logout() {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.streak = null;
  renderHeader();
  navigate("/");
}

export function setUser(user) {
  state.user = user;
  state.streak = null;
  if (state.config) state.config.hasOwner = state.config.hasOwner || user?.role === "owner";
  renderHeader();
  refreshStreak();
}

// ───────── PWA ─────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.installPrompt = e;
  document.dispatchEvent(new CustomEvent("sprout:installable"));
});

// ───────── Boot ─────────
(async function boot() {
  try {
    state.config = await api("/config");
    state.user = state.config.user;
    document.getElementById("footer-version").textContent = `v${state.config.version}`;
  } catch {
    state.config = { hasOwner: true, aiEnabled: false, categories: [] };
  }
  renderHeader();
  render();
  refreshStreak();
})();
