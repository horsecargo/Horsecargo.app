import { sb, state } from "./api.js";
import { getLang } from "./i18n.js";
import { toast } from "./ui.js";

export const mt = (en, sw) => (getLang() === "sw" ? sw : en);
export async function mailApi(action, input = {}) {
  const { data } = await sb.auth.getSession();
  if (!data.session)
    throw Error(mt("Please sign in.", "Ingia kwenye akaunti."));
  const res = await fetch("/.netlify/functions/mail", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ ...input, action }),
    cache: "no-store",
    signal: AbortSignal.timeout(action === "send" ? 60000 : 45000),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw Error(
      mt(
        "Mail server is not available. Complete the server deployment first.",
        "Server ya email haipatikani. Kamilisha deployment kwanza.",
      ),
    );
  }
  if (!res.ok)
    throw Error(
      body.error || mt("Mail request failed.", "Ombi la email limeshindwa."),
    );
  return body;
}
let status = null;
let statusAt = 0;
let owner = null;
let last = null;
let checkInFlight = null;
export function resetMailbox() {
  status = null;
  statusAt = 0;
  owner = state.profile?.id || null;
  last = null;
}
export async function mailboxStatus(force = false) {
  if (owner !== state.profile?.id) resetMailbox();
  if (!force && status && Date.now() - statusAt < 60000) return status;
  const userId = state.profile?.id;
  const result = await mailApi("status");
  if (state.profile?.id !== userId)
    throw Error(
      mt(
        "Account changed. Reload Mail.",
        "Akaunti imebadilika. Fungua Barua tena.",
      ),
    );
  status = result;
  statusAt = Date.now();
  return status;
}
export async function identifyMailUser(id) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.active?.postMessage({ type: "MAIL_USER", userId: id || null });
}
export async function enableMailNotifications() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    throw Error(
      mt(
        "This browser does not support push notifications.",
        "Browser hii haiwezi kupokea push notifications.",
      ),
    );
  const s = await mailboxStatus(true);
  if (!s.vapidPublicKey)
    throw Error(
      mt(
        "Ask the administrator to configure push keys.",
        "Mwambie admin aweke push keys kwenye server.",
      ),
    );
  if ((await Notification.requestPermission()) !== "granted")
    throw Error(
      mt(
        "Allow notifications in browser settings.",
        "Ruhusu notifications kwenye mipangilio ya browser.",
      ),
    );
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(
    atob(s.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));
  await mailApi("subscribe", { subscription: subscription.toJSON() });
  await identifyMailUser(state.profile.id);
  toast(
    mt("Email notifications enabled.", "Notifications za email zimewashwa."),
  );
}
export async function stopMailNotifications() {
  try {
    await mailApi("unsubscribe");
  } catch {
    /* local unsubscribe still protects this device */
  }
  const reg = await navigator.serviceWorker?.getRegistration();
  const subscription = await reg?.pushManager?.getSubscription();
  if (subscription) await subscription.unsubscribe();
  reg?.active?.postMessage({ type: "MAIL_USER", userId: null });
  if (reg) (await reg.getNotifications()).forEach((n) => n.close());
  resetMailbox();
}
export function checkMailbox() {
  if (checkInFlight) return checkInFlight;
  const current = state.profile?.id;
  checkInFlight = (async () => {
    const s = await mailboxStatus();
    if (!s.connected) return 0;
    const info = await mailApi("check");
    if (current !== state.profile?.id) return 0;
    const newer =
      last &&
      last.validity === info.validity &&
      info.latestUid > last.latestUid;
    last = info;
    if (newer) {
      toast(
        mt(
          "New email received. Open Mail to read it.",
          "Email mpya imefika. Fungua Barua kuisoma.",
        ),
        "info",
        7000,
      );
      window.dispatchEvent(new CustomEvent("hc:new-email"));
    }
    document.querySelectorAll("[data-external-unread]").forEach((n) => {
      n.textContent = info.unread || "";
    });
    return info.unread;
  })().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}
