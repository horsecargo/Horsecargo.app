import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import {
  encrypt,
  decrypt,
  validateMessage,
  validateRecipients,
  sendMail,
  listMail,
  readMail,
  setMailState,
} from "../netlify/functions/lib/mail-core.mjs";
import { handler } from "../netlify/functions/mail.mjs";

process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-only";
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MAIL_IMAP_HOST = "fixture.invalid";
process.env.MAIL_SMTP_HOST = "fixture.invalid";
process.env.MAIL_ALLOWED_DOMAINS = "hc.test";
const id = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const a = {
  user_id: id,
  email: "admin@hc.test",
  password_cipher: encrypt("fixture-password", id),
};
let checks = 0;
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks++;
  console.log("PASS " + label);
};
ok(
  !a.password_cipher.includes("fixture-password") &&
    decrypt(a.password_cipher, id) === "fixture-password",
  "AES-GCM encrypted password roundtrip",
);
assert.throws(() => decrypt(a.password_cipher, other));
checks++;
const tampered = a.password_cipher.split(".");
tampered[1] = Buffer.from("bad").toString("base64");
assert.throws(() => decrypt(tampered.join("."), id));
checks++;
for (const addresses of [
  "bad",
  "x@example.com\r\nBcc:a@b.com",
  "a@b.com,evil",
  "<x@example.com>",
]) {
  assert.throws(() => validateRecipients(addresses, true));
  checks++;
}
const good = {
  to: "customer@example.com",
  cc: "colleague@hc.test",
  bcc: "hidden@hc.test",
  subject: "Fixture shipment",
  text: "Fixture text",
};
ok(
  validateMessage(good).to[0] === "customer@example.com",
  "external/customer recipient supported",
);
assert.throws(() =>
  validateMessage({ ...good, subject: "Injected\r\nBcc: someone@evil.com" }),
);
checks++;
assert.throws(() =>
  validateMessage({
    ...good,
    attachments: [
      {
        filename: "large",
        content: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
      },
    ],
  }),
);
checks++;
const deliveries = new Map();
let profile = {
  id,
  email: a.email,
  active: true,
  role: "admin",
  full_name: "Fixture Admin",
};
let allow = true;
let authFail = false;
let authDeletes = 0;
let sent = 0;
let appendFails = false;
let smtpFails = false;
let raw = "";
let action = "";
let storedDraft;
let savedAccount;
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.pathname === "/auth/v1/user")
    return init.headers.Authorization === "Bearer fixture-token"
      ? response({ id })
      : response({ error: "bad" }, 401);
  if (u.pathname === "/rest/v1/profiles") return response([profile]);
  if (u.pathname === "/rest/v1/rpc/has_perm") return response(allow);
  if (u.pathname === "/rest/v1/rpc/admin_prepare_delete_staff")
    return response(null);
  if (u.pathname.startsWith("/auth/v1/admin/users/")) {
    authDeletes++;
    return response(
      authFail ? { error: "fixture" } : { user: {} },
      authFail ? 503 : 200,
    );
  }
  if (u.pathname === "/rest/v1/mail_accounts") {
    if (init.method === "POST") savedAccount = body;
    return response([a]);
  }
  if (u.pathname === "/rest/v1/mail_drafts") {
    storedDraft = { url: u.toString(), body };
    return response([{ id: other, payload: body?.payload }]);
  }
  if (u.pathname === "/rest/v1/mail_deliveries") {
    const key = (u.searchParams.get("id") || "").replace("eq.", "");
    if (init.method === "POST") {
      if (deliveries.has(body.id)) return response({}, 409);
      deliveries.set(body.id, { ...body, status: "sending" });
      return response(null);
    }
    if (init.method === "PATCH") {
      Object.assign(deliveries.get(key), body);
      return response(null);
    }
    return response(deliveries.has(key) ? [deliveries.get(key)] : []);
  }
  throw Error("Unexpected fixture URL " + url);
};
const originalTransport = nodemailer.createTransport;
nodemailer.createTransport = (options) => {
  ok(
    options.tls.rejectUnauthorized && options.requireTLS,
    "SMTP TLS verification cannot be disabled",
  );
  return {
    verify: async () => true,
    close() {},
    sendMail: async (input) => {
      sent++;
      raw = input.raw.toString();
      if (smtpFails) throw Error("fixture timeout");
      return { accepted: ["customer@example.com"], rejected: [] };
    },
  };
};
const original = {};
for (const name of [
  "connect",
  "logout",
  "list",
  "getMailboxLock",
  "append",
  "fetchAll",
  "search",
  "fetchOne",
  "messageFlagsAdd",
  "messageFlagsRemove",
  "messageMove",
  "status",
])
  original[name] = ImapFlow.prototype[name];
ImapFlow.prototype.connect = async function () {
  this.mailbox = { uidValidity: 5n, exists: 1 };
};
ImapFlow.prototype.logout = async () => {};
ImapFlow.prototype.list = async () => [
  { path: "Sent", specialUse: "\\Sent" },
  { path: "Trash", specialUse: "\\Trash" },
];
ImapFlow.prototype.getMailboxLock = async () => ({ release() {} });
ImapFlow.prototype.append = async () => {
  if (appendFails) throw Error("fixture append failure");
  return { uid: 2 };
};
ImapFlow.prototype.search = async () =>
  Array.from({ length: 45 }, (_, i) => i + 1);
