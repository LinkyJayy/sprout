// Small fetch wrapper + shared app state.
export const state = { user: null, config: null, streak: null };

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data.error || (navigator.onLine ? "Something went wrong." : "You're offline."));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const isOwner = () => state.user?.role === "owner";

// The reader's local calendar date (YYYY-MM-DD), so streaks follow their timezone.
export function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
