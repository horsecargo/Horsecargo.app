# Horse Cargo — Cargo Operating System (v1.0)

## Roles, Leads, Sourcing, Staff Mail & QR scan update (v6)

Install **after** v5, in two steps (Postgres needs the new role values committed before they are used):

1. `supabase/crm-mail-v6-1-roles.sql` — run on its own.
2. `supabase/crm-mail-v6-2.sql` — then deploy the matching `www/` files. Netlify generates a cache fingerprint for each web release.

Full order: schema → seed → accounting-1-roles → accounting-2 → shipments-v2 → documents-v3 → staff-storage-v4 → documents-packing-v5 → crm-mail-v6-1-roles → crm-mail-v6-2. `crm-mail-v6-2.sql` is rerunnable; do not rerun older migrations after it (they replace RPC definitions).

- **Roles**: Manager, Operations, HR, Accounting (`accountant`), Logistics, Sales & Marketing, Sourcing, Customer Care (+ the technical Administrator). Counter, Warehouse, Cashier, Release officer, Finance manager and Viewer are retired from *new* assignment; current holders keep working.
- **Permissions** are data (`role_permissions` + `permission_catalog`). The Administrator edits them in *Users → Role permissions*; the database enforces them (`has_perm`). Defaults are seeded once and are not overwritten by re-running the migration.
- **Navigation** has six top-level work areas: Dashboard · Customers & Sales · Cargo Operations · Finance · Reports · Administration. Only permitted, nonempty groups appear; one group opens at a time. Finance has Overview, Customer accounts, Costs & Suppliers, and Accounts; financial reports live under Reports. Cargo Labels stay directly after GRN within Cargo Operations (also on the shipment page and after recording a GRN). Scan and Staff Mail are top-bar shortcuts. The phone bar offers Home, the user's main work area, permitted Scan/Mail tools, and More; More uses the same groups. Dashboard shortcuts follow the user's role and permissions.
- **QR codes**: one registry (`documents`) with an opaque random token per GRN, Invoice, Packing List, Cargo Label (and the existing receipts / delivery notes). Tokens are issued automatically when the record is created. The QR holds only `verify.html?d=<token>` — no IDs, amounts or contacts. Shipment Confirmation stays retired: old ones verify as "historical", no new ones are issued.
- **Scan** (camera or typed number) calls `scan_document()`, which resolves the token on the server and returns the document type, number, date, prepared-by, status and only the facts relevant to that type (money only for roles that may see invoices). Unknown codes show "QR Code Not Recognized"; revoked codes show as revoked. Managers can revoke & replace a printed QR.
- **Leads** (`LEAD-YYYYMMDD-NNN`): every staff role can record one (name, one contact, what they need). Team roles see all leads; others see the leads they recorded or are assigned. Manager assigns. Convert to Customer checks phone/email first and never creates a second customer with the same phone. Create Sourcing Request links the lead.
- **Sourcing** (`SRC-YYYYMMDD-NNN`): New → Searching → Supplier found → Quotation sent → Customer approved → Purchased → Completed (or Cancelled with a reason), with full history.
- **Staff Mail**: internal messages with threads, To/CC, reply, reply-all, forward, read receipts, Inbox/Sent/Archived/Trash, search and an unread counter (light 30-second poll). Tables are ready for a future SMTP bridge.
- **Search** (top bar): shipment, GRN, invoice, packing list, lead, sourcing, customer or phone — results respect permissions.

Tests: see [test/README-test.md](test/README-test.md) (`v6_test.mjs`, `v6_e2e.mjs`, the latter feeding a real QR video into the camera).

## Document & Packing List update (v5)

Install `supabase/documents-packing-v5.sql` **after** `staff-storage-v4.sql`, then deploy the matching `www/` files. The full schema order is schema → seed → accounting-1-roles (separate transaction) → accounting-2 → shipments-v2 → documents-v3 → staff-storage-v4 → documents-packing-v5. Do not rerun older migrations after v5: they replace RPC definitions.

