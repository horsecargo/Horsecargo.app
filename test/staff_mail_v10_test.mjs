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
  hr = "00000000-0000-0000-0000-000000000012",
  sales = "00000000-0000-0000-0000-000000000014";
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
const one = async (id, sql, args = []) =>
  (await as(id, () => c.query(sql, args))).rows[0];
try {
  // Earlier suites reapply older migrations; v10 must apply cleanly on top, twice.
  await c.query(await fs.readFile("supabase/staff-mail-v10.sql", "utf8"));
  await c.query(await fs.readFile("supabase/staff-mail-v10.sql", "utf8"));
  checks++;
  await c.query("begin");

  // ───────── several roles for one person ─────────
  ok(
    !(await one(hr, "select has_perm('acc.read') ok")).ok,
    "HR alone cannot read accounts",
  );
  await assert.rejects(
    as(hr, () =>
      c.query("select admin_set_staff_roles($1,$2)", [hr, ["accountant"]]),
    ),
    /NOT_ALLOWED/,
  );
  checks++;
  await assert.rejects(
    as(admin, () =>
      c.query("select admin_set_staff_roles($1,$2)", [hr, ["admin"]]),
    ),
    /cannot be an additional role/,
  );
  checks++;
  await as(admin, () =>
    c.query("select admin_set_staff_roles($1,$2)", [
      hr,
      ["accountant", "manager", "hr"],
    ]),
  );
  ok(
    (await one(hr, "select has_perm('acc.read') ok")).ok,
    "an extra Accounting role adds its permissions",
  );
  ok(
    (await one(hr, "select has_role('manager') ok")).ok,
    "an extra Manager role counts for role checks",
  );
  const perms = (await one(hr, "select my_permissions() p")).p;
  ok(
    perms.includes("acc.read") && perms.includes("staff.read"),
    "the app sees the combined permissions of every role",
  );
  ok(
    (
      await c.query("select array_agg(role::text) r from staff_roles where user_id=$1", [hr])
    ).rows[0].r.sort().join() === "accountant,manager",
    "the primary role is never duplicated as an extra role",
  );
  ok(
    (await one(hr, "select count(*)::int n from staff_roles")).n === 2,
    "staff can read their own extra roles",
  );
  ok(
    (await one(sales, "select count(*)::int n from staff_roles")).n === 0,
    "staff without staff.read cannot see other people's roles",
  );
  await assert.rejects(
    as(hr, () =>
      c.query("insert into staff_roles(user_id,role) values($1,'admin')", [hr]),
    ),
    /permission denied/,
  );
  checks++;
  await as(admin, () =>
    c.query("select admin_set_staff_roles($1,$2)", [hr, []]),
  );
  ok(
    !(await one(hr, "select has_perm('acc.read') ok")).ok,
    "removing the extra role removes its permissions",
  );
  ok(
    (
      await c.query(
        "select count(*)::int n from audit_log where action='staff.roles' and entity_id=$1",
        [hr],
      )
    ).rows[0].n === 2,
    "role changes are audited",
  );

  // ───────── department mailboxes ─────────
  const boxes = (await c.query("select id,email from mail_mailboxes order by email")).rows;
  ok(
    boxes.some((b) => b.email === "sales@horsecargoltd.com") && boxes.length >= 7,
    "the company's department mailboxes are seeded",
  );
  const salesBox = boxes.find((b) => b.email === "sales@horsecargoltd.com").id;
  const acctBox = boxes.find((b) => b.email === "accounting@horsecargoltd.com").id;
  for (const table of ["mail_mailboxes", "mail_mailbox_members"]) {
    await assert.rejects(
      as(sales, () => c.query("select * from " + table)),
      /permission denied/,
    );
    checks++;
  }
  ok(
    (await one(sales, "select admin_mailboxes() m")).m === null,
    "only the administrator lists mailboxes and members",
  );
  await assert.rejects(
    as(sales, () =>
      c.query("select admin_set_mailbox_members($1,$2)", [salesBox, [sales]]),
    ),
    /NOT_ALLOWED/,
  );
  checks++;
  await as(admin, () =>
    c.query("select admin_set_mailbox_members($1,$2)", [salesBox, [sales, hr]]),
  );
  await as(admin, () =>
    c.query("select admin_set_staff_mailboxes($1,$2)", [hr, [acctBox]]),
  );
  const can = async (user, box) =>
    (
      await as(
        "",
        () => c.query("select mail_can_use_mailbox($1,$2) ok", [user, box]),
        "service_role",
      )
    ).rows[0].ok;
  ok(await can(sales, salesBox), "a member can use the department mailbox");
  ok(!(await can(sales, acctBox)), "a non-member cannot use another department's mailbox");
  ok(
    (await can(hr, acctBox)) && !(await can(hr, salesBox)),
    "assigning mailboxes from the staff profile replaces that person's list",
  );
  ok(
    (await can(admin, acctBox)) && (await can(admin, salesBox)),
    "the administrator can use every mailbox",
  );
  ok(
    (await one(hr, "select staff_mailboxes($1) m", [hr])).m.length === 1 &&
      (await one(sales, "select staff_mailboxes($1) m", [hr])).m.length === 0,
    "staff see only their own mailbox assignments",
  );
  await assert.rejects(
    as(sales, () => c.query("select mail_can_use_mailbox($1,$2)", [sales, salesBox])),
    /permission denied/,
  );
  checks++;
  await assert.rejects(
    as(sales, () => c.query("select mail_claim_mailbox($1)", [salesBox])),
    /permission denied/,
  );
  checks++;
  const claim = (id) =>
    as("", () => c.query("select mail_claim_mailbox($1) ok", [id]), "service_role")
      .then((r) => r.rows[0].ok);
  ok(!(await claim(salesBox)), "an unconnected mailbox is never polled");
  await c.query("update mail_mailboxes set password_cipher='encrypted-fixture' where id=$1", [salesBox]);
  ok(
    (await claim(salesBox)) && !(await claim(salesBox)),
    "poll lease refuses a concurrent claim",
  );
  await c.query("update profiles set active=false where id=$1", [sales]);
  ok(!(await can(sales, salesBox)), "an inactive member loses the mailbox at once");
  await c.query("update profiles set active=true where id=$1", [sales]);

  // ───────── deletion removes roles and mailbox access, keeps history ─────────
  await as(admin, () =>
    c.query("select admin_set_staff_roles($1,$2)", [hr, ["accountant"]]),
  );
  await as(admin, () =>
    c.query("select admin_prepare_delete_staff($1,$2)", [hr, "Fixture departure"]),
  );
  ok(
    (await c.query("select count(*)::int n from staff_roles where user_id=$1", [hr])).rows[0].n === 0 &&
      (await c.query("select count(*)::int n from mail_mailbox_members where user_id=$1", [hr])).rows[0].n === 0,
    "deleting a staff member removes extra roles and mailbox access",
  );
  ok(
    !(await one(hr, "select has_perm('acc.read') ok")).ok,
    "a deleted member's existing session loses every role",
  );
  await c.query("rollback");
  console.log(
    `Staff roles and department mailbox PostgreSQL checks: ${checks} passed; fixtures rolled back.`,
  );
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
