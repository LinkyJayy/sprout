import { api, state, isOwner, localDay } from "../api.js";
import { esc, icon, fullDate, toast } from "../ui.js";
import { navigate, setUser, setStreak, logout } from "../app.js";

const safeNext = (q) => {
  const n = q.get("next") || "/";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
};

function authShell({ title, sub, notice = "", form, alt }) {
  return `
    <div class="auth-wrap">
      <div class="auth-card fade-in">
        <div>
          <img class="logo" src="/img/logo-v2.png" alt="Sprout" />
          <h1>${title}</h1>
        </div>
        <p class="sub">${sub}</p>
        ${notice}
        <form novalidate>${form}<p class="form-error" role="alert"></p></form>
        <p class="auth-alt">${alt}</p>
      </div>
    </div>`;
}

async function handleSubmit(main, path, next, buildBody) {
  const form = main.querySelector("form");
  const error = form.querySelector(".form-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const label = btn.innerHTML;
    error.textContent = "";
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    try {
      const { user } = await api(path, { method: "POST", body: buildBody(new FormData(form)) });
      setUser(user);
      toast(user.role === "owner" && path.endsWith("signup") ? "Welcome! You're the owner of this Sprout." : `Welcome, ${user.name.split(" ")[0]}!`);
      navigate(next, { replace: true });
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });
}

export async function signInView(main, { query }) {
  document.title = "Sign in · Sprout";
  const next = safeNext(query);
  if (state.user) return navigate(next, { replace: true });
  main.innerHTML = authShell({
    title: "Welcome back",
    sub: "Sign in to unlock AI summaries.",
    form: `
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in</button>`,
    alt: `New to Sprout? <a href="/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}">Create an account</a>`,
  });
  main.querySelector("#email").focus();
  handleSubmit(main, "/auth/login", next, (f) => ({ email: f.get("email"), password: f.get("password") }));
}

export async function signUpView(main, { query }) {
  document.title = "Create account · Sprout";
  const next = safeNext(query);
  if (state.user) return navigate(next, { replace: true });
  const firstAccount = !state.config?.hasOwner;
  main.innerHTML = authShell({
    title: firstAccount ? "Set up Sprout" : "Join Sprout",
    sub: "Reading is always free. An account unlocks AI summaries.",
    notice: firstAccount
      ? `<div class="notice">${icon("crown")}<span>You're creating the <strong>first account</strong>, so it will become the <strong>owner</strong> — able to write articles and import stories from BBC, CNN, CBS News and NYT.</span></div>`
      : "",
    form: `
      <div class="field"><label for="name">Name</label><input class="input" id="name" name="name" autocomplete="name" required maxlength="80" /></div>
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required /><span class="hint">At least 8 characters.</span></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Create account</button>`,
    alt: `Already have an account? <a href="/signin${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}">Sign in</a>`,
  });
  main.querySelector("#name").focus();
  handleSubmit(main, "/auth/signup", firstAccount ? "/studio" : next, (f) => ({
    name: f.get("name"),
    email: f.get("email"),
    password: f.get("password"),
  }));
}

export async function accountView(main) {
  document.title = "Account · Sprout";
  if (!state.user) return navigate("/signin?next=/account", { replace: true });
  const u = state.user;
  main.innerHTML = `
    <div class="container narrow page fade-in">
      <h1 class="page-title" style="margin-bottom:22px">Account</h1>
      <div id="streak-card"></div>
      <div class="panel panel-pad" style="display:grid;gap:18px">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="avatar" style="width:52px;height:52px;font-size:20px;cursor:default">${esc(u.name.trim()[0]?.toUpperCase() || "?")}</div>
          <div><h2 style="font-size:20px">${esc(u.name)}</h2><div class="muted" style="font-size:13px">${esc(u.email)}</div></div>
        </div>
        <div class="meta">
          ${isOwner() ? `<span class="badge badge-accent">${icon("crown")}&nbsp;Owner</span>` : `<span class="badge">Reader</span>`}
          <span>Member since ${esc(fullDate(u.createdAt).split(" at ")[0])}</span>
        </div>
        <div class="notice">${icon("sparkles")}<span>AI summaries are unlocked on every article.${state.config?.aiEnabled ? "" : " (The server admin still needs to add a GEMINI_API_KEY.)"}</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${isOwner() ? `<a class="btn btn-primary" href="/studio">${icon("grid")} Open Studio</a>` : ""}
          <button class="btn btn-danger" id="logout" type="button">${icon("logout")} Sign out</button>
        </div>
      </div>
    </div>`;
  main.querySelector("#logout").addEventListener("click", logout);

  const card = main.querySelector("#streak-card");
  if (state.streak) card.innerHTML = streakCardHTML(state.streak);
  try {
    const { streak } = await api(`/streak?today=${localDay()}`);
    setStreak(streak);
    card.innerHTML = streakCardHTML(streak);
  } catch {}
}

function streakCardHTML(st) {
  const message = st.readToday
    ? "You've read today. Your streak is safe."
    : st.current
      ? "Read an article today to keep your streak alive."
      : "Read an article to start a new streak.";
  const weekday = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });
  return `
    <section class="streak-card panel panel-pad fade-in" aria-label="Reading streak">
      <div class="streak-main">
        <div class="streak-flame ${st.readToday ? "lit" : ""}">${icon("flame")}</div>
        <div>
          <div class="streak-count">${st.current} day${st.current === 1 ? "" : "s"}</div>
          <div class="muted" style="font-size:13px">${message}</div>
        </div>
      </div>
      <div class="streak-week" aria-label="Last 7 days">
        ${st.week
          .map(
            (d, i) =>
              `<div class="streak-day ${d.read ? "read" : ""} ${i === 6 ? "today" : ""}" title="${esc(d.day)}${d.read ? ": read" : ""}"><span class="dot">${d.read ? icon("check") : ""}</span><span class="lbl">${esc(weekday(d.day))}</span></div>`
          )
          .join("")}
      </div>
      <div class="streak-stats">
        <div><strong>${st.longest}</strong><span>Longest streak</span></div>
        <div><strong>${st.totalDays}</strong><span>Days read</span></div>
      </div>
    </section>`;
}