ImapFlow.prototype.fetchAll = async function (ids) {
  return ids.map((uid) => ({
    uid,
    envelope: { subject: "Fixture", from: [{ address: "sender@hc.test" }] },
    flags: new Set(),
  }));
};
ImapFlow.prototype.status = async () => ({ uidValidity: 5n, unseen: 1 });
ImapFlow.prototype.fetchOne = async function (id, query) {
  if (query.source)
    return {
      uid: 1,
      envelope: { subject: "Fixture" },
      flags: new Set(),
      source: Buffer.from(
        "From: Sender <sender@hc.test>\r\nTo: admin@hc.test\r\nSubject: Fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSafe text <script>bad()</script>",
      ),
    };
  if (query.envelope)
    return { uid: 9, envelope: { subject: "Old fixture" }, flags: new Set() };
  return { size: 200 };
};
ImapFlow.prototype.messageFlagsAdd = async () => {
  action = "read";
};
ImapFlow.prototype.messageFlagsRemove = async () => {
  action = "unread";
};
ImapFlow.prototype.messageMove = async () => {
  action = "move";
};
try {
  let r = await sendMail(a, profile, {
    ...good,
    requestId: crypto.randomUUID(),
  });
  ok(
    r.status === "sent" && r.sentCopy && sent === 1,
    "SMTP accepted and IMAP Sent copy stored",
  );
  ok(
    !raw.includes("Bcc:") && !raw.includes("hidden@hc.test"),
    "BCC hidden from raw message/Sent copy",
  );
  const requestId = crypto.randomUUID();
  await sendMail(a, profile, { ...good, requestId });
  await sendMail(a, profile, { ...good, requestId });
  ok(sent === 2, "durable send request prevents duplicate SMTP send");
  appendFails = true;
  r = await sendMail(a, profile, { ...good, requestId: crypto.randomUUID() });
  ok(
    r.status === "sent" && !r.sentCopy,
    "Sent copy failure preserves successful SMTP status",
  );
  appendFails = false;
  smtpFails = true;
  const uncertainId = crypto.randomUUID();
  r = await sendMail(a, profile, { ...good, requestId: uncertainId });
  const before = sent;
  await sendMail(a, profile, { ...good, requestId: uncertainId });
  ok(
    r.status === "uncertain" && sent === before,
    "uncertain SMTP outcome is never automatically resent",
  );
  smtpFails = false;
  r = await listMail(a, { folder: "inbox", offset: 30 });
  ok(
    r.rows.length === 15 && r.total === 45 && r.rows[0].uid === 15,
    "IMAP UID pagination uses latest 30 first",
  );
  r = await readMail(a, { folder: "inbox", uid: 1, validity: "5" });
  ok(
    r.text.includes("<script>") && action === "read",
    "read returns inert text and marks message read",
  );
  await assert.rejects(
    readMail(a, { folder: "inbox", uid: 1, validity: "4" }),
    /Mailbox changed/,
  );
  checks++;
  await setMailState(a, {
    folder: "inbox",
    uids: [1],
    validity: "5",
    state: "trash",
  });
  ok(action === "move", "Trash moves message rather than permanently deleting");
  const event = (body, token = "fixture-token") => ({
    httpMethod: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  r = await handler(event({ action: "status" }, "bad"));
  ok(r.statusCode === 403, "invalid auth token refused");
  profile.active = false;
  r = await handler(event({ action: "status" }));
  ok(r.statusCode === 403, "inactive user with existing token refused");
  profile.active = true;
  allow = false;
  r = await handler(event({ action: "list" }));
  ok(r.statusCode === 403, "mail permission revoked on server");
  allow = true;
  profile.role = "hr";
  r = await handler(event({ action: "delete-user", userId: other }));
  ok(
    r.statusCode === 403 && authDeletes === 0,
    "non-admin cannot delete Auth users",
  );
  profile.role = "admin";
  r = await handler(event({ action: "delete-user", userId: id }));
  ok(r.statusCode === 400, "self deletion refused by server endpoint");
  authFail = true;
  r = await handler(
    event({ action: "delete-user", userId: other, reason: "fixture" }),
  );
  ok(
    r.statusCode === 202 &&
      JSON.parse(r.body).disabled &&
      !JSON.parse(r.body).authDeleted,
    "Auth failure is visible as incomplete cleanup",
  );
  authFail = false;
  r = await handler(
    event({ action: "delete-user", userId: other, reason: "fixture" }),
  );
  ok(
    r.statusCode === 200 && JSON.parse(r.body).authDeleted,
    "admin Auth cleanup can complete on retry",
  );
  r = await handler(
    event({
      action: "subscribe",
      subscription: {
        endpoint: "https://127.0.0.1/internal",
        keys: { p256dh: "a", auth: "b" },
      },
    }),
  );
  ok(r.statusCode === 400, "push endpoint SSRF refused");
  r = await handler(
    event({
      action: "connect",
      email: "user@external.test",
      password: "fixture",
    }),
  );
  ok(
    r.statusCode === 400,
    "mailbox connection restricted to configured company domains",
  );
  r = await handler(
    event({ action: "connect", email: a.email, password: "fixture-password" }),
  );
  ok(
    r.statusCode === 200 &&
      savedAccount.last_uid === 9 &&
      savedAccount.uid_validity === "5" &&
      !JSON.stringify(savedAccount).includes("fixture-password"),
    "connect verifies both transports, encrypts password and establishes new-mail baseline",
  );
  r = await handler(
    event({ action: "save-draft", id: other, payload: { subject: "Fixture" } }),
  );
  ok(
    r.statusCode === 200 && storedDraft.url.includes("user_id=eq." + id),
    "draft update scoped to authenticated user",
  );
  console.log(
    `Mail transport and endpoint checks: ${checks} passed (mock IMAP/SMTP/Auth, no external mail sent).`,
  );
} finally {
  nodemailer.createTransport = originalTransport;
  Object.assign(ImapFlow.prototype, original);
}
