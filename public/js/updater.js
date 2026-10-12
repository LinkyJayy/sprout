// Detects new deploys and shows the "There is an update available" pop-up.
import { icon } from "./ui.js";

const CHECK_EVERY_MS = 30 * 60 * 1000;

function showPrompt(worker) {
  if (document.getElementById("update-prompt")) return;
  const el = document.createElement("div");
  el.id = "update-prompt";
  el.className = "update-prompt";
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-labelledby", "update-title");
  el.innerHTML = `
    <img src="/icons/icon-192-v2.png" alt="" class="update-icon" />
    <div class="update-text">
      <strong id="update-title">There is an update available</strong>
      <span>Get the latest version of Sprout.</span>
    </div>
    <button class="btn btn-primary btn-sm" type="button" data-update>${icon("refresh")} Update</button>
    <button class="icon-btn update-close" type="button" data-later aria-label="Remind me later" title="Later">${icon("close")}</button>`;
  document.body.append(el);
  el.querySelector("[data-update]").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Updating`;
    // The new service worker takes over; the controllerchange listener below reloads the page.
    worker.postMessage({ type: "SKIP_WAITING" });
    // Fallback in case the worker was already activated elsewhere (e.g. another tab updated first).
    setTimeout(() => location.reload(), 4000);
  });
  el.querySelector("[data-later]").addEventListener("click", () => el.remove());
  el.querySelector("[data-update]").focus({ preventScroll: true });
}

export async function setupUpdates() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Skip the very first install (nothing to update from); reload once whenever a new version takes over.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  const offer = (worker) => {
    if (worker && navigator.serviceWorker.controller) showPrompt(worker);
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });

  // Installed apps can stay open for days, so keep checking for new deploys.
  const check = () => reg.update().catch(() => {});
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}
