import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
await fs.mkdir("work/qa", { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let checks = 0;
const ok = (v, m) => {
  assert.ok(v, m);
  checks++;
  console.log("PASS " + m);
};
const ctx = await browser.newContext({
  viewport: { width: 1480, height: 980 },
  serviceWorkers: "allow",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let connected = true;
let latestUid = 31;
let sentPayload;
let deletion;
const drafts = [];
const stateActions = [];
const sample = (uid) => ({
  uid,
  subject:
    uid === 31
      ? "Shipment documents ready for review"
      : "Delivery update · Tanzania",
  from: [
    {
      name: uid === 31 ? "Catherine · Customer Care" : "Operations team",
      address: uid === 31 ? "care@hc.test" : "ops@hc.test",
    },
  ],
  to: [{ address: "admin@hc.test" }],
  cc: [],
  date: new Date(Date.now() - (32 - uid) * 3600000).toISOString(),
  unread: uid > 28,
  starred: uid === 29,
  size: 300,
  messageId: `<fixture-${uid}@hc.test>`,
});
await page.route("**/.netlify/functions/mail", async (route) => {
  const p = route.request().postDataJSON();
  let result;
  switch (p.action) {
    case "status":
      // v10: department mailboxes the signed-in staff member may use.
      result = {
        mailboxes: [
          { id: "box-sales", email: "admin@hc.test", name: "Sales", connected },
          { id: "box-acct", email: "accounting@hc.test", name: "Accounting", connected },
        ],
        admin: true,
        configured: true,
        vapidPublicKey: "",
      };
      break;
    case "check":
      result = {
        unread: 3,
        validity: "5",
        latestUid,
        latest: sample(latestUid),
      };
      break;
    case "list": {
      let rows = Array.from({ length: 31 }, (_, i) => sample(31 - i));
      if (p.q)
        rows = rows.filter((x) =>
          x.subject.toLowerCase().includes(p.q.toLowerCase()),
        );
      if (p.folder === "starred") rows = rows.filter((x) => x.starred);
      result = {
        rows: rows.slice(p.offset || 0, (p.offset || 0) + 30),
        total: rows.length,
        validity: "5",
        offset: p.offset || 0,
      };
      break;
    }
    case "read":
      result =
        p.attachment !== undefined
          ? {
              filename: "fixture.txt",
              content: Buffer.from("fixture file").toString("base64"),
            }
          : {
              ...sample(p.uid),
              text: 'Hello team,\n\nThe shipment documents are ready. Please review the invoice and packing list before dispatch.\n\nCustomer note: <img src=x onerror="window.mailXss=true">\n\nRegards,\nCatherine',
              replyTo: [{ address: "care@hc.test" }],
              attachments: [{ filename: "fixture.txt", index: 0, size: 12 }],
            };
      break;
    case "state":
      stateActions.push(p);
      result = { ok: true };
      break;
    case "send":
      sentPayload = p;
      result = { status: "sent", sentCopy: true, rejected: [] };
      break;
    case "drafts":
      result = drafts;
      break;
    case "save-draft": {
      const d = {
        id: crypto.randomUUID(),
        payload: p.payload,
        updated_at: new Date().toISOString(),
      };
      drafts.push(d);
      result = d;
      break;
    }
    case "delete-draft":
      drafts.splice(
        drafts.findIndex((d) => d.id === p.id),
        1,
      );
      result = { ok: true };
      break;
    case "mailbox-connect":
      connected = true;
      result = { connected: true };
      break;
    case "delete-user":
      deletion = p;
      result = { disabled: true, authDeleted: true };
      break;
    case "unsubscribe":
      result = { ok: true };
      break;
    default:
      throw Error("Unexpected mock mail action " + p.action);
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
});
try {
  await page.goto("http://127.0.0.1:8787");
  await page.locator("input[type=email]").fill("admin@hc.test");
  await page.locator("input[type=password]").fill("Pass1234!");
  await page.locator("button[type=submit]").click();
  await page.locator("#dashboard-actions").waitFor();
  await page.goto("http://127.0.0.1:8787/#/mail");
  await page.locator(".gm-row").first().waitFor();
  ok(
    (await page.locator(".gm-row").count()) === 30,
    "mailbox paginates 30 messages",
  );
  ok(
    (await page.locator(".gm-folder.active").getAttribute("data-folder")) ===
      "inbox",
    "Inbox folder selected",
  );
  await page.screenshot({
    path: "work/qa/mail-v7-desktop-inbox.png",
    fullPage: true,
  });
  await page.locator("#mail-next").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".gm-row").length === 1,
  );
  ok(true, "next page reachable");
  await page.locator("#mail-prev").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".gm-row").length === 30,
  );
  await page.locator('[data-open="31"]').click();
  await page.locator(".gm-body").waitFor();
  ok(
    (await page.locator(".gm-body").textContent()).includes("<img") &&
      (await page.evaluate(() => !window.mailXss)),
    "email text is escaped; HTML cannot execute",
  );
  await page.screenshot({
    path: "work/qa/mail-v7-desktop-read.png",
    fullPage: true,
  });
  await page.locator("#message-reply-all").click();
  ok(
    (await page.locator("#mail-compose").textContent()).includes("Sales") &&
      (await page.locator("#mail-compose").textContent()).includes("admin@hc.test"),
    "compose shows the sender name and department mailbox",
  );
  ok(
    (await page.locator("#email-to").inputValue()) === "care@hc.test",
    "reply-all excludes own mailbox",
  );
  const keptFocus = await page.evaluate(async () => {
    const input = document.querySelector('#email-text'); input.focus();
    await new Promise(resolve => setTimeout(resolve, 60));
    return document.activeElement === input;
  });
  ok(keptFocus, 'compose autofocus does not steal focus from the message');
  await page.locator("#email-text").fill("Fixture reply");
  await page.locator("#email-send").click();
  await page.locator("#mail-compose").waitFor({ state: "detached" });
  ok(
    sentPayload.mailbox === "box-sales",
    "send goes through the chosen department mailbox",
  );
  ok(
    sentPayload.to === "care@hc.test" && sentPayload.inReplyTo,
    "reply carries authenticated send request and Message-ID: " + JSON.stringify(sentPayload),
  );
  await page.locator(".gm-row").first().waitFor();
  await page.locator("#mail-search").fill("documents");
  await page.waitForFunction(
    () => document.querySelectorAll(".gm-row").length === 1,
  );
  ok(true, "mail search updates list");
  await page.locator("#mail-search").fill("");
  await page.waitForFunction(
    () => document.querySelectorAll(".gm-row").length === 30,
  );
  await page.locator('[data-select="31"]').check();
  await page.locator("#mail-archive").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".gm-row").length === 30,
  );
  ok(
    stateActions.at(-1).state === "archive",
    "bulk archive sends selected UIDs",
  );
  await page.locator("#compose").click();
  await page.locator("#email-to").fill("customer@example.com");
  await page.locator("#email-subject").fill("Customer quote");
  await page.locator("#email-text").fill("Fixture message for customer");
  await page.locator("#email-draft").click();
  await page.locator("#mail-compose").waitFor({ state: "detached" });
  await page.locator('[data-folder="drafts"]').click();
  await page.locator("[data-draft]").waitFor();
  ok(
    drafts[0].payload.to === "customer@example.com",
    "customer email draft saved server-side",
  );
  await page.locator("[data-draft]").click();
  ok(
    (await page.locator("#email-text").inputValue()) ===
      "Fixture message for customer",
    "draft restores text",
  );
  await page
    .locator("#email-files")
    .setInputFiles({
      name: "fixture.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("fixture attachment"),
    });
  await page.locator("#email-send").click();
  await page.locator("#mail-compose").waitFor({ state: "detached" });
  ok(
    sentPayload.attachments[0].filename === "fixture.txt" &&
      drafts.length === 0,
    "send includes attachment and removes sent draft",
  );
  await page.locator("#mail-box").selectOption("box-acct");
  await page.locator(".gm-row").first().waitFor();
  await page.locator("#compose").click();
  ok(
    (await page.locator("#mail-compose").textContent()).includes("accounting@hc.test"),
    "switching mailbox changes the From address",
  );
  await page.locator(".modal [data-close]").first().click().catch(() => {});
  await page.locator("#mail-compose").waitFor({ state: "detached" }).catch(() => {});
  await page.locator("#mail-box").selectOption("box-sales");
  await page.locator('[data-folder="inbox"]').click();
  await page.locator(".gm-row").first().waitFor();
  latestUid = 32;
  await page.evaluate(async () => {
    const { checkMailbox } = await import("./js/mailclient.js");
    await checkMailbox();
  });
  await page.getByText("New email received. Open Mail to read it.").waitFor();
  ok(true, "new UID triggers in-app notification");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${width}px mailbox has no horizontal overflow`,
    );
    await page.locator('[data-open="31"]').click();
    await page.locator(".gm-body").waitFor();
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${width}px reading view fits`,
    );
    if (width === 390)
      await page.screenshot({
        path: "work/qa/mail-v7-phone-read.png",
        fullPage: true,
      });
    await page.locator("#mail-back").click();
    await page.locator(".gm-row").first().waitFor();
    if (width === 390)
      await page.screenshot({
        path: "work/qa/mail-v7-phone-inbox.png",
        fullPage: true,
      });
  }
  await page.evaluate(() => {
    localStorage.setItem("hc.lang", "sw");
  });
  await page.reload();
  await page.locator(".gm-row").first().waitFor();
  ok(
    await page
      .locator("#compose")
      .textContent()
      .then((x) => x.includes("Andika")),
    "Kiswahili compose label rendered",
  );
  ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Kiswahili mailbox fits 320px",
  );
  await page.evaluate(() => {
    localStorage.setItem("hc.lang", "en");
  });
  await page.setViewportSize({ width: 1480, height: 980 });
  await page.goto("http://127.0.0.1:8787/#/users");
  await page
    .locator('tr[data-id="00000000-0000-0000-0000-000000000012"]')
    .click();
  await page.locator("#user-delete").click();
  await page.locator("#cf-reason").fill("Fixture staff departure");
  await page.locator("#cf-ok").click();
  await page.locator("#uf").waitFor({ state: "detached" });
  ok(
    deletion.userId.endsWith("12") &&
      deletion.reason === "Fixture staff departure",
    "admin deletion requires confirmed reason",
  );
  await page
    .locator('tr[data-id="00000000-0000-0000-0000-000000000001"]')
    .click();
  ok(
    (await page.locator("#user-delete").count()) === 0,
    "self profile has no delete control",
  );
  await page.locator(".modal [data-close]").first().click();
  // Exercise the real service worker push handler with synthetic payloads.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  let worker = ctx.serviceWorkers()[0];
  const push = await worker.evaluate(async () => {
    const shown = [];
    self.registration.showNotification = async (title, options) => {
      shown.push({ title, options });
    };
    async function fire(userId) {
      let promise;
      const e = new Event("push");
      e.data = { json: () => ({ userId, tag: "fixture" }) };
      e.waitUntil = (p) => {
        promise = p;
      };
      self.dispatchEvent(e);
      await promise;
    }
    await mailIdentity("readwrite", "fixture-user");
    await fire("wrong-user");
    const denied = shown.length === 0;
    await fire("fixture-user");
    await mailIdentity("readwrite", null);
    await fire("fixture-user");
    return { denied, count: shown.length, body: shown[0]?.options.body };
  });
  ok(
    push.denied &&
      push.count === 1 &&
      push.body === "You have new mail. Open your inbox to read it.",
    "push handler filters account mismatch/logout and hides message content",
  );
  ok(
    errors.length === 0,
    "no browser JavaScript/console errors: " + errors.join("; "),
  );
  console.log(
    `Mailbox browser checks: ${checks} passed (synthetic mail provider; real local app/database).`,
  );
} finally {
  await browser.close();
}