- GRN and Invoice are issued immediately, without approval. Shipment Confirmation is retired from active routes/menus; its database records and historical QR verification remain available.
- GRN, Invoice and Packing List support A4 portrait printing and a Download PDF action. Invoice payment details are shown directly on the document.
- Cargo descriptions/quantities come from `v_shipment_items`. Cargo rows have no individual sale price in this application; freight/extra-charge rows therefore remain separate, preserving KG/CBM pricing, FX, discounts, paid amounts and balances. The billed unit rate shown is the stored billed line amount divided by its billed quantity.
- Packing Lists use `HC-PL-YYMM-####`, the existing database counter convention. Boxes may combine shipments or split one item across boxes. Draft quantities reserve stock immediately and are included in existing Storage packed totals. Removing/reducing draft items restores availability. Finalized lists are read-only.
- List/box/item mutations use the existing `storage.pack` permission; active staff can read operational reports. The existing partial-packing API continues sharing the same stock ledger and locks. Linked list entries cannot be reversed through the old entry-void action.
- Shipment editing keeps item IDs and packing history. Received items cannot be deleted or have their unit changed; declared quantities cannot fall below already packed quantities.

See [test/README-test.md](test/README-test.md) for isolated PostgreSQL, RLS, concurrency and browser/PDF checks. These tests use local fixture data, not production. Native Android PDF saving requires device validation; the browser download and A4 print paths are covered.

Web app (HTML · CSS · JavaScript) + Android APK (Capacitor) + Supabase backend.
Imejengwa kwa kutumia features za **ACMS** kama reference, na kanuni za **Horse Cargo Operating Blueprint**.

> 🇬🇧 English summary at the bottom.

---

## 1. Kilichomo

```
horse-cargo-app/
├── www/                     ← App yenyewe (HTML/CSS/JS) — web na APK zinatumia hii hii
│   ├── index.html           ← App ya wafanyakazi (login)
│   ├── track.html           ← Ukurasa wa umma wa kufuatilia mzigo (hauhitaji login)
│   ├── config.js            ← ⚠️ Weka Supabase URL + anon key hapa
│   ├── css/app.css
│   ├── js/                  ← app.js (router), api.js, ui.js, i18n.js (EN/SW), scanner.js
│   │   └── pages/           ← dashboard, bookings, booking, grn, customers, shipments, reports …
│   ├── vendor/              ← supabase-js, qrcode, html5-qrcode (offline, hakuna CDN)
│   ├── manifest.webmanifest + sw.js   ← PWA (inaweza ku-install kwenye simu/PC)
│   ├── img/                 ← logo.jpg (asili), logo-white.png, mark-white.png (farasi tu)
│   └── icons/               ← icons za PWA zilizotokana na logo
├── supabase/
│   ├── schema.sql           ← Tables, views, RLS, business rules (RPC)
│   ├── seed.sql             ← Matawi DXB/DAR/MWZ, settings, aina za mizigo + viwango (placeholder)
│   ├── storage.sql          ← (hiari) bucket ya picha za GRN
│   ├── accounting-1-roles.sql ← Uhasibu hatua 1: roles mpya (accountant, finance_manager)
│   └── accounting-2.sql     ← Uhasibu hatua 2: kampuni 2, CoA, leja, bili, matumizi, ripoti
├── android/                 ← Capacitor Android project (tayari imetengenezwa)
├── .github/workflows/build-apk.yml   ← GitHub inajenga APK yenyewe
├── capacitor.config.json · package.json · netlify.toml
└── test/                    ← Local test server + Playwright E2E (si lazima kwa production)
```

## 2. Modules

