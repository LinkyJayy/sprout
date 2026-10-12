// Web Push notifications for newly published articles.
// VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are generated once and stored in the
// database so subscriptions keep working across deploys (as long as the database itself persists).
import webpush from "web-push";
import { db, getSetting, now, setSetting } from "./db.js";

let keys = null;

async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const stored = await getSetting("vapid_keys");
    keys = stored ? JSON.parse(stored) : webpush.generateVAPIDKeys();
    if (!stored) await setSetting("vapid_keys", JSON.stringify(keys));
  }
  return keys;
}

export async function publicKey() {
  return (await vapidKeys()).publicKey;
}

export async function saveSubscription(sub, userId) {
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const { p256dh, auth } = sub?.keys || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== "string" || typeof auth !== "string") {
    throw Object.assign(new Error("Invalid push subscription."), { status: 400 });
  }
  await db.run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id`,
    [endpoint, p256dh.slice(0, 200), auth.slice(0, 100), userId ?? null, now()]
  );
}

export async function removeSubscription(endpoint) {
  if (typeof endpoint === "string") await db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
}

// Sends a notification about `article` to every subscriber, at most once per article.
// Runs in the background; failures are logged and never block publishing.
export async function notifyPublished(article) {
  // Claim the article first so concurrent saves can't send twice.
  const claimed = await db.run("UPDATE articles SET notified_at = ? WHERE id = ? AND notified_at IS NULL", [now(), article.id]);
  if (!claimed.changes) return;

  const { publicKey: pub, privateKey } = await vapidKeys();
  const owner = await db.get("SELECT email FROM users WHERE role = 'owner'");
  const subject = process.env.VAPID_SUBJECT || `mailto:${owner?.email || "admin@example.com"}`;

  const isUpdate = article.section === "sprout";
  const payload = JSON.stringify({
    title: isUpdate ? `Sprout update: ${article.title}` : article.title,
    body: article.dek || (isUpdate ? "News from the Sprout team." : "A new story just sprouted."),
    url: `/article/${encodeURIComponent(article.slug)}`,
    tag: `article-${article.id}`,
  });

  const subs = await db.all("SELECT endpoint, p256dh, auth FROM push_subscriptions");
  let sent = 0;
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(
      subs.slice(i, i + 25).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            vapidDetails: { subject, publicKey: pub, privateKey },
            TTL: 60 * 60 * 24,
          });
          sent++;
        } catch (err) {
          // 404/410 mean the browser dropped the subscription; clean it up.
          if (err.statusCode === 404 || err.statusCode === 410) await removeSubscription(s.endpoint);
          else console.warn("[sprout] push failed:", err.statusCode || err.message);
        }
      })
    );
  }
  console.log(`[sprout] push: "${article.title}" sent to ${sent}/${subs.length} subscribers`);
}
