import pg from "pg";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const connectionString =
  process.env.HC_TEST_DATABASE_URL ||
  "postgres://postgres:local-test-only@127.0.0.1:55439/hc";
const target = new URL(connectionString);
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== "55439" ||
  target.pathname !== "/hc"
)
  throw Error("Local fixture database only");
const c = new pg.Client({ connectionString });
await c.connect();
let checks = 0;
const ok = (v, m) => {
  assert.ok(v, m);
  checks++;
  console.log("PASS " + m);
};
const admin = "00000000-0000-0000-0000-000000000001",
  staff = "00000000-0000-0000-0000-000000000012";
const as = async (id, fn, role = "authenticated") => {
  await c.query("savepoint test_case");
  try {
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const result = await fn();
    await c.query("reset role");
    await c.query("select set_config('request.jwt.claim.sub','',true)");
    return result;
  } catch (e) {
    await c.query("rollback to savepoint test_case");
    throw e;
  }
};
try {
  await c.query(await fs.readFile("supabase/mail-v7.sql", "utf8"));
  await c.query(await fs.readFile("supabase/mail-v7.sql", "utf8"));
  checks++;
  await c.query("begin");
  for (const table of [
    "mail_accounts",
    "mail_drafts",
    "mail_push_subscriptions",
    "mail_deliveries",
  ]) {
    await assert.rejects(
      as(staff, () => c.query("select * from " + table)),
      /permission denied/,
    );
    checks++;
  }
  await assert.rejects(
    as(staff, () => c.query("select mail_claim_poll($1)", [staff])),
    /permission denied/,
  );
  checks++;
  await assert.rejects(
    as(staff, () => c.query("select mail_user_allowed($1)", [admin])),
    /permission denied/,
  );
  checks++;
  await assert.rejects(
    as(staff, () =>
      c.query("select admin_prepare_delete_staff($1,$2)", [
        admin,
        "fixture reason",
      ]),
    ),
    /NOT_ALLOWED/,
  );
  checks++;
  await assert.rejects(
    as(admin, () =>
      c.query("select admin_prepare_delete_staff($1,$2)", [
        admin,
        "fixture reason",
      ]),
    ),
    /yourself/,
  );
  checks++;
  await assert.rejects(
    as(admin, () =>
      c.query("select admin_prepare_delete_staff($1,$2)", [staff, ""]),
    ),
    /reason/,
  );
  checks++;
  const th = (
    await c.query(
      "insert into mail_threads(subject,created_by) values('Retained fixture',$1) returning id",
      [staff],
    )
  ).rows[0].id;
  await c.query(
    "insert into mail_messages(thread_id,sender_id,body)values($1,$2,'Retained body')",
    [th, staff],
  );
  await c.query(
    "insert into permission_grants(user_id,permission,reason)values($1,'acc.read','fixture')",
    [staff],
  );
  await c.query(
    "insert into mail_accounts(user_id,email,password_cipher)values($1,'hr@hc.test','encrypted-fixture')",
    [staff],
  );
  await c.query("insert into mail_drafts(user_id,payload)values($1,'{}')", [
    staff,
  ]);
  await c.query(
    "insert into mail_push_subscriptions(user_id,endpoint,subscription)values($1,'https://fcm.googleapis.com/fixture','{}')",
    [staff],
  );
  const claim = await as(
    "",
    () => c.query("select mail_claim_poll($1) ok", [staff]),
    "service_role",
  );
  const again = await as(
    "",
    () => c.query("select mail_claim_poll($1) ok", [staff]),
    "service_role",
  );
  ok(
    claim.rows[0].ok && !again.rows[0].ok,
    "poll lease refuses concurrent claim",
  );
  await as(admin, () =>
    c.query("update profiles set deleted_at=now() where id=$1", [staff]),
  );
  ok(
    !(await c.query("select deleted_at from profiles where id=$1", [staff]))
      .rows[0].deleted_at,
    "direct profile update cannot bypass deletion RPC",
  );
  await as(admin, () =>
    c.query("select admin_prepare_delete_staff($1,$2)", [
      staff,
      "Fixture staff departure",
    ]),
  );
  let p = (await c.query("select * from profiles where id=$1", [staff]))
    .rows[0];
  ok(
    !p.active && p.deleted_at,
    "deleted profile retained inactive with tombstone",
  );
  ok(
    (
      await c.query("select count(*) from mail_messages where sender_id=$1", [
        staff,
      ])
    ).rows[0].count === "1",
    "historical messages retain staff reference",
  );
  ok(
    (
      await c.query(
        "select count(*) from audit_log where action='staff.delete' and entity_id=$1",
        [staff],
      )
    ).rows[0].count === "1",
    "deletion reason/action audited",
  );
  ok(
    (
      await c.query(
        "select count(*) from permission_grants where user_id=$1 and revoked_at is null",
        [staff],
      )
    ).rows[0].count === "0",
    "special grants revoked",
  );
  for (const table of [
    "mail_accounts",
    "mail_drafts",
    "mail_push_subscriptions",
  ])
    ok(
      (
        await c.query("select count(*) from " + table + " where user_id=$1", [
          staff,
        ])
      ).rows[0].count === "0",
      table + " removed on user deletion",
    );
  const oldMail = await as(staff, () =>
    c.query("select * from mail_messages where thread_id=$1", [th]),
  );
  ok(
    oldMail.rows.length === 0,
    "deleted JWT cannot read historical internal mail through RLS",
  );
  ok(
    !(
      await c.query(
        "select has_function_privilege('authenticated','public.acc_reverse(uuid,text,date)','execute') ok",
      )
    ).rows[0].ok,
    "accounting internals cannot be called with stale JWTs",
  );
  const perm = await as(staff, () => c.query("select has_perm('mail.use') ok"));
  ok(!perm.rows[0].ok, "existing JWT loses mail permission immediately");
  await as(admin, () =>
    c.query(
      "select admin_save_staff(jsonb_build_object('id',$1::text,'active',true))",
      [staff],
    ),
  );
  p = (await c.query("select active from profiles where id=$1", [staff]))
    .rows[0];
  ok(!p.active, "deleted user cannot be reactivated with old admin RPC");
  await as(admin, () =>
    c.query("select admin_prepare_delete_staff($1,$2)", [
      staff,
      "Auth cleanup retry",
    ]),
  );
  ok(
    (
      await c.query(
        "select count(*) from audit_log where action='staff.delete' and entity_id=$1",
        [staff],
      )
    ).rows[0].count === "1",
    "Auth cleanup retry does not duplicate deletion audit",
  );
  await c.query("rollback");
  console.log(
    `Mail v7 PostgreSQL checks: ${checks} passed; synthetic deletion rolled back.`,
  );
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
