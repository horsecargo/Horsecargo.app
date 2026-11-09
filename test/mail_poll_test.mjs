import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import webpush from "web-push";
import pollMail, { config } from "../netlify/functions/mail-poll.mjs";
import { encrypt } from "../netlify/functions/lib/mail-core.mjs";
process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MAIL_IMAP_HOST = "fixture.invalid";
const keys = webpush.generateVAPIDKeys();
process.env.MAIL_VAPID_PUBLIC_KEY = keys.publicKey;
process.env.MAIL_VAPID_PRIVATE_KEY = keys.privateKey;
process.env.MAIL_VAPID_SUBJECT = "mailto:admin@hc.test";
const id = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const boxId = "00000000-0000-0000-0000-0000000000b1";
// v10: the scheduled check runs per department mailbox and notifies its members.
const account = {
  id: boxId,
  email: "sales@hc.test",
  name: "Sales",
  password_cipher: encrypt("fixture", boxId),
  last_uid: 30,
  uid_validity: "5",
};
let subsQuery = "";
let allowed = true,
  claim = true,
  newUid = 31,
  validity = 5n,
  sent = [],
  drop = [],
  pushError = 0,
  checks = 0,
  connections = 0;
const ok = (v, m) => {
  assert.ok(v, m);
  checks++;
  console.log("PASS " + m);
};
const response = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.pathname === "/rest/v1/mail_mailboxes") {
    if (init.method === "PATCH") {
      Object.assign(account, body);
      return response(null);
    }
    return response([{ ...account }]);
  }
  if (u.pathname.endsWith("/mail_claim_mailbox")) return response(claim);
  if (u.pathname.endsWith("/mail_can_use_mailbox")) return response(allowed);
  if (u.pathname === "/rest/v1/mail_mailbox_members")
    return response([{ user_id: member }]);
  if (u.pathname === "/rest/v1/profiles") return response([{ id }]);
  if (u.pathname === "/rest/v1/mail_push_subscriptions") {
    if (init.method === "DELETE") {
      drop.push(u.search);
      return response(null);
    }
    subsQuery = decodeURIComponent(u.search);
    return response([
      {
        id: "fixture-sub",
        user_id: member,
        subscription: { endpoint: "https://fcm.googleapis.com/fixture" },
      },
    ]);
  }
  throw Error("Unexpected fixture " + url);
};
const originals = {};
for (const key of ["connect", "logout", "status", "fetchOne", "getMailboxLock"])
  originals[key] = ImapFlow.prototype[key];
ImapFlow.prototype.connect = async function () {
  connections++;
  this.mailbox = { exists: 1, uidValidity: validity };
};
ImapFlow.prototype.logout = async () => {};
ImapFlow.prototype.getMailboxLock = async () => ({ release() {} });
ImapFlow.prototype.status = async () => ({
  uidValidity: validity,
  unseen: 1,
  uidNext: newUid + 1,
});
ImapFlow.prototype.fetchOne = async () => ({
  uid: newUid,
  envelope: {
    subject: "Private customer subject",
    from: [{ address: "private-customer@example.com" }],
  },
  flags: new Set(),
});
const originalPush = webpush.sendNotification;
webpush.sendNotification = async (s, p) => {
  if (pushError)
    throw Object.assign(Error("fixture"), { statusCode: pushError });
  sent.push(JSON.parse(p));
};
try {
  ok(
    config.schedule === "*/2 * * * *",
    "production schedule checks every two minutes",
  );
  await pollMail();
  ok(
    sent.length === 1 && account.last_uid === 31,
    "new UID sends push and advances cursor",
  );
  ok(
    subsQuery.includes(member) && subsQuery.includes(id),
    "department members and administrators are notified",
  );
  ok(
    sent[0].userId === member && sent[0].title.includes("Sales"),
    "push names the department and is addressed to the subscriber",
  );
  ok(
    !JSON.stringify(sent[0]).includes("private-customer") &&
      !JSON.stringify(sent[0]).includes("Private customer"),
    "push payload excludes customer contents",
  );
  await pollMail();
  ok(sent.length === 1, "same UID never creates another push");
  validity = 6n;
  await pollMail();
  ok(
    sent.length === 1 && account.uid_validity === "6",
    "UIDVALIDITY reset establishes new baseline",
  );
  newUid = 32;
  pushError = 503;
  await pollMail();
  ok(
    account.last_uid === 31,
    "transient push failure preserves cursor for retry",
  );
  pushError = 0;
  await pollMail();
  ok(
    account.last_uid === 32 && sent.length === 2,
    "transient failure retries on next scheduled check",
  );
  newUid = 33;
  pushError = 410;
  await pollMail();
  ok(
    drop.length === 1 && account.last_uid === 33,
    "expired push subscription removed without blocking cursor",
  );
  pushError = 0;
  allowed = false;
  const n = connections;
  newUid = 34;
  await pollMail();
  ok(
    connections === n && account.last_uid === 33,
    "nobody allowed on a mailbox prevents background mailbox access",
  );
  allowed = true;
  claim = false;
  await pollMail();
  ok(
    connections === n,
    "overlapping poll cannot acquire another account lease",
  );
  delete process.env.MAIL_VAPID_PRIVATE_KEY;
  const result = await pollMail();
  ok(
    result.status === 204 && connections === n,
    "unconfigured push remains dormant",
  );
  console.log(
    `Scheduled push checks: ${checks} passed (synthetic IMAP/Web Push, no real notification sent).`,
  );
} finally {
  Object.assign(ImapFlow.prototype, originals);
  webpush.sendNotification = originalPush;
}
