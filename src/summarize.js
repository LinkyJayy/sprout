import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db, now } from "./db.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export const aiEnabled = () => Boolean(client);

const SYSTEM = `You summarize news articles for Sprout, a news app.
Write a neutral, factual summary using only information in the article.
Format: one short lead sentence, then 3-5 bullet points ("- ") covering the key facts, numbers, people and what happens next.
No headings, no preamble, no opinions, under 160 words.`;

// Returns a cached summary when the article body hasn't changed; otherwise asks Claude.
export async function summarizeArticle(article) {
  const bodyHash = createHash("sha256").update(`${article.title}\n${article.body_md}`).digest("hex");
  const cached = await db.get("SELECT * FROM summaries WHERE article_id = ?", [article.id]);
  if (cached && cached.body_hash === bodyHash) return { summary: cached.content, cached: true };

  if (!client) {
    throw Object.assign(new Error("AI summaries aren't configured on this server yet (missing ANTHROPIC_API_KEY)."), {
      status: 503,
    });
  }

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      // On a safety decline, let the API re-run the request on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `<article>\n<title>${article.title}</title>\n${article.dek ? `<dek>${article.dek}</dek>\n` : ""}<body>\n${article.body_md}\n</body>\n</article>\n\nSummarize this article.`,
        },
      ],
    });
  } catch (err) {
    console.error("[sprout] summary request failed:", err?.status, err?.message);
    const busy = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError;
    throw Object.assign(
      new Error(busy ? "The AI service is busy right now. Try again in a moment." : "The AI summary service is unavailable."),
      { status: busy ? 503 : 502 }
    );
  }

  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("A summary couldn't be generated for this article."), { status: 422 });
  }
  const summary = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!summary) throw Object.assign(new Error("The AI returned an empty summary."), { status: 502 });

  const params = [summary, bodyHash, response.model || MODEL, now(), article.id];
  if (cached) {
    await db.run("UPDATE summaries SET content = ?, body_hash = ?, model = ?, created_at = ? WHERE article_id = ?", params);
  } else {
    await db.run("INSERT INTO summaries (content, body_hash, model, created_at, article_id) VALUES (?, ?, ?, ?, ?)", params);
  }
  return { summary, cached: false };
}
