import { createHmac, timingSafeEqual } from "node:crypto";
import { db, HttpError } from "./lib/mail-core.mjs";

// The public website (horsecargoltd.com) forwards each sourcing form here,
// server to server. It signs `${timestamp}.${body}` with WEBSITE_INTAKE_SECRET;
// unsigned, stale or altered requests are refused before touching the database.
const MAX_SKEW_SECONDS = 300;
const FIELDS = {
  reference: 40, full_name: 255, company: 255, email: 255, phone: 30, service: 255,
  product: 255, quantity: 100, origin_market: 100, destination: 255, timeline: 100,
  requirements: 5000, files: 3,
};

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
  body: JSON.stringify(body),
});

function signatureValid(event, secret) {
  const header = (name) => event.headers[name] || event.headers[name.toLowerCase()] || "";
  const ts = header("X-HC-Timestamp");
  const sig = header("X-HC-Signature");
  if (!/^\d{9,11}$/.test(ts) || !/^[a-f\d]{64}$/i.test(sig)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${event.body || ""}`).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return reply(405, { error: "Use POST." });
  const secret = process.env.WEBSITE_INTAKE_SECRET || "";
  if (secret.length < 32) return reply(503, { error: "Website intake is not configured." });
  if ((event.body || "").length > 20000) return reply(413, { error: "Request too large." });
  if (!signatureValid(event, secret)) return reply(401, { error: "Invalid signature." });
  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "Invalid request." });
  }
  const p = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    if (input[key] === undefined || input[key] === null) continue;
    p[key] = String(input[key]).slice(0, max);
  }
  if (!/^SRC-\d{6}-[A-Z0-9]{5}$/.test(p.reference || ""))
    return reply(400, { error: "Invalid website reference." });
  try {
    const result = await db("/rest/v1/rpc/website_intake", {
      method: "POST",
      body: { p },
      timeoutMs: 8000,
    });
    return reply(200, result);
  } catch (e) {
    return reply(e instanceof HttpError ? e.status : 502, {
      error: e instanceof HttpError ? e.message : "Could not record the request.",
    });
  }
}
