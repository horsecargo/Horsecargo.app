import webpush from "web-push";
import { db, inboxStatus } from "./lib/mail-core.mjs";

export const config = { schedule: "*/2 * * * *" };
export default async function pollMail() {
  if (
    !process.env.MAIL_VAPID_PUBLIC_KEY ||
    !process.env.MAIL_VAPID_PRIVATE_KEY ||
    !process.env.MAIL_VAPID_SUBJECT
  )
    return new Response(null, { status: 204 });
  const deadline = Date.now() + 23000;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms < 100) throw Error("Scheduled poll time budget exhausted");
    return ms;
  };
  const query = (path, options = {}) =>
    db(path, { ...options, timeoutMs: Math.min(3000, remaining()) });
  webpush.setVapidDetails(
    process.env.MAIL_VAPID_SUBJECT,
    process.env.MAIL_VAPID_PUBLIC_KEY,
    process.env.MAIL_VAPID_PRIVATE_KEY,
  );
  // Bounded batch of connected department mailboxes, oldest first. Failed
  // mailboxes rotate to the back as well.
  const mailboxes = await query(
    "/rest/v1/mail_mailboxes?password_cipher=not.is.null&select=*&order=updated_at.asc&limit=20",
  );
  const results = await Promise.allSettled(
    mailboxes.map(async (a) => {
      if (
        !(await query("/rest/v1/rpc/mail_claim_mailbox", {
          method: "POST",
          body: { p_mailbox: a.id },
        }))
      )
        return;
      try {
        // Members of the mailbox plus administrators who may still use mail.
        // Nobody allowed means no background IMAP login at all.
        const [members, admins] = await Promise.all([
          query(
            `/rest/v1/mail_mailbox_members?mailbox_id=eq.${a.id}&select=user_id`,
          ),
          query(
            "/rest/v1/profiles?role=eq.admin&active=is.true&deleted_at=is.null&select=id",
          ),
        ]);
        const allowed = [];
        for (const id of new Set([
          ...members.map((m) => m.user_id),
          ...admins.map((x) => x.id),
        ]))
          if (
            await query("/rest/v1/rpc/mail_can_use_mailbox", {
              method: "POST",
              body: { p_user: id, p_mailbox: a.id },
            })
          )
            allowed.push(id);
        if (!allowed.length) return;
        const status = await inboxStatus(a, {
          deadlineMs: Math.min(12000, remaining()),
        });
        const isNew =
          a.last_uid !== null &&
          a.uid_validity === status.validity &&
          status.latestUid > Number(a.last_uid);
        if (isNew) {
          const subs = await query(
            `/rest/v1/mail_push_subscriptions?user_id=in.(${allowed.join(",")})`,
          );
          const pushes = await Promise.allSettled(
            subs.map(async (s) => {
              try {
                await webpush.sendNotification(
                  s.subscription,
                  JSON.stringify({
                    title: `Horse Cargo · ${a.name}`,
                    body: "New email in a department mailbox. Open Mail to read it.",
                    userId: s.user_id,
                    tag: `mail-${a.id}-${status.validity}-${status.latestUid}`,
                  }),
                  { TTL: 300, timeout: Math.min(4000, remaining()) },
                );
              } catch (e) {
                if ([404, 410].includes(e.statusCode))
                  await query(
                    `/rest/v1/mail_push_subscriptions?id=eq.${s.id}`,
                    { method: "DELETE" },
                  );
                else throw e;
              }
            }),
          );
          if (pushes.some((p) => p.status === "rejected"))
            throw Error("Push delivery needs retry");
        }
        await query(`/rest/v1/mail_mailboxes?id=eq.${a.id}`, {
          method: "PATCH",
          body: { last_uid: status.latestUid, uid_validity: status.validity },
        });
      } finally {
        await query(`/rest/v1/mail_mailboxes?id=eq.${a.id}`, {
          method: "PATCH",
          body: { lease_until: null, updated_at: new Date().toISOString() },
        });
      }
    }),
  );
  const report = {
    checked: results.length,
    failed: results.filter((x) => x.status === "rejected").length,
  };
  console.log("Mail poll summary", JSON.stringify(report));
  return new Response(null, { status: 204 });
}
