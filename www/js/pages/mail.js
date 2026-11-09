import { t } from "../i18n.js";
import { rpc, state, errText } from "../api.js";
import {
  icon,
  esc,
  fdatetime,
  ago,
  modal,
  toast,
  busy,
  debounce,
  empty,
  $,
  confirmDialog,
} from "../ui.js";
import {
  mailApi,
  mt,
  mailboxStatus,
  resetMailbox,
  enableMailNotifications,
  currentMailbox,
  setCurrentMailbox,
} from "../mailclient.js";
import { activeStaff } from "../staff.js";
import { refreshMailBadge } from "../mailbadge.js";

const folders = () => [
  ["inbox", t("inbox"), "inbox"],
  ["starred", mt("Starred", "Zenye nyota"), "star"],
  ["sent", t("sent_box"), "send"],
  ["drafts", mt("Drafts", "Rasimu"), "file"],
  ["archive", t("archived"), "archive"],
  ["spam", mt("Spam", "Barua taka"), "alert"],
  ["trash", t("trash"), "trash"],
];
const address = (list) =>
  (list || [])
    .map((x) => x.address)
    .filter(Boolean)
    .join(", ");
const sender = (list) =>
  (list || []).map((x) => x.name || x.address).join(", ");
const initial = (name) => esc((name || "?").trim().slice(0, 1).toUpperCase());
const button = (id, ic, text) =>
  `<button class="icon-btn" id="${id}" title="${esc(text)}" aria-label="${esc(text)}">${icon(ic)}</button>`;

