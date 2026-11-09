import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { simpleParser } from "mailparser";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export const required = (name) =>
  process.env[name] ||
  fail(
    503,
    "Mail service is not configured. Ask the administrator to complete server setup.",
  );
// The mailbox ID is bound to each ciphertext, so a password cannot be copied
// from one mailbox row to another.
export function encrypt(password, userId) {
  const key = Buffer.from(required("MAIL_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32)
    fail(503, "Invalid mail encryption key configuration.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(userId));
  return [iv, c.update(password, "utf8"), c.final(), c.getAuthTag()]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(value, userId) {
  const [iv, data, tail, tag] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64"));
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(required("MAIL_ENCRYPTION_KEY"), "base64"),
    iv,
  );
  c.setAAD(Buffer.from(userId));
  c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.update(tail), c.final()]).toString(
    "utf8",
  );
}
export async function db(
  path,
  { method = "GET", body, token, prefer, timeoutMs = 20000 } = {},
) {
  const res = await fetch(`${required("SUPABASE_URL")}${path}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      apikey: required("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${token || required("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 409)
      fail(409, "This request has already been processed.");
    // Database details and provider responses can contain sensitive information.
    fail(
      res.status === 401 || res.status === 403 ? 403 : 503,
      "The server could not complete the request. Check permissions and database migration.",
    );
  }
  return data;
}
export async function authorize(event, permission = "mail.use") {
  const token = (
    event.headers.authorization ||
    event.headers.Authorization ||
    ""
  ).replace(/^Bearer /i, "");
  if (!token || token.length > 8192) fail(401, "Please sign in.");
  const user = await db("/auth/v1/user", { token });
  const [p] = await db(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,role,active,deleted_at`,
  );
  if (!p?.active || p.deleted_at) fail(403, "Your staff account is inactive.");
  if (permission === "admin") {
    if (p.role !== "admin") fail(403, "Administrator access required.");
  } else if (
    !(await db("/rest/v1/rpc/has_perm", {
      method: "POST",
      token,
      body: { p_perm: permission },
    }))
  )
    fail(403, "Mail access is not allowed.");
  return { ...p, token };
}
export const isUuid = (v) => /^[a-f\d-]{36}$/i.test(v || "");
// A department mailbox the signed-in staff member may use (admins: any).
export async function mailboxFor(profile, id) {
  if (!isUuid(id)) fail(400, "Choose a mailbox.");
  if (
    !(await db("/rest/v1/rpc/mail_can_use_mailbox", {
      method: "POST",
      body: { p_user: profile.id, p_mailbox: id },
    }))
  )
    fail(403, "You are not assigned to this mailbox.");
  const [a] = await db(`/rest/v1/mail_mailboxes?id=eq.${id}&select=*`);
  if (!a?.password_cipher)
    fail(409, "This mailbox is not connected yet. Ask the CEO to connect it.");
  return a;
}
export const COMPANY_LINE =
  "Horse Cargo Ltd | +971 50 608 3531 | horsecargoltd.com";
// Every department email names the staff member who wrote it.
export function signature(profile, mailbox) {
  return `\n\n--\n${profile.full_name || profile.email}\n${mailbox.name}\n${COMPANY_LINE}`;
}
export function smtp(account) {
  const port = Number(process.env.MAIL_SMTP_PORT || 465);
  if (![465, 587].includes(port))
    fail(503, "SMTP must use TLS on port 465 or 587.");
  return nodemailer.createTransport({
    host: required("MAIL_SMTP_HOST"),
    port,
    secure: port === 465,
    requireTLS: true,
    auth: {
      user: account.email,
      pass: decrypt(account.password_cipher, account.id),
    },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 25000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function withImap(account, fn, { deadlineMs = 50000 } = {}) {
  const client = new ImapFlow({
    host: required("MAIL_IMAP_HOST"),
    port: 993,
    secure: true,
    auth: {
      user: account.email,
      pass: decrypt(account.password_cipher, account.id),
    },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 25000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    maxIdleTime: 15000,
  });
  client.on("error", () => {}); // Errors are returned to the caller without logging passwords or message bodies.
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      client.close();
      reject(new HttpError(504, "Mailbox connection timed out. Try again."));
    }, deadlineMs);
    timer.unref();
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        await client.connect();
        return fn(client);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    // Never let a provider's stalled LOGOUT exceed the function deadline.
    const shutdown = setTimeout(() => client.close(), 500);
    shutdown.unref();
    try {
      if (client.usable) await client.logout();
      else client.close();
    } catch {
      client.close();
    } finally {
      clearTimeout(shutdown);
    }
  }
}
export const folderNames = {
  inbox: "INBOX",
  sent: "\\Sent",
  drafts: "\\Drafts",
  trash: "\\Trash",
  archive: "\\Archive",
  spam: "\\Junk",
};
export async function folderPath(client, folder, create = false) {
  if (folder === "starred") folder = "inbox";
  if (!(folder in folderNames)) fail(400, "Invalid mail folder.");
  if (folder === "inbox") return "INBOX";
  const configured = process.env[`MAIL_FOLDER_${folder.toUpperCase()}`];
  const list = await client.list();
  const path =
    configured || list.find((f) => f.specialUse === folderNames[folder])?.path;
  if (path) return path;
  const fallback = {
    sent: "Sent",
    drafts: "Drafts",
    trash: "Trash",
    archive: "Archive",
    spam: "Junk",
  }[folder];
  const existing = list.find(
    (f) => f.path === fallback || f.path === `INBOX.${fallback}`,
  );
  if (existing) return existing.path;
  if (create) {
    await client.mailboxCreate(fallback);
    return fallback;
  }
  return null;
}
export const addresses = (values) =>
  (values || []).map((x) => ({ name: x.name || "", address: x.address || "" }));
export const summary = (m) => ({
  uid: m.uid,
  subject: m.envelope?.subject || "(No subject)",
  from: addresses(m.envelope?.from),
  to: addresses(m.envelope?.to),
  cc: addresses(m.envelope?.cc),
  date: m.envelope?.date || m.internalDate,
  unread: !m.flags.has("\\Seen"),
  starred: m.flags.has("\\Flagged"),
  size: m.size,
  messageId: m.envelope?.messageId || "",
});
export function uid(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail(400, "Invalid message.");
  return n;
}
export function validateRecipients(value, requiredTo = false) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  const clean = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
  if (
    clean.length > 30 ||
    (requiredTo && !clean.length) ||
    clean.some(
      (v) =>
        v.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v),
    )
  )
    fail(400, "Enter valid email addresses (maximum 30 recipients).");
  return clean;
}
export function validateMessage(input) {
  const to = validateRecipients(input.to, true);
  const cc = validateRecipients(input.cc);
  const bcc = validateRecipients(input.bcc);
  if (to.length + cc.length + bcc.length > 30)
    fail(400, "Maximum 30 recipients per message.");
  const subject = String(input.subject || "").trim();
  const text = String(input.text || "");
  if (
    !subject ||
    subject.length > 200 ||
    /[\r\n]/.test(subject) ||
    !text.trim() ||
    text.length > 100000
  )
    fail(400, "Enter a subject and message (maximum 100,000 characters).");
  let bytes = 0;
  const attachments = (input.attachments || []).map((a) => {
    const content = Buffer.from(String(a.content || ""), "base64");
    bytes += content.length;
    return {
      filename: String(a.filename || "attachment")
        .replace(/[\r\n/\\]/g, "_")
        .slice(0, 150),
      content,
      contentType: "application/octet-stream",
    };
  });
  if (attachments.length > 10 || bytes > 3 * 1024 * 1024)
    fail(400, "Attachments must total 3 MB or less (maximum 10 files).");
  const inReplyTo = /^[^\r\n]{1,998}$/.test(input.inReplyTo || "")
    ? input.inReplyTo
    : undefined;
  return {
    to,
    cc,
    bcc,
    subject,
    text,
    attachments,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  };
}
export async function listMail(a, input) {
  return withImap(a, async (c) => {
    const folder = input.folder || "inbox";
    const path = await folderPath(c, folder);
    if (!path) return { rows: [], total: 0, validity: "", offset: 0 };
    const lock = await c.getMailboxLock(path);
    try {
      const q = String(input.q || "")
        .trim()
        .slice(0, 200);
      const search = {
        ...(q
          ? { or: [{ subject: q }, { from: q }, { to: q }, { body: q }] }
          : { all: true }),
        ...(folder === "starred" ? { flagged: true } : {}),
      };
      const ids = ((await c.search(search, { uid: true })) || []).sort(
        (a, b) => b - a,
      );
      const offset = Math.max(
        0,
        Math.min(Number(input.offset) || 0, ids.length),
      );
      const page = ids.slice(offset, offset + 30);
      const rows = page.length
        ? (
            await c.fetchAll(
              page,
              {
                uid: true,
                envelope: true,
                flags: true,
                size: true,
                internalDate: true,
              },
              { uid: true },
            )
          )
            .map(summary)
            .sort((a, b) => b.uid - a.uid)
        : [];
      return {
        rows,
        total: ids.length,
        offset,
        validity: String(c.mailbox.uidValidity),
      };
    } finally {
      lock.release();
    }
  });
}
export async function readMail(a, input) {
  return withImap(a, async (c) => {
    const path = await folderPath(c, input.folder || "inbox");
    if (!path) fail(404, "Message not found.");
    const lock = await c.getMailboxLock(path);
    try {
      if (String(c.mailbox.uidValidity) !== String(input.validity))
        fail(409, "Mailbox changed. Refresh the folder.");
      const id = uid(input.uid);
      const meta = await c.fetchOne(String(id), { size: true }, { uid: true });
      if (!meta) fail(404, "Message not found.");
      if (meta.size > 15 * 1024 * 1024)
        fail(
          413,
          "This message is larger than 15 MB. Open it in cPanel webmail.",
        );
      const m = await c.fetchOne(
        String(id),
        { source: true, envelope: true, flags: true, uid: true },
        { uid: true },
      );
      const parsed = await simpleParser(m.source, {
        skipHtmlToText: false,
        skipTextToHtml: true,
        skipImageLinks: true,
      });
      if (input.attachment !== undefined) {
        const file = parsed.attachments[Number(input.attachment)];
        if (!file || file.size > 3 * 1024 * 1024)
          fail(
            413,
            "Download attachments larger than 3 MB from cPanel webmail.",
          );
        return {
          filename: file.filename || "attachment",
          content: file.content.toString("base64"),
        };
      }
      await c.messageFlagsAdd(String(id), ["\\Seen"], { uid: true });
      return {
        ...summary(m),
        unread: false,
        replyTo: addresses(parsed.replyTo?.value || parsed.from?.value),
        text: parsed.text || "(This message has no text content.)",
        attachments: parsed.attachments.map((x, index) => ({
          index,
          filename: x.filename || "attachment",
          size: x.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}
export async function setMailState(a, input) {
  return withImap(a, async (c) => {
    const path = await folderPath(c, input.folder || "inbox");
    if (!path) fail(404, "Folder not found.");
    const destination = ["trash", "archive", "inbox"].includes(input.state)
      ? await folderPath(c, input.state, true)
      : null;
    const lock = await c.getMailboxLock(path);
    try {
      if (String(c.mailbox.uidValidity) !== String(input.validity))
        fail(409, "Mailbox changed. Refresh the folder.");
      const ids = (input.uids || []).map(uid);
      if (!ids.length || ids.length > 30)
        fail(400, "Select up to 30 messages.");
      if (destination) await c.messageMove(ids, destination, { uid: true });
      else if (input.state === "unread")
        await c.messageFlagsRemove(ids, ["\\Seen"], { uid: true });
      else if (input.state === "read")
        await c.messageFlagsAdd(ids, ["\\Seen"], { uid: true });
      else if (input.state === "star")
        await c.messageFlagsAdd(ids, ["\\Flagged"], { uid: true });
      else if (input.state === "unstar")
        await c.messageFlagsRemove(ids, ["\\Flagged"], { uid: true });
      else fail(400, "Invalid message action.");
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}
export async function sendMail(a, profile, input) {
  if (!/^[a-f\d-]{36}$/i.test(input.requestId || ""))
    fail(400, "Invalid send request.");
  const message = validateMessage(input);
  const [old] = await db(
    `/rest/v1/mail_deliveries?id=eq.${input.requestId}&user_id=eq.${profile.id}`,
  );
  if (old)
    return {
      status: old.status,
      messageId: old.message_id,
      sentCopy: old.sent_copy,
    };
  // Verify the IMAP destination before attempting SMTP. A sent-copy failure must
  // never make the UI retry delivery automatically.
  return withImap(a, async (c) => {
    const sentPath = await folderPath(c, "sent", true);
    await db("/rest/v1/mail_deliveries", {
      method: "POST",
      body: { id: input.requestId, user_id: profile.id, mailbox_id: a.id },
    });
    const transport = smtp(a);
    const messageId = `<${input.requestId}@${a.email.split("@")[1]}>`;
    const raw = await new MailComposer({
      ...message,
      text: message.text + signature(profile, a),
      from: {
        name: `${profile.full_name || profile.email} – ${a.name}`,
        address: a.email,
      },
      messageId,
      date: new Date(),
      disableFileAccess: true,
      disableUrlAccess: true,
    })
      .compile()
      .build();
    try {
      const result = await transport.sendMail({
        envelope: {
          from: a.email,
          to: [...message.to, ...message.cc, ...message.bcc],
        },
        raw,
      });
      // Partial acceptance is reported: never claim every recipient received it.
      let sentCopy = true;
      try {
        await c.append(sentPath, raw, ["\\Seen"]);
      } catch {
        sentCopy = false;
      }
      await db(`/rest/v1/mail_deliveries?id=eq.${input.requestId}`, {
        method: "PATCH",
        body: { status: "sent", message_id: messageId, sent_copy: sentCopy },
      });
      return {
        status: "sent",
        messageId,
        sentCopy,
        rejected: result.rejected || [],
      };
    } catch (e) {
      await db(`/rest/v1/mail_deliveries?id=eq.${input.requestId}`, {
        method: "PATCH",
        body: { status: "uncertain" },
      });
      return { status: "uncertain" };
    } finally {
      transport.close();
    }
  });
}
export async function inboxStatus(a, options) {
  return withImap(
    a,
    async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        const status = await c.status("INBOX", {
          unseen: true,
          uidNext: true,
          uidValidity: true,
        });
        const latest = c.mailbox.exists
          ? await c.fetchOne("*", { uid: true, envelope: true, flags: true })
          : null;
        return {
          unread: status.unseen || 0,
          latestUid: latest?.uid || 0,
          validity: String(status.uidValidity),
          latest: latest ? summary(latest) : null,
        };
      } finally {
        lock.release();
      }
    },
    options,
  );
}
