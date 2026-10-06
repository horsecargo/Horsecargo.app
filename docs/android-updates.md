# Android APK and web updates

The live APK opens **https://horsecargoapp.netlify.app/index.html** using Google's
Trusted Web Activity library. The existing Capacitor project remains available
as a bundled build; `android/live` is the default distribution build.

## What staff receive

- Install the signed `horse-cargo.apk` once. A compatible browser such as Chrome
  must be installed; Android 7.0 or later is required. Camera and downloads use
  the browser's normal permissions.
- Deploy changes to `www/` through the existing Netlify connection. No new APK
  is needed for menus, screens, translations, or other web features.
- Netlify runs `scripts/stamp-web-release.mjs`, so every changed web release has
  a different service worker even when the developer does not edit `sw.js`.
- An open app checks for updates on return to the foreground, on reconnection,
  and every 15 minutes while visible. It shows **Update now / Sasisha sasa**.
  Staff save their work before choosing this action; there is no forced reload.
- A release is cached completely before activation. If caching fails, the
  existing release remains usable. Supabase data is never cached by this worker;
  transactions still need an internet connection and existing RPC/RLS access.
- If all tabs/app windows for this origin close, a waiting release can activate
  normally, and the next opening uses that release.

## Signed release and website verification

Package: `com.horsecargoltd.app`. The release certificate fingerprint in
`www/.well-known/assetlinks.json` must match the APK signing certificate. Publish
that file at the **same origin** as the app. It must return HTTP 200 JSON without
a redirect. Before that deployment, the app can fall back to a browser toolbar;
full-screen verification must be checked on Android after publication.

The signing key and passwords are private files outside this repository. Back
them up privately and keep the same key for later Android releases. If an older
APK has already been distributed with another certificate, rebuild using that
original key and update the public fingerprint before distributing an upgrade.

For automated signed releases, add these repository **Actions secrets** once:

| Secret | Value |
| --- | --- |
| `HC_KEYSTORE_BASE64` | Base64 encoding of the stable `horse-cargo.jks` |
| `HC_KEYSTORE_PASSWORD` | Keystore password |
| `HC_KEY_ALIAS` | `horsecargo` |
| `HC_KEY_PASSWORD` | Key password |

Do not commit these values. Pull requests build and lint a separate
`com.horsecargoltd.app.preview` APK without release secrets. Main builds produce
a signed release only when the key is configured; unsigned APKs are not offered
as installable releases. The workflow uses increasing version codes above 20000.

## Build and checks

Requires Node.js, JDK 21, Android SDK platform 36 and build tools 35.0.0. Set
`JAVA_HOME` and `ANDROID_HOME`, then run:

```text
npm ci
npm run apk:debug
```

For a signed release, provide the four `HC_KEY*` environment variables above plus
`HC_KEYSTORE_PATH` (absolute local path), then run `npm run apk:release`. Set
`HC_VERSION_CODE` above the last installed release when building a native update.
The legacy bundled build is `npm run apk:bundled`.

`npm run test:updates` covers first install, update notification, unsaved forms,
Kiswahili, 320px layout, offline cached assets, uncached private responses,
complete activation, failed-release fallback and automatic release fingerprints.

Changes to the package, icon, Android permissions, browser integration or domain
require a newly signed APK. Direct APK distribution asks the user to approve
installation of that update. Silent native updates require a distribution
channel such as Google Play or managed company devices; this setup does not
silently install packages.

Before staff distribution, check login, QR camera permission, PDF saving, back
navigation, full-screen domain verification, and update acceptance on a physical
Android device. Local/CI compilation is not a physical-device test.