export async function render(ctx) {
  if (ctx.query.get("internal") === "1" || ctx.params[0])
    return (await import("./internal-mail.js")).render(ctx);
  return mailbox(ctx);
}
async function settings(after) {
  let s;
  try {
    s = await mailboxStatus(true);
  } catch (e) {
    toast(e.message, "err");
    return;
  }
  if (!s.admin) {
    modal({
      title: mt("Mailbox settings", "Mipangilio ya email"),
      body: `<p class="muted">${esc(mt("Department mailboxes are connected and assigned by the CEO. Every email you send carries your name and department in the signature.", "Mailbox za department zinaunganishwa na kugawiwa na CEO. Kila email unayotuma ina jina lako na department yako kwenye signature."))}</p>
      ${s.mailboxes.length ? s.mailboxes.map((b) => `<div class="row" style="padding:8px 0"><b class="grow">${esc(b.name)}</b><span class="muted small">${esc(b.email)}</span></div>`).join("") : `<div class="callout warn">${esc(mt("You have not been assigned a mailbox yet.", "Bado hujapewa mailbox."))}</div>`}`,
      foot: `<button class="btn" data-close>${esc(t("cancel"))}</button>`,
    });
    return;
  }
  let boxes;
  let staff;
  try {
    [boxes, staff] = await Promise.all([rpc("admin_mailboxes"), activeStaff()]);
  } catch (e) {
    toast(errText(e), "err");
    return;
  }
  const row = (b) => `<fieldset class="perm-group" data-box="${b.id}"><legend>${esc(b.name)} · <span class="mono small">${esc(b.email)}</span>
      ${b.connected ? `<span class="badge s-ready">${esc(mt("Connected", "Imeunganishwa"))}</span>` : `<span class="badge s-pending_deposit">${esc(mt("Not connected", "Haijaunganishwa"))}</span>`}</legend>
    <div class="row" style="gap:8px;flex-wrap:wrap"><input class="input grow" type="password" data-box-password autocomplete="new-password" maxlength="1024" placeholder="${esc(mt("Mailbox password from cPanel", "Password ya mailbox kutoka cPanel"))}" aria-label="${esc(mt("Mailbox password", "Password ya email"))} ${esc(b.email)}">
      <button class="btn primary" data-box-connect ${s.configured ? "" : "disabled"}>${esc(b.connected ? mt("Update password", "Badili password") : mt("Connect", "Unganisha"))}</button>
      ${b.connected ? `<button class="btn danger" data-box-disconnect>${esc(mt("Disconnect", "Ondoa"))}</button>` : ""}</div>
    <div class="lbl" style="margin-top:10px">${esc(mt("Staff who use this mailbox", "Staff wanaotumia mailbox hii"))}</div>
    ${staff.filter((u) => u.role !== "admin").map((u) => `<label class="perm-row"><input type="checkbox" data-box-member value="${u.id}" ${b.members.includes(u.id) ? "checked" : ""}><span>${esc(u.full_name || u.email)}</span></label>`).join("") || `<div class="muted small">${esc(t("nothing_here"))}</div>`}
  </fieldset>`;
  modal({
    title: mt("Department mailboxes", "Mailbox za department"),
    wide: true,
    body: `<p class="muted">${esc(mt("Connect each department mailbox once with its cPanel password, then tick the staff who use it. Administrators can open every mailbox. Passwords are encrypted on the server and never shown to staff.", "Unganisha kila mailbox ya department mara moja kwa password yake ya cPanel, kisha chagua staff wanaoitumia. Admin anaweza kufungua mailbox zote. Passwords zinahifadhiwa kwa encryption kwenye server; staff hawazioni."))}</p>
    ${!s.configured ? `<div class="callout warn">${esc(mt("Server setup is required before a mailbox can connect.", "Mipangilio ya server inahitajika kabla ya kuunganisha mailbox."))}</div>` : ""}
    <div class="perm-grid">${boxes.map(row).join("")}</div>`,
    foot: `<button class="btn" data-close>${esc(t("cancel"))}</button>`,
    onMount(m) {
      m.el.addEventListener("click", (e) => {
        const box = e.target.closest("[data-box]");
        if (!box) return;
        const id = box.dataset.box;
        const connect = e.target.closest("[data-box-connect]");
        if (connect)
          busy(connect, async () => {
            const pw = $("[data-box-password]", box);
            if (!pw.value) {
              pw.focus();
              return;
            }
            try {
              await mailApi("mailbox-connect", { mailbox: id, password: pw.value });
              pw.value = "";
              resetMailbox();
              toast(mt("Mailbox connected.", "Mailbox imeunganishwa."));
              m.close();
              after();
            } catch (err) {
              toast(err.message, "err");
            }
          });
        const disconnect = e.target.closest("[data-box-disconnect]");
        if (disconnect)
          busy(disconnect, async () => {
            if (
              !(await confirmDialog(
                mt(
                  "Disconnect this mailbox from the app? Email on cPanel will be retained.",
                  "Ondoa muunganiko wa mailbox hii kwenye app? Email zilizoko cPanel zitabaki.",
                ),
              ))
            )
              return;
            try {
              await mailApi("mailbox-disconnect", { mailbox: id });
              resetMailbox();
              m.close();
              after();
            } catch (err) {
              toast(err.message, "err");
            }
          });
      });
      m.el.addEventListener("change", async (e) => {
        const cb = e.target.closest("[data-box-member]");
        if (!cb) return;
        const box = cb.closest("[data-box]");
        const users = [...box.querySelectorAll("[data-box-member]:checked")].map((x) => x.value);
        cb.disabled = true;
        try {
          await rpc("admin_set_mailbox_members", { p_mailbox: box.dataset.box, p_users: users });
          toast(t("saved"));
        } catch (err) {
          cb.checked = !cb.checked;
          toast(errText(err), "err");
        } finally {
          cb.disabled = false;
        }
      });
    },
  });
}
async function compose(after, seed = {}, draftId = null) {
  let directory = [];
  try {
    directory = await rpc("mail_directory", { p_q: null });
  } catch {
    /* explicit addresses still work */
  }
  const requestId = crypto.randomUUID();
  let dirty = false;
  let sending = false;
  let currentDraft = draftId;
  const m = modal({
    title: mt("New message", "Email mpya"),
    wide: true,
    body: `
    <form class="form gm-compose" id="mail-compose">
      ${currentMailbox() ? `<p class="hint full">${esc(mt("From", "Kutoka"))}: <b>${esc(state.profile.full_name || state.profile.email)} – ${esc(currentMailbox().name)}</b> &lt;${esc(currentMailbox().email)}&gt; · ${esc(mt("your signature is added automatically", "signature yako inaongezwa yenyewe"))}</p>` : ""}
      <datalist id="mail-directory">${directory.map((p) => `<option value="${esc(p.email)}">${esc(p.name)}</option>`).join("")}</datalist>
      ${[
        ["to", t("mail_to")],
        ["cc", "CC"],
        ["bcc", "BCC"],
      ]
        .map(
          ([key, label]) =>
            `<div class="field full gm-address"><label for="email-${key}">${esc(label)}</label><input class="input" name="${key}" id="email-${key}" list="mail-directory" value="${esc(seed[key] || "")}" ${key === "to" ? "required" : ""} placeholder="name@company.com"></div>`,
        )
        .join("")}
      <div class="field full"><label for="email-subject">${esc(t("subject"))}</label><input class="input" name="subject" id="email-subject" maxlength="200" required value="${esc(seed.subject || "")}"></div>
      <div class="field full"><label class="sr-only" for="email-text">${esc(t("message"))}</label><textarea class="input" name="text" id="email-text" rows="12" maxlength="100000" required>${esc(seed.text || "")}</textarea></div>
      <div class="field full"><label for="email-files">${esc(mt("Attachments · maximum 3 MB total", "Viambatisho · jumla hadi MB 3"))}</label><input id="email-files" type="file" multiple><div id="email-file-names" class="muted small"></div></div>
      <p class="hint full">${esc(mt("Separate multiple email addresses with commas.", "Tenganisha email nyingi kwa koma."))}</p>
    </form>`,
    foot: `<button class="btn" id="email-draft">${esc(mt("Save draft", "Hifadhi rasimu"))}</button><button class="btn primary" id="email-send">${icon("send")}${esc(t("send"))}</button>`,
  });
  const f = $("#mail-compose", m.el);
  f.onsubmit = (e) => e.preventDefault();
  f.addEventListener("input", () => {
    dirty = true;
  });
  const data = () => ({
    to: f.elements.to.value,
    cc: f.elements.cc.value,
    bcc: f.elements.bcc.value,
    subject: f.elements.subject.value,
    text: f.elements.text.value,
    ...(seed.inReplyTo ? { inReplyTo: seed.inReplyTo } : {}),
  });
  const beforeUnload = (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(m.el)) {
      window.removeEventListener("beforeunload", beforeUnload);
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById("modal-root"), { childList: true });
  const guard = (e) => {
    const closing =
      e.type === "keydown"
        ? e.key === "Escape"
        : e.target === m.el.parentElement || e.target.closest("[data-close]");
    if (closing && (dirty || sending)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (
        !sending &&
        window.confirm(
          mt(
            "Discard unsaved changes? Use Save draft to keep this message.",
            "Futa mabadiliko ambayo hayajahifadhiwa? Tumia Hifadhi rasimu ili kuyabakiza.",
          ),
        )
      ) {
        dirty = false;
        m.close();
      }
    }
  };
  m.el.parentElement.addEventListener("click", guard, true);
  m.el.parentElement.addEventListener("keydown", guard, true);
  $("#email-files", m.el).onchange = () => {
    $("#email-file-names", m.el).textContent = [
      ...$("#email-files", m.el).files,
    ]
      .map((f) => f.name)
      .join(", ");
    dirty = true;
  };
  $("#email-draft", m.el).onclick = (ev) =>
    busy(ev.currentTarget, async () => {
      try {
        const d = await mailApi("save-draft", {
          id: currentDraft,
          payload: data(),
        });
        currentDraft = d.id;
        dirty = false;
        toast(
          mt(
            "Draft saved. Attachments must be selected again when sending.",
            "Rasimu imehifadhiwa. Chagua viambatisho tena wakati wa kutuma.",
          ),
        );
        m.close();
        after();
      } catch (e) {
        toast(e.message, "err");
      }
    });
  $("#email-send", m.el).onclick = (ev) =>
    busy(ev.currentTarget, async () => {
      if (!f.reportValidity()) return;
      const files = [...$("#email-files", m.el).files];
      if (
        files.length > 10 ||
        files.reduce((n, f) => n + f.size, 0) > 3 * 1024 * 1024
      ) {
        toast(
          mt(
            "Attachments must total 3 MB or less.",
            "Jumla ya viambatisho isizidi MB 3.",
          ),
          "err",
        );
        return;
      }
      sending = true;
      $("#email-draft", m.el).disabled = true;
      try {
        const attachments = await Promise.all(
          files.map(
            (file) =>
              new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onerror = reject;
                r.onload = () =>
                  resolve({
                    filename: file.name,
                    content: r.result.split(",")[1],
                  });
                r.readAsDataURL(file);
              }),
          ),
        );
        const r = await mailApi("send", { ...data(), attachments, requestId });
        if (r.status !== "sent") {
          dirty = false;
          $("#email-send", m.el).disabled = true;
          $("#email-send", m.el).dataset.uncertain = "1";
          toast(
            mt(
              "Delivery is unconfirmed. Check Sent or ask an administrator before sending again.",
              "Utumaji haujathibitishwa. Angalia Sent au wasiliana na admin kabla ya kutuma tena.",
            ),
            "err",
            12000,
          );
          return;
        }
        dirty = false;
        if (currentDraft)
          await mailApi("delete-draft", { id: currentDraft }).catch(() => {});
        m.close();
        toast(
          r.rejected?.length
            ? mt(
                "Some recipients were rejected. Check the addresses.",
                "Baadhi ya wapokeaji hawakukubaliwa. Kagua email zao.",
              )
            : !r.sentCopy
              ? mt(
                  "Email sent, but the Sent copy could not be saved. Do not resend.",
                  "Email imetumwa, lakini nakala ya Sent haikuhifadhiwa. Usitume tena.",
                )
              : t("mail_sent"),
          r.rejected?.length || !r.sentCopy ? "info" : "ok",
          8000,
        );
        after();
      } catch (e) {
        toast(
          `${e.message} ${mt("If the connection timed out, check Sent before retrying.", "Ikiwa muda umeisha, angalia Sent kabla ya kujaribu tena.")}`,
          "err",
        );
      } finally {
        sending = false;
        $("#email-draft", m.el)?.removeAttribute("disabled");
        setTimeout(() => {
          const b = $("#email-send", m.el);
          if (b?.dataset.uncertain) b.disabled = true;
        }, 0);
      }
    });
}
async function mailbox({ el, setTitle, query }) {
  setTitle(t("staff_mail"));
  let folder = folders().some((f) => f[0] === query.get("f"))
    ? query.get("f")
    : "inbox";
  let q = "";
  let offset = 0;
  let rows = [];
  let total = 0;
  let validity = "";
  let selected = new Set();
  let view = null;
  let disposed = false;
  let generation = 0;
  el.innerHTML = `<div class="gm-shell"><aside class="gm-sidebar">
    <div class="gm-brand">${icon("mail")}<b>Horse Mail</b></div>
    <button class="gm-compose-btn" id="compose">${icon("plus")}${esc(t("compose"))}</button>
    <nav aria-label="${esc(mt("Mail folders", "Folda za email"))}">${folders()
      .map(
        ([id, label, ic]) =>
          `<button class="gm-folder" data-folder="${id}">${icon(ic)}<span>${esc(label)}</span>${id === "inbox" ? "<b data-external-unread></b>" : ""}</button>`,
      )
      .join("")}</nav>
    <div class="gm-side-bottom"><button class="gm-folder" id="mail-settings">${icon("gear")}${esc(mt("Mailbox settings", "Mipangilio ya email"))}</button><a class="gm-folder" href="#/mail?internal=1">${icon("users")}${esc(mt("Previous staff messages", "Ujumbe wa zamani wa staff"))}</a></div>
  </aside><section class="gm-main"><header class="gm-top"><div class="gm-search">${icon("search")}<input id="mail-search" type="search" placeholder="${esc(t("mail_search_ph"))}" aria-label="${esc(t("mail_search_ph"))}"></div>${button("mail-notifications", "bell", mt("Enable email notifications", "Washa notifications za email"))}</header>
  <div class="gm-account" id="mail-account"></div><div class="gm-toolbar"><div class="row" id="mail-list-actions"><input id="mail-select-all" type="checkbox" aria-label="${esc(mt("Select all messages", "Chagua email zote"))}">${button("mail-refresh", "refresh", t("retry"))}${button("mail-archive", "archive", t("archive"))}${button("mail-trash", "trash", t("move_to_trash"))}${button("mail-unread", "mail", t("mark_unread"))}</div><span class="grow"></span><span class="muted small" id="mail-range"></span>${button("mail-prev", "chevronLeft", mt("Previous page", "Ukurasa uliopita"))}${button("mail-next", "chevronRight", mt("Next page", "Ukurasa unaofuata"))}</div>
  <div class="gm-content" id="mail-content" aria-live="polite"></div><div class="gm-status muted small" id="mail-sync-status"></div></section></div>`;
  const content = $("#mail-content", el);
  const updateFolders = () => {
    el.querySelectorAll("[data-folder]").forEach((b) => {
      b.classList.toggle("active", b.dataset.folder === folder);
      b.setAttribute(
        "aria-current",
        b.dataset.folder === folder ? "page" : "false",
      );
    });
  };
  const syncNote = (message) => {
    $("#mail-sync-status", el).textContent =
      message ||
      `${mt("Last refreshed", "Imesasishwa")}: ${fdatetime(new Date())}`;
  };
  const updateToolbar = () => {
    $("#mail-select-all", el).disabled = !!view;
    $("#mail-select-all", el).checked =
      !!rows.length && selected.size === rows.length;
    $("#mail-prev", el).disabled = offset === 0;
    $("#mail-next", el).disabled = offset + 30 >= total;
    $("#mail-range", el).textContent = total
      ? `${offset + 1}–${Math.min(offset + 30, total)} / ${total}`
      : "0";
  };
  async function load(quiet = false) {
    if (disposed || view) return;
    const seq = ++generation;
    if (!quiet)
      content.innerHTML =
        '<div class="gm-loading"><div class="spinner"></div></div>';
    try {
      const s = await mailboxStatus();
      if (disposed || seq !== generation) return;
      const account = $("#mail-account", el);
      account.innerHTML =
        s.mailboxes.length > 1
          ? `<select class="input" id="mail-box" aria-label="${esc(mt("Mailbox", "Mailbox"))}">${s.mailboxes.map((b) => `<option value="${b.id}" ${b.id === s.current?.id ? "selected" : ""} ${b.connected ? "" : "disabled"}>${esc(b.name)} · ${esc(b.email)}${b.connected ? "" : " · " + esc(mt("not connected", "haijaunganishwa"))}</option>`).join("")}</select>`
          : esc(s.current ? `${s.current.name} · ${s.current.email}` : "");
      const pickBox = $("#mail-box", account);
      if (pickBox)
        pickBox.onchange = () => {
          setCurrentMailbox(pickBox.value);
          offset = 0;
          selected = new Set();
          load();
          refreshMailBadge({ force: true });
        };
      if (!s.connected) {
        const hint = s.admin
          ? mt("Connect the department mailboxes and choose who uses each one.", "Unganisha mailbox za department na uchague nani anatumia kila moja.")
          : s.mailboxes.length
            ? mt("Your department mailbox is not connected yet. Ask the CEO to connect it.", "Mailbox ya department yako bado haijaunganishwa. Mwombe CEO aiunganishe.")
            : mt("You have not been assigned a department mailbox yet. Ask the CEO.", "Bado hujapewa mailbox ya department. Mwombe CEO.");
        content.innerHTML = `<div class="gm-welcome">${icon("mail")}<h2>${esc(mt("Department email, in one place", "Email za department, sehemu moja"))}</h2><p>${esc(hint)}</p>${s.admin ? `<button class="btn primary" id="mail-start">${esc(mt("Department mailboxes", "Mailbox za department"))}</button>` : ""}</div>`;
        const start = $("#mail-start", el);
        if (start)
          start.onclick = () =>
            settings(() => {
              resetMailbox();
              load();
            });
        syncNote();
        return;
      }
      if (folder === "drafts") {
        const drafts = await mailApi("drafts");
        if (disposed || seq !== generation) return;
        content.innerHTML = drafts.length
          ? drafts
              .map(
                (d) =>
                  `<div class="gm-draft"><button class="gm-draft-open" data-draft="${d.id}"><b>${esc(d.payload.subject || mt("(No subject)", "(Hakuna kichwa)"))}</b><span>${esc(d.payload.to || "")}</span><time>${esc(ago(d.updated_at))}</time></button><button class="icon-btn" data-delete-draft="${d.id}" aria-label="${esc(mt("Delete draft", "Futa rasimu"))}">${icon("trash")}</button></div>`,
              )
              .join("")
          : empty(mt("No drafts.", "Hakuna rasimu."), "file");
        content.onclick = async (e) => {
          const d = e.target.closest("[data-draft]");
          if (d) {
            const draft = drafts.find((x) => x.id === d.dataset.draft);
            compose(load, draft.payload, draft.id);
          }
          const del = e.target.closest("[data-delete-draft]");
          if (
            del &&
            (await confirmDialog(mt("Delete this draft?", "Futa rasimu hii?"), {
              danger: true,
            }))
          ) {
            try {
              await mailApi("delete-draft", { id: del.dataset.deleteDraft });
              load();
            } catch (e) {
              toast(e.message, "err");
            }
          }
        };
        rows = [];
        total = 0;
        updateToolbar();
        return;
      }
      const r = await mailApi("list", { folder, q, offset });
      if (disposed || seq !== generation) return;
      rows = r.rows;
      total = r.total;
      validity = r.validity;
      selected.clear();
      content.onclick = null;
      content.innerHTML = rows.length
        ? `<div class="gm-list">${rows.map((m) => `<div class="gm-row ${m.unread ? "unread" : ""}"><input type="checkbox" data-select="${m.uid}" aria-label="${esc(mt("Select message", "Chagua email"))}"><button class="gm-star ${m.starred ? "starred" : ""}" data-star="${m.uid}" title="${esc(mt("Toggle star", "Badili nyota"))}" aria-label="${esc(mt("Toggle star", "Badili nyota"))}" aria-pressed="${m.starred}">☆</button><button class="gm-open" data-open="${m.uid}"><span class="gm-who">${esc(sender(folder === "sent" ? m.to : m.from))}</span><span class="gm-subject">${esc(m.subject)}</span><time title="${esc(fdatetime(m.date))}">${esc(ago(m.date))}</time></button></div>`).join("")}</div>`
        : empty(t("no_mail"), "mail");
      updateToolbar();
      syncNote();
    } catch (e) {
      if (disposed || seq !== generation) return;
      if (quiet) {
        syncNote(e.message);
        return;
      }
      content.innerHTML = `<div class="card-b"><div class="callout danger">${esc(e.message)}</div><button class="btn" id="mail-error-settings">${esc(mt("Mailbox settings", "Mipangilio ya email"))}</button></div>`;
      $("#mail-error-settings", el).onclick = () => settings(() => load());
    }
  }
  const mutate = async (stateName, uids = [...selected]) => {
    if (!uids.length) {
      toast(mt("Select a message first.", "Chagua email kwanza."), "info");
      return;
    }
    await mailApi("state", { folder, uids, validity, state: stateName });
    view = null;
    await load();
    refreshMailBadge({ force: true });
  };
  const openMessage = async (id) => {
    view = id;
    ++generation;
    updateToolbar();
    content.innerHTML =
      '<div class="gm-loading"><div class="spinner"></div></div>';
    try {
      const m = await mailApi("read", { folder, uid: id, validity });
      if (disposed || view !== id) return;
      refreshMailBadge({ force: true });
      content.innerHTML = `<article class="gm-message"><div class="gm-message-tools"><button class="btn ghost" id="mail-back">← ${esc(t("inbox"))}</button><button class="btn ghost" id="message-archive">${icon("archive")}${esc(t("archive"))}</button><button class="btn ghost" id="message-trash">${icon("trash")}${esc(t("trash"))}</button>${folder === "trash" ? `<button class="btn ghost" id="message-restore">${esc(t("restore"))}</button>` : ""}</div><h1>${esc(m.subject)}</h1><header><span class="gm-avatar">${initial(sender(m.from))}</span><div class="grow"><b>${esc(sender(m.from))}</b><div class="muted small">${esc(address(m.from))}</div><div class="muted small">${esc(t("mail_to"))}: ${esc(address(m.to))}${m.cc?.length ? ` · CC: ${esc(address(m.cc))}` : ""}</div></div><time class="muted small">${esc(fdatetime(m.date))}</time></header><div class="gm-body">${esc(m.text)}</div><div class="gm-attachments">${m.attachments.map((a) => `<button class="btn" data-attachment="${a.index}">${icon("download")}${esc(a.filename)} · ${Math.ceil(a.size / 1024)} KB</button>`).join("")}</div><footer><button class="btn" id="message-reply">${icon("reply")}${esc(t("reply"))}</button><button class="btn" id="message-reply-all">${icon("replyAll")}${esc(t("reply_all"))}</button><button class="btn" id="message-forward">${icon("forward")}${esc(t("forward"))}</button></footer></article>`;
      $("#mail-back", el).onclick = () => {
        view = null;
        load();
      };
      $("#message-trash", el).onclick = () =>
        mutate("trash", [id]).catch((e) => toast(e.message, "err"));
      $("#message-archive", el).onclick = () =>
        mutate("archive", [id]).catch((e) => toast(e.message, "err"));
      if ($("#message-restore", el))
        $("#message-restore", el).onclick = () =>
          mutate("inbox", [id]).catch((e) => toast(e.message, "err"));
      const reply = (all) => {
        const me = (currentMailbox()?.email || "").toLowerCase();
        const targets = [
          ...new Set(
            [...(m.replyTo || m.from), ...(all ? m.to : [])]
              .map((x) => x.address)
              .filter((x) => x && x.toLowerCase() !== me),
          ),
        ];
        const cc = all
          ? m.cc.filter(
              (x) =>
                x.address.toLowerCase() !== me && !targets.includes(x.address),
            )
          : [];
        compose(
          () => {
            view = null;
            load();
          },
          {
            to: targets.join(", "),
            cc: address(cc),
            subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
            text: `\n\n${fdatetime(m.date)} · ${sender(m.from)}:\n${m.text}`,
            inReplyTo: m.messageId,
          },
        );
      };
      $("#message-reply", el).onclick = () => reply(false);
      $("#message-reply-all", el).onclick = () => reply(true);
      $("#message-forward", el).onclick = () =>
        compose(
          () => {
            view = null;
            load();
          },
          {
            subject: `Fwd: ${m.subject}`,
            text: `\n\n---------- Forwarded message ----------\nFrom: ${sender(m.from)} <${address(m.from)}>\nDate: ${fdatetime(m.date)}\nSubject: ${m.subject}\n\n${m.text}`,
          },
        );
      el.querySelectorAll("[data-attachment]").forEach(
        (b) =>
          (b.onclick = (ev) =>
            busy(ev.currentTarget, async () => {
              try {
                const a = await mailApi("read", {
                  folder,
                  uid: id,
                  validity,
                  attachment: Number(b.dataset.attachment),
                });
                const blob = new Blob(
                  [Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0))],
                  { type: "application/octet-stream" },
                );
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = a.filename;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              } catch (e) {
                toast(e.message, "err");
              }
            })),
      );
    } catch (e) {
      content.innerHTML = `<div class="card-b"><p>${esc(e.message)}</p><button class="btn" id="mail-back">${esc(t("back"))}</button></div>`;
      $("#mail-back", el).onclick = () => {
        view = null;
        load();
      };
    }
  };
  el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-folder]");
    if (f) {
      folder = f.dataset.folder;
      view = null;
      offset = 0;
      history.replaceState(null, "", `#/mail?f=${folder}`);
      updateFolders();
      load();
    }
    const open = e.target.closest("[data-open]");
    if (open) openMessage(Number(open.dataset.open));
    const star = e.target.closest("[data-star]");
    if (star) {
      const m = rows.find((x) => x.uid === Number(star.dataset.star));
      mutate(m.starred ? "unstar" : "star", [m.uid]).catch((e) =>
        toast(e.message, "err"),
      );
    }
  });
  el.addEventListener("change", (e) => {
    const check = e.target.closest("[data-select]");
    if (check) {
      const id = Number(check.dataset.select);
      if (check.checked) selected.add(id);
      else selected.delete(id);
      updateToolbar();
    }
  });
  $("#compose", el).onclick = () =>
    compose(() => {
      view = null;
      load();
    });
  $("#mail-settings", el).onclick = () =>
    settings(() => {
      view = null;
      load();
    });
  $("#mail-notifications", el).onclick = () =>
    enableMailNotifications().catch((e) => toast(e.message, "err"));
  $("#mail-refresh", el).onclick = () => {
    view = null;
    load();
    refreshMailBadge({ force: true });
  };
  $("#mail-select-all", el).onchange = (e) => {
    selected = e.target.checked ? new Set(rows.map((m) => m.uid)) : new Set();
    el.querySelectorAll("[data-select]").forEach((c) => {
      c.checked = e.target.checked;
    });
  };
  for (const [id, action] of [
    ["mail-trash", "trash"],
    ["mail-archive", "archive"],
    ["mail-unread", "unread"],
  ])
    $("#" + id, el).onclick = () =>
      mutate(action, view ? [view] : undefined).catch((e) =>
        toast(e.message, "err"),
      );
  $("#mail-search", el).oninput = debounce((e) => {
    q = e.target.value.trim();
    offset = 0;
    view = null;
    load();
  }, 350);
  $("#mail-prev", el).onclick = () => {
    offset = Math.max(0, offset - 30);
    load();
  };
  $("#mail-next", el).onclick = () => {
    offset += 30;
    load();
  };
  const newEmail = () => {
    if (!view && !selected.size) load(true);
  };
  window.addEventListener("hc:new-email", newEmail);
  const timer = setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      !view &&
      !selected.size &&
      !document.querySelector(".modal-bg")
    )
      load(true);
  }, 30000);
  updateFolders();
  await load();
  refreshMailBadge({ force: true });
  if (query.get("compose") === "1") compose(load);
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener("hc:new-email", newEmail);
  };
}
