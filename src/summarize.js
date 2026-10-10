import { createHash } from "node:crypto";
import { ApiError, GoogleGenAI } from "@google/genai";
import { db, now } from "./db.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const client = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

export const aiEnabled = () => Boolean(client);

const SYSTEM = `You summarize news articles for Sprout, a news app.
Write a neutral, factual summary using only information in the article.
Format: one short lead sentence, then 3-5 bullet points ("- ") covering the key facts, numbers, people and what happens next.
No headings, no preamble, no opinions, under 160 words.`;

const fail = (message, status) => Object.assign(new Error(message), { status });

// Returns a cached summary when the article body hasn't changed; otherwise asks Gemini.
export async function summarizeArticle(article) {
  const bodyHash = createHash("sha256").update(`${article.title}\n${article.body_md}`).digest("hex");
  const cached = await db.get("SELECT * FROM summaries WHERE article_id = ?", [article.id]);
  if (cached && cached.body_hash === bodyHash) return { summary: cached.content, cached: true };

  if (!client) throw fail("AI summaries aren't configured on this server yet (missing GEMINI_API_KEY).", 503);

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: `<article>\n<title>${article.title}</title>\n${article.dek ? `<dek>${article.dek}</dek>\n` : ""}<body>\n${article.body_md}\n</body>\n</article>\n\nSummarize this article.`,
      config: { systemInstruction: SYSTEM, maxOutputTokens: 4096, temperature: 0.3 },
    });
  } catch (err) {
    console.error("[sprout] summary request failed:", err?.status, err?.message);
    const busy = err instanceof ApiError && (err.status === 429 || err.status >= 500);
    throw fail(busy ? "The AI service is busy right now. Try again in a moment." : "The AI summary service is unavailable.", busy ? 503 : 502);
  }

  const finish = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) {
    throw fail("A summary couldn't be generated for this article.", 422);
  }
  const summary = (response.text || "").trim();
  if (!summary) throw fail("The AI returned an empty summary.", 502);

  const params = [summary, bodyHash, response.modelVersion || MODEL, now(), article.id];
  if (cached) {
    await db.run("UPDATE summaries SET content = ?, body_hash = ?, model = ?, created_at = ? WHERE article_id = ?", params);
  } else {
    await db.run("INSERT INTO summaries (content, body_hash, model, created_at, article_id) VALUES (?, ?, ?, ?, ?)", params);
  }
  return { summary, cached: false };
}
