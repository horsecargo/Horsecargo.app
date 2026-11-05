import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { handler } from "../netlify/functions/website-intake.mjs";

process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-only";
const secret = randomBytes(32).toString("hex");
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ lead: "LEAD-20261104-001", sourcing: "SRC-20261104-001", duplicate: false }));
};
const form = {
  reference: "SRC-261104-AB12C", full_name: "Asha Test", email: "asha@example.com", phone: "+255700000000",
  service: "Product Sourcing", product: "Solar panels", quantity: "500 pcs", destination: "Dar es Salaam",
  requirements: "Need 450W panels", extra: "ignored",
};
const send = (body, { ts = Math.floor(Date.now() / 1000), key = secret, sig } = {}) => handler({
  httpMethod: "POST",
  body,
  headers: {
    "x-hc-timestamp": String(ts),
    "x-hc-signature": sig ?? createHmac("sha256", key).update(`${ts}.${body}`).digest("hex"),
  },
});

process.env.WEBSITE_INTAKE_SECRET = "";
assert.equal((await send(JSON.stringify(form))).statusCode, 503, "unconfigured secret refuses");
process.env.WEBSITE_INTAKE_SECRET = secret;

assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
assert.equal((await send(JSON.stringify(form), { key: "wrong-secret-wrong-secret-wrong-secret" })).statusCode, 401, "wrong key");
assert.equal((await send(JSON.stringify(form), { ts: Math.floor(Date.now() / 1000) - 3600 })).statusCode, 401, "stale timestamp");
const tampered = await handler({ httpMethod: "POST", body: JSON.stringify({ ...form, phone: "x" }),
  headers: { "x-hc-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-hc-signature": createHmac("sha256", secret).update(`${Math.floor(Date.now() / 1000)}.${JSON.stringify(form)}`).digest("hex") } });
assert.equal(tampered.statusCode, 401, "altered body");
assert.equal((await send(JSON.stringify({ ...form, reference: "../etc" }))).statusCode, 400, "bad reference");
assert.equal(calls.length, 0, "nothing reaches the database before the checks pass");

const ok = await send(JSON.stringify(form));
assert.equal(ok.statusCode, 200);
assert.equal(JSON.parse(ok.body).sourcing, "SRC-20261104-001");
assert.equal(calls.length, 1);
assert.match(calls[0].url, /\/rest\/v1\/rpc\/website_intake$/);
assert.equal(calls[0].body.p.product, "Solar panels");
assert.equal(calls[0].body.p.extra, undefined, "unknown fields are dropped");

console.log("website intake: all checks passed");
