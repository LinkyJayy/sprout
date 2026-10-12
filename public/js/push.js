// Browser side of push notifications: permission, subscribe and unsubscribe.
import { api } from "./api.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iOS only allows web push for apps installed to the home screen.
export const needsInstallForPush = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone;

function keyToBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications.");
  if (needsInstallForPush()) throw new Error("On iPhone and iPad, add Sprout to your Home Screen first, then turn on notifications from there.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. You can allow them in your browser's site settings.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api("/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
