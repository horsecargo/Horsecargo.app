# Local v5 verification

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
