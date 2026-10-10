/* global process */
/**
 * Vercel Serverless Function — AI answer formatter (Groq)
 *
 * POST /api/ai-format   { question: string, answer: string }
 *   → 200 { html: string }
 *
 * Turns an author's rough answer into clean, structured HTML for the student app.
 * The Groq key and model stay on the server: set GROQ_API_KEY and GROQ_MODEL in .env.local (local dev)
 * or in Netlify / Vercel → Environment Variables (production).
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_ANSWER_CHARS = 20000;
const MAX_QUESTION_CHARS = 2000;

const SYSTEM_PROMPT = `You convert an exam answer written by a teacher into clean, well-structured HTML for a mobile study app used by engineering students.

Output rules:
- Output ONLY the HTML fragment. No markdown, no code fences, no <html>, <head> or <body>, no explanations before or after.
- Allowed tags only: p, h3, h4, strong, em, u, ul, ol, li, blockquote, code, pre, table, thead, tbody, tr, th, td, br, hr.
- No inline styles, classes, ids, scripts, links or event handlers.

Content rules:
- Keep every fact, definition, number, formula, example and diagram reference from the input. Never invent new facts.
- Fix obvious spelling and grammar mistakes only. Keep the author's language and tone.
- Structure it for quick revision: a short opening definition/summary paragraph; <h3>/<h4> headings for distinct parts; <ul>/<ol> for points and steps; <strong> for key terms; a <table> with <thead> for comparisons/differences/advantages-vs-disadvantages; <pre><code> for code, pseudo-code or algorithms; a final <h4>Conclusion</h4> only if the input has one.
- Tokens like [[IMG_0]], [[IMG_1]] are images. Keep each token exactly once, alone inside its own <p>, at the position that matches the surrounding text. Never change or remove them.`;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function stripFences(text) {
  return String(text || '')
    .replace(/^\s*```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/** Framework-agnostic core — also used by the Vite dev server (see vite.config.js). */
export async function formatAnswer({ question = '', answer = '' } = {}, env = process.env) {
  const apiKey = env.GROQ_API_KEY;
  const model = env.GROQ_MODEL;
  if (!apiKey || !model) {
    throw httpError(500, 'GROQ_API_KEY or GROQ_MODEL is not set. Add them to environment variables.');
  }
  if (!String(answer).trim()) throw httpError(400, 'Write an answer before formatting it with AI.');
  if (answer.length > MAX_ANSWER_CHARS || question.length > MAX_QUESTION_CHARS) {
    throw httpError(413, `Answer is too long to format (max ${MAX_ANSWER_CHARS.toLocaleString()} characters).`);
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Question:\n${question || '(not provided)'}\n\nAnswer to convert:\n${answer}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const status = res.status === 401 ? 500 : 502;
    const hint = res.status === 401 ? 'The GROQ_API_KEY is invalid.' : `Groq API error (${res.status}).`;
    throw httpError(status, `${hint} ${detail.slice(0, 200)}`.trim());
  }

  const json = await res.json();
  const html = stripFences(json?.choices?.[0]?.message?.content);
  if (!html) throw httpError(502, 'The AI returned an empty response. Try again.');
  return html;
}

export default async function handler(req, res) {
  // Netlify Functions (Standard Web Request/Response)
  if (!res || typeof res.status !== 'function') {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
      });
    }
    try {
      const body = await req.json().catch(() => ({}));
      const html = await formatAnswer(body);
      return Response.json({ html });
    } catch (err) {
      return Response.json(
        { error: err.message || 'AI formatting failed' },
        { status: err.status || 500 }
      );
    }
  }

  // Node.js / Vercel / Vite dev middleware
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const html = await formatAnswer(body);
    return res.status(200).json({ html });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'AI formatting failed' });
  }
}
