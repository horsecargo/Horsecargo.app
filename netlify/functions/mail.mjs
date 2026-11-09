import {
  authorize,
  db,
  mailboxFor,
  isUuid,
  encrypt,
  smtp,
  withImap,
  listMail,
  readMail,
  setMailState,
  sendMail,
  inboxStatus,
  required,
  fail,
  HttpError,
} from "./lib/mail-core.mjs";

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
  body: JSON.stringify(body),
});
export async function handler(event) {
  if (event.httpMethod !== "POST") return reply(405, { error: "Use POST." });
  try {
    if ((event.body || "").length > 4500000) fail(413, "Request too large.");
    let input;
    try {
      input = JSON.parse(event.body || "{}");
    } catch {
      fail(400, "Invalid request.");
    }
    const adminOnly = ["delete-user", "mailbox-connect", "mailbox-disconnect"];
    const p = await authorize(
      event,
      adminOnly.includes(input.action) ? "admin" : "mail.use",
    );
    if (input.action === "delete-user") {
      if (!/^[a-f\d-]{36}$/i.test(input.userId || "") || input.userId === p.id)
        fail(400, "You cannot delete yourself.");
      await db("/rest/v1/rpc/admin_prepare_delete_staff", {
        method: "POST",
        token: p.token,
        body: { p_user: input.userId, p_reason: String(input.reason || "") },
      });
      try {
        await db(`/auth/v1/admin/users/${input.userId}`, {
          method: "DELETE",
          body: { should_soft_delete: true },
        });
      } catch {
        return reply(202, {
          disabled: true,
          authDeleted: false,
          error:
            "App access removed. Auth cleanup needs an administrator retry.",
        });
      }
      await db(`/rest/v1/profiles?id=eq.${input.userId}`, {
        method: "PATCH",
        body: { auth_deleted_at: new Date().toISOString() },
      });
      return reply(200, { disabled: true, authDeleted: true });
    }
    if (input.action === "status") {
      // Mailboxes this person may use: administrators see every department.
      const all = await db(
        "/rest/v1/mail_mailboxes?select=id,email,name,password_cipher&order=name",
      );
      const mine =
        p.role === "admin"
          ? all
          : await db(
              `/rest/v1/mail_mailbox_members?user_id=eq.${p.id}&select=mailbox_id`,
            ).then((rows) => {
              const ids = new Set(rows.map((r) => r.mailbox_id));
              return all.filter((b) => ids.has(b.id));
            });
      return reply(200, {
        mailboxes: mine.map((b) => ({
          id: b.id,
          email: b.email,
          name: b.name,
          connected: !!b.password_cipher,
        })),
        admin: p.role === "admin",
        configured: !!(
          process.env.MAIL_IMAP_HOST &&
          process.env.MAIL_SMTP_HOST &&
          process.env.MAIL_ENCRYPTION_KEY
        ),
        vapidPublicKey: process.env.MAIL_VAPID_PUBLIC_KEY || "",
      });
    }
    if (input.action === "mailbox-connect") {
      // The CEO enters a department mailbox password once; staff never see it.
      if (!isUuid(input.mailbox)) fail(400, "Choose a mailbox.");
      const [box] = await db(
        `/rest/v1/mail_mailboxes?id=eq.${input.mailbox}&select=id,email,name`,
      );
      if (!box) fail(404, "Mailbox not found.");
      const domains = required("MAIL_ALLOWED_DOMAINS")
        .toLowerCase()
        .split(",")
        .map((x) => x.trim());
      if (!domains.includes(box.email.split("@")[1].toLowerCase()))
        fail(400, "Use a company mailbox in the configured email domain.");
      if (
        typeof input.password !== "string" ||
        !input.password ||
        input.password.length > 1024
      )
        fail(400, "Enter the mailbox password.");
      const a = { ...box, password_cipher: encrypt(input.password, box.id) };
      await withImap(a, async () => {});
      const transport = smtp(a);
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
      const baseline = await inboxStatus(a);
      await db(`/rest/v1/mail_mailboxes?id=eq.${box.id}`, {
        method: "PATCH",
        body: {
          password_cipher: a.password_cipher,
          last_uid: baseline.latestUid,
          uid_validity: baseline.validity,
          connected_by: p.id,
          updated_at: new Date().toISOString(),
        },
      });
      return reply(200, { connected: true, email: box.email });
    }
    if (input.action === "mailbox-disconnect") {
      if (!isUuid(input.mailbox)) fail(400, "Choose a mailbox.");
      await db(`/rest/v1/mail_mailboxes?id=eq.${input.mailbox}`, {
        method: "PATCH",
        body: {
          password_cipher: null,
          last_uid: null,
          uid_validity: null,
          updated_at: new Date().toISOString(),
        },
      });
      return reply(200, { ok: true });
    }
    if (input.action === "subscribe") {
      const s = input.subscription;
      let url;
      try {
        url = new URL(s?.endpoint);
      } catch {
        fail(400, "Invalid push subscription.");
      }
      const approved = [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
        "wns2-by3p.notify.windows.com",
      ];
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        !(
          approved.includes(url.hostname) ||
          url.hostname.endsWith(".notify.windows.com")
        )
      )
        fail(400, "Unsupported browser push service.");
      if (!s.keys?.p256dh || !s.keys?.auth || JSON.stringify(s).length > 4096)
        fail(400, "Invalid push keys.");
      // Never reassign an existing device endpoint to another account silently.
      await db(
        `/rest/v1/mail_push_subscriptions?user_id=eq.${p.id}&endpoint=eq.${encodeURIComponent(s.endpoint)}`,
        { method: "DELETE" },
      );
      await db("/rest/v1/mail_push_subscriptions", {
        method: "POST",
        body: { user_id: p.id, endpoint: s.endpoint, subscription: s },
      });
      return reply(200, { ok: true });
    }
    if (input.action === "unsubscribe") {
      await db(`/rest/v1/mail_push_subscriptions?user_id=eq.${p.id}`, {
        method: "DELETE",
      });
      return reply(200, { ok: true });
    }
    if (input.action === "drafts")
      return reply(
        200,
        await db(
          `/rest/v1/mail_drafts?user_id=eq.${p.id}&order=updated_at.desc&limit=100`,
        ),
      );
    if (input.action === "save-draft") {
      const payload = input.payload || {};
      if (JSON.stringify(payload).length > 110000)
        fail(400, "Draft is too large. Save attachments when sending.");
      if (input.id) {
        if (!/^[a-f\d-]{36}$/i.test(input.id)) fail(400, "Invalid draft.");
        const rows = await db(
          `/rest/v1/mail_drafts?id=eq.${input.id}&user_id=eq.${p.id}`,
          {
            method: "PATCH",
            prefer: "return=representation",
            body: { payload, updated_at: new Date().toISOString() },
          },
        );
        if (!rows.length) fail(404, "Draft not found.");
        return reply(200, rows[0]);
      }
      return reply(
        200,
        (
          await db("/rest/v1/mail_drafts", {
            method: "POST",
            prefer: "return=representation",
            body: { user_id: p.id, payload },
          })
        )[0],
      );
    }
    if (input.action === "delete-draft") {
      if (!/^[a-f\d-]{36}$/i.test(input.id || "")) fail(400, "Invalid draft.");
      await db(`/rest/v1/mail_drafts?id=eq.${input.id}&user_id=eq.${p.id}`, {
        method: "DELETE",
      });
      return reply(200, { ok: true });
    }
    const a = await mailboxFor(p, input.mailbox);
    if (input.action === "list") return reply(200, await listMail(a, input));
    if (input.action === "read") return reply(200, await readMail(a, input));
    if (input.action === "state")
      return reply(200, await setMailState(a, input));
    if (input.action === "send") return reply(200, await sendMail(a, p, input));
    if (input.action === "check") return reply(200, await inboxStatus(a));
    fail(400, "Unknown mail action.");
  } catch (e) {
    return reply(e instanceof HttpError ? e.status : 502, {
      error:
        e instanceof HttpError
          ? e.message
          : "Cannot connect to the mailbox. Check your email, password and server settings.",
    });
  }
}