| Module | Inafanya nini |
|---|---|
| **Dashboard** | CBM ghalani, madeni, makusanyo leo/mwezi, pipeline ya status 8, makontena, matukio ya karibuni |
| **Wateja** | Namba `HC-C-00001`, TIN, kitambulisho, kikomo cha mkopo, salio, historia ya booking, WhatsApp |
| **Booking** | Mteja → njia (bahari/anga, DXB/DAR/MWZ) → aina ya mzigo → makadirio ya bei + amana inayohitajika. Onyo la vibali (TBS/TMDA) na kuzuia mizigo ya TASAC (GN 184/2025) |
| **GRN (ghala)** | Vipimo kwa mistari (vipande × L×W×H, kg) → CBM, kg za ujazo, kg za kulipia → **bei inafungwa hapa** na ankara inaundwa yenyewe |
| **Ankara** | Nauli (imefungwa) + gharama za ziada + ushuru (kama deni, si mapato) + punguzo (meneja tu) |
| **Malipo** | USD / AED / TZS na exchange rate, cash/benki/pesa ya simu/kadi, risiti `HC-RCT-…`, kubatilisha (meneja, na sababu) |
| **Makontena** | `HC-SEA-DXB-DAR-0001`, namba ya kontena/seal/BL, uwezo wa CBM & % ya matumizi, kupakia kwa kuchagua au **kwa kuskani QR**, Imeondoka → Imefika (booking zote zinabadilika pamoja) |
| **Forodhani → Tayari → Kukabidhi** | Makabidhiano yanahitaji jina/simu/kitambulisho, hati ya makabidhiano |
| **Skani** | Kamera inasoma QR ya lebo ya katoni → inafungua booking |
| **Nyaraka** | Ankara, risiti, GRN, lebo za katoni (HORSE CARGO / ref / destination / PIECE n OF N + QR), waybill, orodha ya upakiaji, hati ya makabidhiano — zote EN/SW |
| **Ripoti** | Makusanyo (kwa njia/sarafu/tawi), madeni kwa umri (0–30/31–90/90+), mapato vs ushuru, ujazo kwa njia — CSV |
| **Viwango (Rate card)** | USD/CBM bahari, USD/kg anga, kima cha chini |
| **Watumiaji, Audit log, Settings** | Roles 8, kila hatua muhimu inaandikwa kwenye audit log |
| **Ufuatiliaji wa umma** | `track.html?ref=HC-BK-2609-0001` — hauonyeshi fedha wala mawasiliano ya mteja |

## 3. Kanuni zinazolazimishwa na database (haziwezi kukwepwa kutoka app wala API)

1. **Kizuizi cha amana** — mzigo hauwezi kupokelewa ghalani (GRN) kabla amana haijalipwa.
2. **Kizuizi cha malipo** — mzigo haukabidhiwi kukiwa na deni (admin tu anaweza kuruhusu kwa sababu iliyoandikwa kwenye audit).
3. **Bei inafungwa kwenye GRN**, si kwenye makadirio.
4. **Mgawanyo wa majukumu** — aliyepima mzigo ≠ aliyepokea fedha ≠ aliyekabidhi mzigo.
5. Status, namba za kumbukumbu, vipimo na fedha **haviwezi kuhaririwa moja kwa moja** — vinabadilika kupitia functions za database tu. Hakuna mtu anayeweza kufuta (DELETE) rekodi.

| Cheo | Anaweza |
|---|---|
| Administrator | Kila kitu + watumiaji |
| Manager | Kila kitu isipokuwa kusimamia watumiaji; punguzo, kubatilisha, kughairi |
| Counter / Sales | Wateja, booking, gharama za ziada |
| Cashier | Malipo, wateja |
| Warehouse | GRN, kupakia kontena |
| Operations | Makontena, forodhani/tayari, gharama |
| Release officer | Kukabidhi mzigo |
| Viewer | Kuangalia tu |

Namba: `HC-C-#####` · `HC-BK-YYMM-####` · `HC-GRN-DXB-YYMM-####` · `HC-INV-YYMM-####` · `HC-RCT-YYMM-####` · `HC-SEA-DXB-DAR-####` · `HC-REL-YYMM-####`

---

## 4. Kuweka mfumo hewani (hatua kwa hatua)

