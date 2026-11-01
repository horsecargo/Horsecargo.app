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
  // Bounded batch, oldest first. Failed accounts rotate to the back as well.
  const accounts = await query(
    "/rest/v1/mail_accounts?select=*&order=updated_at.asc&limit=20",
  );
  const results = await Promise.allSettled(
    accounts.map(async (a) => {
      if (
        !(await query("/rest/v1/rpc/mail_claim_poll", {
          method: "POST",
          body: { p_user: a.user_id },
        }))
      )
        return;
      try {
        if (
          !(await query("/rest/v1/rpc/mail_user_allowed", {
            method: "POST",
            body: { p_user: a.user_id },
          }))
        )
          return;
        const status = await inboxStatus(a, {
          deadlineMs: Math.min(12000, remaining()),
        });
        const isNew =
          a.last_uid !== null &&
          a.uid_validity === status.validity &&
          status.latestUid > Number(a.last_uid);
        if (isNew) {
          const subs = await query(
            `/rest/v1/mail_push_subscriptions?user_id=eq.${a.user_id}`,
          );
          const pushes = await Promise.allSettled(
            subs.map(async (s) => {
              try {
                await webpush.sendNotification(
                  s.subscription,
                  JSON.stringify({
                    title: "Horse Cargo · New email",
                    body: "You have new mail. Open your inbox to read it.",
                    userId: a.user_id,
                    tag: `mail-${status.validity}-${status.latestUid}`,
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
        await query(`/rest/v1/mail_accounts?user_id=eq.${a.user_id}`, {
          method: "PATCH",
          body: { last_uid: status.latestUid, uid_validity: status.validity },
        });
      } finally {
        await query(`/rest/v1/mail_accounts?user_id=eq.${a.user_id}`, {
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
