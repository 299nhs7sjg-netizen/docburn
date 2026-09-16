# DocBurn payments & monetization

Hosting stays **GitHub Pages** (static, $0). No backend required for MVP.

Unlock is **license-key only**. There is no “I paid — unlock” honor button.

---

## 1. Sell $2.99 lifetime unlock (required)

**Gumroad product may need creating** (CoS). Suggested setup:

1. Create product: **DocBurn Lifetime** — price **$2.99** (one-time).
2. Permalink: `docburn-lifetime` → `https://greenlight5868.gumroad.com/l/docburn-lifetime`
3. Enable **license keys** / unique codes.
4. Upload codes from **`KEYS.PRIVATE.md` on the operator machine only** (never commit).
5. Paste the checkout URL into `config.js`:

```js
checkoutUrl: "https://greenlight5868.gumroad.com/l/docburn-lifetime",
productPermalink: "docburn-lifetime",
```

6. Commit and push to `main` so GitHub Pages redeploys.

Until `checkoutUrl` is set, the Buy button shows an on-page note. Seed keys in `VALID_KEYS` still work for QA.

Buyers pay → receive a key → paste it in DocBurn → `VALID_KEYS` or Gumroad verify → unlock.

### When keys run low

1. Generate more `IB-DOC-XXXX-XXXX` codes into **`KEYS.PRIVATE.md`** (local only).
2. Add the new codes to `VALID_KEYS` in `app.js`.
3. Upload the new codes to Gumroad.
4. Redeploy (push to `main`).

The first **~10** sale keys from `KEYS.PRIVATE.md` are seeded in `app.js`.

---

## 2. Google AdSense (free-tier revenue)

1. Apply for [Google AdSense](https://www.google.com/adsense/).
2. When approved, paste publisher id + slots into `config.js`.
3. Redeploy. Until then, loud placeholder ads show on free tier.
4. Unlocked users: all `[data-ad]` regions are hidden.

---

## 3. Redeploy checklist

```bash
git add -A && git commit -m "Update DocBurn config / keys" && git push origin main
```

**Never** `git add KEYS.PRIVATE.md` or `KEYS.md`. Both are gitignored.