### A. Supabase (dakika ~10)
1. Fungua project mpya kwenye [supabase.com](https://supabase.com) (region: *Frankfurt* au karibu na UAE/TZ).
2. **SQL Editor** → bandika `supabase/schema.sql` yote → **Run**.
3. Kisha `supabase/seed.sql` → **Run**. (Hiari: `supabase/storage.sql` kwa picha za GRN.)
3b. **Uhasibu:** endesha `supabase/accounting-1-roles.sql` → **Run** peke yake. KISHA (query mpya) `supabase/accounting-2.sql` → **Run**.
    Lazima ziwe run mbili tofauti (Postgres haiwezi kutumia role mpya ndani ya run ile ile iliyoiongeza). Ni salama kuzi-run tena. Mwisho wake unaingiza kwenye leja miamala yote ya zamani (backfill).
4. **Authentication → Providers → Email**: iwe ON. Kama hutaki barua ya kuthibitisha email, zima *Confirm email*.
5. **Project Settings → API**: nakili *Project URL* na *anon public key*.

### B. Config
Fungua `www/config.js` weka:
```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
PUBLIC_TRACK_URL: 'https://app.horsecargoltd.com/track.html',
```
(anon key ni salama kuwa kwenye app — kila table inalindwa na Row Level Security.)

### C. Web app (Netlify / Vercel / Hostinger)
- **Netlify**: unganisha GitHub repo — `netlify.toml` tayari inasema publish folder ni `www`. Au buruta folder `www` kwenye Netlify Drop.
- **Hostinger**: pakia yaliyomo ndani ya `www/` kwenye `public_html` (au subdomain `app.horsecargoltd.com`).
- Link ya tracking kwa website ya horsecargoltd.com: `https://app.horsecargoltd.com/track.html`

### D. ⚠️ Mtumiaji wa kwanza = Admin
Mara tu baada ya kupeleka hewani: fungua app → **"Mfanyakazi mpya? Omba kuingia"** → jisajili.
**Mtu wa kwanza kujisajili anakuwa Administrator moja kwa moja.** Wafanyakazi wengine wanajisajili hivyo hivyo, kisha admin anawapa cheo + tawi kwenye **Watumiaji** na kuwawasha.

### E. APK ya Android
APK ya live inafungua **https://horsecargoapp.netlify.app** kupitia Trusted Web Activity.
User ana-install APK iliyosainiwa mara moja; mabadiliko ya web app yanamfikia baada ya
Netlify deployment. App iliyo wazi inaonyesha **Sasisha sasa** ili user ahifadhi kazi
yake kabla ya kutumia update. Mabadiliko ya Android yenyewe yanahitaji APK mpya.

**Actions → Build Android APK** hujenga preview kwenye PR, na signed release kwenye
`main` ikiwa signing secrets zimewekwa. Preview ina package tofauti na release.
Hifadhi signing key ile ile kwa kila native update; public fingerprint yake ipo
kwenye `www/.well-known/assetlinks.json`. Usisambaze signing key kwa staff.

Maelezo ya signing, secrets, domain verification, builds na device checks:
[Android updates](docs/android-updates.md). Kujenga preview kwenye PC:
`npm ci` kisha `npm run apk:debug` (JDK 21 na Android SDK zinahitajika).

---

## 5. Kabla ya kuanza kutumia (maamuzi ya client — Blueprint §20)

- [ ] **Viwango halisi** kwenye *Rate card* — vilivyomo ni placeholder (mf. $180/CBM bahari).
- [ ] **Asilimia ya amana** (sasa: bahari 30%, anga 50%) — *Settings*.
- [ ] **Exchange rates** AED/TZS — *Settings* (zinaweza kubadilishwa kila malipo pia).
- [ ] Siku za kuhifadhi bure na gharama kwa siku (sasa zinaongezwa kama "gharama ya ziada" manually).
- [ ] Nani ni release officer Dar na Mwanza.
- [x] Logo na rangi za Horse Cargo zimewekwa (burgundy `#800C1F` + nyeupe). Ukipata logo ya ubora wa juu (SVG/PNG ≥1024px), badilisha `www/img/*`, `www/icons/*` na `android/app/src/main/res/mipmap-*` ili icon ya APK iwe kali zaidi.

## 6. Mipaka ya v1 (kwa v2)

- **Kuprint** kunafanya kazi kwenye web (browser). Kwenye APK, tumia *Tuma WhatsApp* au fungua web kuprint.
- **CSV** kwenye APK inatumia share sheet ya simu; kwenye web inapakuliwa.
- Hakuna bado: portal ya mteja, SMS/WhatsApp za kiotomatiki, malipo mtandaoni (Selcom), gharama za storage za kiotomatiki, HR (uhasibu A1 umeongezwa — tazama §6A). Muundo wa database uko tayari kuongeza hivi.

## 6A. Module ya Uhasibu (A1)

**Muundo:** kampuni 2 — **AE** (Horse Cargo UAE, tawi DXB) na **TZ** (Horse Cargo Company Ltd, DAR + MWZ). Vitabu kwa **USD**; kila mstari unahifadhi sarafu halisi (AED/TZS) na FX.

**Maingizo ya moja kwa moja kutoka shipping (hakuna kuingiza mara mbili):**

| Tukio | Ingizo |
|---|---|
| Amana / malipo kabla ya ankara | Dr Fedha/Benki · Cr Amana za wateja (2200) |
| GRN → ankara (freight) | Dr Wadaiwa (1300) · Cr Mapato sea/air (4100/4200); amana zinahamishwa kupunguza deni |
| Tozo za ziada / ushuru | Cr 4300 / Cr Ushuru wa wateja 2300 (si mapato) |
| Punguzo | Dr Punguzo la mauzo (4900) |
| Kufuta risiti / ankara | Ingizo la kugeuza (reversal) — hakuna kufuta |
| Pesa imepokelewa na kampuni nyingine | Intercompany 1350/2150 moja kwa moja |
| Bili ya msambazaji | Dr Gharama (5xxx/6xxx, imeunganishwa na kontena) · Cr Wadai (2100) |
| Malipo ya bili / matumizi | Dr Wadai au Gharama · Cr Fedha/Benki |

**Kurasa:** Muhtasari wa fedha · Bili za wasambazaji · Matumizi · Majarida (maker–checker) · Ripoti (Faida & hasara, Mizania, Urari, Faida kwa kontena) · Orodha ya akaunti + leja ya kila akaunti · Fedha na benki · Wasambazaji. Ukurasa wa kontena unaonyesha **Gharama na faida** (gharama za kontena zinagawanywa kwa CBM kwa sea, kg kwa air). Cashier anachagua *Imewekwa kwenye* (akaunti ya fedha) wakati wa kupokea malipo.

**Roles:** `accountant` (bili, matumizi, majarida rasimu) · `finance_manager` (anaidhinisha majarida — si yake mwenyewe, anafuta bili/matumizi, anaongeza akaunti) · `manager` anaona tu. Weka roles kwenye *Watumiaji*.

**Kabla ya kuanza:** (1) Weka akaunti halisi za benki/M-Pesa kwenye *Fedha na benki*. (2) Ingiza salio la mwanzo kwa jarida la mkono (Dr Benki · Cr 3900 Opening balance) na liidhinishwe. (3) Hakikisha FX kwenye *Settings*.

**Bado (A2):** VAT/EFD returns, depreciation ya kiotomatiki, kufunga mwaka, bank reconciliation, payroll.

## 7. Majaribio yaliyofanyika

Yamejaribiwa kwenye Postgres 16 halisi na schema hii hii + RLS, kupitia supabase-js na Chromium (Playwright):
booking → amana (AED + USD) → kizuizi cha amana → GRN (bei imefungwa: 2.602 CBM × $250 = $650.50) → ushuru + delivery → kontena → pakia → imeondoka → imefika → tayari → **kizuizi cha malipo kimezuia** → malipo TZS (M-Pesa) → makabidhiano → nyaraka → tracking ya umma. Pia: mgawanyo wa majukumu, roles, kuhariri status moja kwa moja (kumekataliwa), insert ya risiti moja kwa moja (imekataliwa na RLS), mobile 400px + Kiswahili. Hakuna JS errors.

Kujaribu local: `test/README-test.md`.

---

## 🇬🇧 English summary

Horse Cargo OS is a vanilla HTML/CSS/JS progressive web app backed by Supabase (Postgres + Auth + RLS), packaged for Android with Capacitor. All business rules live in the database as `SECURITY DEFINER` RPCs guarded by role checks and trigger guards, so the web app, the APK and any direct API call are held to the same rules: deposit gate before warehouse receipt, settlement gate before release, price lock at GRN, duty as a receivable, three-way segregation of duties, append-only money records with voiding and a full audit log.

**Accounting (A1):** two legal entities (AE, TZ) with automatic intercompany, USD double-entry ledger fed automatically by receipts, invoices and voids; supplier bills and expenses linked to containers; maker–checker manual journals; P&L, balance sheet (with intercompany elimination), trial balance and profit per container. Install by running `accounting-1-roles.sql` and then `accounting-2.sql` as two separate runs.

**Setup:** run `supabase/schema.sql` then `seed.sql` in the Supabase SQL editor → put the project URL and anon key in `www/config.js` → deploy `www/` to Netlify/Vercel/Hostinger → the first person to sign up becomes admin. The live Android APK uses the existing Netlify app; see [Android updates](docs/android-updates.md) for signing and distribution. Set real rates, deposit percentages and FX in the app before go-live.
