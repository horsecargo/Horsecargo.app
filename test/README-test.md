# Local v5 / v6 verification

Requires Node 22+, Docker and Chromium installed by Playwright. Run from the repository root. All database tests run against an isolated PostgreSQL 16 container on loopback port 55439. `setup.mjs` refuses other database URLs and resets only this fixture database. Never copy the auth shim, fixture SQL or test helpers to a production project.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
docker run --name hc-v5-test --detach --publish 127.0.0.1:55439:5432 --env POSTGRES_PASSWORD=local-test-only --env POSTGRES_DB=hc postgres:16
npm.cmd run test:setup
npm.cmd run test:server
```

Leave the server running. In another terminal:

```powershell
npm.cmd run test:v5
```

The server substitutes local test configuration in its HTTP response only; it never edits `www/config.js`. The adapter uses actual PostgreSQL migrations, `SET LOCAL ROLE` and `auth.uid()` fixture claims for RPC/RLS tests. It simulates Auth/PostgREST transport, so it does not verify hosted Supabase Auth or production credentials.

`v5_test.mjs` validates mixed shipments, split quantities, retries, multiple lists, real concurrent overpacking, whole-unit restrictions, direct-write denial, reading roles, stable item IDs, finalization, approval-free documents, invoice/payment totals and rerunning the migration on populated data. It writes real database fixture IDs to `work/v5-fixtures.json` for the browser suite.

`v5_e2e.mjs` uses those IDs and the actual app to verify GRN/Invoice with 1, 5 and 25 items, long descriptions, print PDFs and downloaded PDFs, exact payment information, mixed-shipment packing, editing/removing/moving, finalization, retired routes and 390px mobile layout. Screenshots/PDFs stay under ignored `work/qa/`.

For existing regression suites, reset the database before each run:

```powershell
npm.cmd run test:setup
node test/v4_test.mjs
npm.cmd run test:setup
node test/ship_test.mjs
```

Older v3 approval tests describe the superseded document behavior; use the v5 document assertions for GRN/Invoice. The accounting journal and receipt/delivery approval rules are unchanged.

For teardown, stop the test server and run `docker stop hc-v5-test`. Remove this named test container only when its fixture data is no longer needed.

## v6 (roles, QR scan, leads, sourcing, staff mail)

`npm run test:setup` installs v1–v6 and one user per new role (`test/v6_users.sql`). Run in this order (v5_test re-runs the v5 migration, v6_test re-applies v6 first and again at the end to prove it is rerunnable on live data):

```
npm run test:setup
node test/v5_test.mjs
node test/v6_test.mjs
node test/v5_e2e.mjs
node test/v6_e2e.mjs
node test/navigation_e2e.mjs
```

`v6_test.mjs` — role defaults and the editable permission matrix (incl. edits surviving a rerun), automatic QR tokens, scan resolution for GRN / invoice / packing list / label, typed numbers, legacy labels, foreign/tampered codes, revoke & replace, public verification without money, leads (every role, numbering under concurrency, visibility, assignment, history, duplicate-safe conversion incl. a simultaneous double convert), sourcing workflow, staff mail between users (threads, CC, read receipts, unread counts, archive/trash, outsiders blocked), global search permissions and direct-table write denial.

`v6_e2e.mjs` — grouped sidebar by role, registers, Cargo Labels after GRN, packing-list QR on screen / A4 / PDF, Customer Care on a 390 px phone recording a lead and scanning (typed code **and** a fake camera showing the GRN QR), "QR Code Not Recognized", Staff Mail between two browsers with badge and read receipt, lead conversion, sourcing from a lead, role filter and permission matrix, HR read-only directory, no horizontal scrolling and no console errors.

`navigation_e2e.mjs` — six top-level entries for Admin, one-open-group keyboard navigation, the four Finance sections, deep-link selection, permission grants and revocation, role-specific dashboard/phone shortcuts, grouped More, Follow-up filtering, mobile access below the fold, and English/Kiswahili layout at 390px and 320px. Uses the same isolated fixtures; screenshots are under `work/qa/`.

The older `ship_e2e`, `v3_e2e` and `v4_e2e` browser scripts already fail on the v5 code (they predate the v5 screens) and `doc_test.mjs` still asserts the approval flow v5 removed; they are unchanged.
