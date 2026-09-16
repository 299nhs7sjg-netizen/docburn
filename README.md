# DocBurn

**Permanent PDF redaction.** Black out SSNs, emails, account numbers, and other secrets — burned into page pixels, not removable annotation layers. Private, offline-capable static site. Price: **$2.99 lifetime unlock**.

Your PDFs never leave the device — pdf.js renders pages; export rebuilds a PDF of burned JPEG page images (no leftover selectable text under black boxes).

Related to BlotOut’s “permanent not blur” wedge, but for **PDFs** (not a clone of SnapFit / BlotOut / LockFit / MetaGone image tools).

## Open locally

**Option A — double-click**

Open `index.html` in Chrome, Edge, Firefox, or Safari (CDN scripts need network once).

**Option B — local server (recommended)**

```bash
cd /path/to/docburn
python3 -m http.server 8767
```

Then visit: http://localhost:8767/

No build step. No Node. No paid APIs.

## Features

- Drag/drop or file picker (PDF)
- pdf.js page render + draw solid black redaction rectangles
- Export via pdf-lib: each page rasterized with black burned in
- Free tier: **page 1 only** + “DocBurn” watermark; Unlock $2.99 = all pages, no watermark, ads hidden
- Unlock via **license key only** (no honor-system button)
- Ad placeholders on free tier (`data-ad` regions); hidden when unlocked
- Gumroad license verify supported when `productPermalink` is live

## Unlock for testing

1. Open the unlock modal → paste a key from `VALID_KEYS` in `app.js`
2. Or open with `?demo=1` and use the demo key (see `KEYS.PRIVATE.md` locally)

Operator keys live in **`KEYS.PRIVATE.md`** (gitignored — never commit).

## Config

Edit `config.js`:

```js
checkoutUrl: "", // CoS: create Gumroad product, then paste URL
productPermalink: "docburn-lifetime",
adsenseClient: "", // optional
```

**Gumroad product may need creating.** CoS should create **DocBurn Lifetime** at $2.99 on the greenlight5868 Gumroad account (permalink `docburn-lifetime`), enable license keys, upload codes from `KEYS.PRIVATE.md`, then set `checkoutUrl` and redeploy. Until then, Buy CTA shows a “checkout not set” note; seed `VALID_KEYS` still unlock for testing.

See `PAYMENTS.md` for store + AdSense setup.

## Deploy

Static site → GitHub Pages from `main`.

```bash
git add -A && git commit -m "Update DocBurn" && git push origin main
```

**Never** `git add KEYS.PRIVATE.md`.

Live (when Pages is on): https://299nhs7sjg-netizen.github.io/docburn/
