/**
 * DocBurn — permanent PDF redaction (client-side)
 * Unlock ONLY via valid license key (no honor / "I paid" path).
 * VALID_KEYS: seed from KEYS.PRIVATE.md (operator machine only; never commit).
 */
(function () {
  "use strict";

  const STORAGE_KEY = "docburn_unlocked_v1";
  const SOURCE_KEY = "docburn_unlock_src_v1";
  const DEMO_KEY = "IB-DOC-DEMO-TEST";
  const RENDER_SCALE = 2; // burn quality

  /* First ~10 sale keys from KEYS.PRIVATE.md + demo (?demo=1 only). */
  const VALID_KEYS = new Set([
    DEMO_KEY,
    "IB-DOC-9ABR-YEMJ",
    "IB-DOC-PSLQ-6KJ2",
    "IB-DOC-XO8M-8C17",
    "IB-DOC-XCA1-EZGU",
    "IB-DOC-11CO-N85G",
    "IB-DOC-OIZT-VGXC",
    "IB-DOC-LXJO-FEDZ",
    "IB-DOC-REIA-52G8",
    "IB-DOC-KQZK-0LJH",
    "IB-DOC-ZX9G-ST2F",
  ]);

  const CFG = window.DOCBURN_CONFIG || {};

  const AD_COPY = {
    top: "<strong>Sponsored</strong> — Burn redactions without ads. Unlock DocBurn lifetime for $2.99 → no watermark, multi-page export.",
    mid: "<strong>FakeSponsor Docs</strong> — “Redact” in the cloud and hope overlays stick. Or stay private with DocBurn Unlock ($2.99).",
    export: "<strong>Export clean — Unlock DocBurn $2.99</strong><br />No watermark. All pages. One license key after checkout.",
    footer: "<strong>Sponsored · DocBurn Unlock</strong> — Kill ads + watermark with one $2.99 license key from the store.",
  };

  let unlocked = false;
  let pdfDoc = null;
  let pdfBytes = null;
  let sourceName = "document.pdf";
  let pageCount = 0;
  let currentPage = 1;
  /** @type {Record<number, Array<{x:number,y:number,w:number,h:number}>>} */
  let redactions = {}; // page 1-based → rects in canvas pixel space (at RENDER_SCALE)
  let pageSizeCache = {}; // page → {width, height} at RENDER_SCALE
  let drawing = false;
  let dragStart = null;
  let currentRect = null;
  let exporting = false;

  const $ = (id) => document.getElementById(id);
  const els = {
    dropZone: $("dropZone"),
    fileInput: $("fileInput"),
    dropEmpty: $("dropEmpty"),
    viewer: $("viewer"),
    canvasWrap: $("canvasWrap"),
    pageCanvas: $("pageCanvas"),
    drawCanvas: $("drawCanvas"),
    pickBtn: $("pickBtn"),
    prevPage: $("prevPage"),
    nextPage: $("nextPage"),
    pageLabel: $("pageLabel"),
    freeNote: $("freeNote"),
    unlockBtn: $("unlockBtn"),
    unlockLink: $("unlockLink"),
    footerUnlock: $("footerUnlock"),
    unlockBadge: $("unlockBadge"),
    undoBtn: $("undoBtn"),
    clearBtn: $("clearBtn"),
    exportBtn: $("exportBtn"),
    resetBtn: $("resetBtn"),
    docMeta: $("docMeta"),
    pageList: $("pageList"),
    statusLine: $("statusLine"),
    unlockModal: $("unlockModal"),
    modalClose: $("modalClose"),
    licenseKey: $("licenseKey"),
    applyKeyBtn: $("applyKeyBtn"),
    buyBtn: $("buyBtn"),
    checkoutHint: $("checkoutHint"),
    unlockError: $("unlockError"),
    demoUnlockBtn: $("demoUnlockBtn"),
    nagModal: $("nagModal"),
    nagClose: $("nagClose"),
    nagUnlockBtn: $("nagUnlockBtn"),
    nagDismiss: $("nagDismiss"),
  };

  const pageCtx = els.pageCanvas.getContext("2d");
  const drawCtx = els.drawCanvas.getContext("2d");

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function normalizeKey(k) {
    return String(k || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function isUnlocked() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (!v) return false;
      const k = normalizeKey(v);
      if (!k || k === "1") return false;
      if (VALID_KEYS.has(k)) return true;
      return localStorage.getItem(SOURCE_KEY) === "gumroad";
    } catch (_) {
      return false;
    }
  }

  function persistUnlock(key, viaGumroad) {
    const k = normalizeKey(key);
    if (!k || k === "1") return false;
    if (!viaGumroad && !VALID_KEYS.has(k)) return false;
    unlocked = true;
    try {
      localStorage.setItem(STORAGE_KEY, k);
      localStorage.setItem(SOURCE_KEY, viaGumroad ? "gumroad" : "seed");
    } catch (_) {}
    return true;
  }

  async function verifyGumroadLicense(rawKey) {
    const productId = String(CFG.productId || CFG.product_id || "").trim();
    const permalink = String(CFG.productPermalink || CFG.product_permalink || "").trim();
    if (!productId && !permalink) {
      return { ok: false, message: "Product not configured for license verify." };
    }
    const body = new URLSearchParams();
    if (productId) body.set("product_id", productId);
    else body.set("product_permalink", permalink);
    body.set("license_key", String(rawKey || "").trim());
    const res = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (data && data.success === true) {
      const p = data.purchase || {};
      if (p.refunded || p.chargebacked || p.disputed) {
        return { ok: false, message: "This license is no longer valid." };
      }
      return { ok: true, data: data };
    }
    return {
      ok: false,
      message:
        (data && (data.message || data.error)) ||
        "Invalid key. Buy from the store to receive a license key, then paste it here.",
    };
  }

  function hideAds() {
    document.querySelectorAll("[data-ad]").forEach(function (el) {
      el.hidden = true;
    });
  }

  function showAds() {
    document.querySelectorAll("[data-ad]").forEach(function (el) {
      el.hidden = false;
    });
  }

  function fillAdPlaceholders() {
    document.querySelectorAll("[data-ad]").forEach(function (region) {
      const kind = region.getAttribute("data-ad") || "";
      const slotKey = region.getAttribute("data-ad-slot") || kind;
      const creative = region.querySelector("[data-ad-creative]");
      const client = (CFG.adsenseClient || "").trim();
      const slots = CFG.adSlots || {};
      const slotId = (slots[slotKey] || "").trim();

      if (client && slotId && creative) {
        creative.innerHTML = "";
        const ins = document.createElement("ins");
        ins.className = "adsbygoogle";
        ins.style.display = "block";
        ins.setAttribute("data-ad-client", client);
        ins.setAttribute("data-ad-slot", slotId);
        ins.setAttribute("data-ad-format", "auto");
        ins.setAttribute("data-full-width-responsive", "true");
        creative.appendChild(ins);
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (_) {}
      } else if (creative && AD_COPY[kind]) {
        creative.innerHTML = AD_COPY[kind];
      }
    });
  }

  function updateCheckoutLink() {
    const url = (CFG.checkoutUrl || "").trim();
    const hint = els.checkoutHint;
    if (url) {
      els.buyBtn.href = url;
      els.buyBtn.removeAttribute("aria-disabled");
      if (hint) {
        hint.hidden = false;
        hint.style.color = "var(--muted)";
        hint.textContent =
          "After checkout, your store email includes a license key. Paste it below.";
      }
    } else {
      els.buyBtn.href = "#";
      els.buyBtn.onclick = function (e) {
        if (!(CFG.checkoutUrl || "").trim()) {
          e.preventDefault();
          if (els.unlockError) {
            els.unlockError.textContent =
              "Checkout URL not set. CoS: create Gumroad product DocBurn Lifetime ($2.99), then paste URL into config.js → checkoutUrl.";
            els.unlockError.hidden = false;
          }
        }
      };
      if (hint) {
        hint.hidden = false;
        hint.style.color = "var(--danger)";
        hint.textContent =
          "Checkout URL not set — CoS: create Gumroad product (docburn-lifetime, $2.99) and paste the URL into config.js → checkoutUrl, then redeploy.";
      }
    }
  }

  function updateUI() {
    unlocked = isUnlocked();
    if (unlocked) {
      els.unlockBadge.textContent = "Unlocked";
      els.unlockBadge.className = "badge pro";
      els.unlockBtn.textContent = "Unlocked ✓";
      els.unlockBtn.disabled = true;
      els.freeNote.hidden = true;
      hideAds();
    } else {
      els.unlockBadge.textContent = "Free";
      els.unlockBadge.className = "badge free";
      els.unlockBtn.textContent = "Unlock $2.99";
      els.unlockBtn.disabled = false;
      els.freeNote.hidden = false;
      showAds();
      fillAdPlaceholders();
    }
    updateToolbar();
    renderPageList();
  }

  function updateToolbar() {
    const has = !!pdfDoc;
    const rects = redactions[currentPage] || [];
    els.undoBtn.disabled = !has || rects.length === 0;
    els.clearBtn.disabled = !has || rects.length === 0;
    els.exportBtn.disabled = !has || exporting;
    els.resetBtn.disabled = !has || exporting;
    els.prevPage.disabled = !has || currentPage <= 1;
    els.nextPage.disabled = !has || currentPage >= pageCount;
    if (has) {
      els.pageLabel.textContent = "Page " + currentPage + " / " + pageCount;
    }
  }

  function openModal() {
    els.unlockError.hidden = true;
    if (els.licenseKey) els.licenseKey.value = "";
    updateCheckoutLink();
    const params = new URLSearchParams(location.search);
    els.demoUnlockBtn.hidden = params.get("demo") !== "1";
    els.unlockModal.hidden = false;
    if (els.licenseKey) els.licenseKey.focus();
  }

  function closeModal() {
    els.unlockModal.hidden = true;
  }

  function openNag() {
    els.nagModal.hidden = false;
  }

  function closeNag() {
    els.nagModal.hidden = true;
  }

  async function tryUnlock(raw) {
    const rawStr = String(raw || "").trim();
    const k = normalizeKey(rawStr);
    if (!k) {
      els.unlockError.textContent =
        "Paste your license key from the store receipt, then tap Apply.";
      els.unlockError.hidden = false;
      return;
    }
    if (VALID_KEYS.has(k)) {
      if (k === DEMO_KEY) {
        const params = new URLSearchParams(location.search);
        if (params.get("demo") !== "1") {
          els.unlockError.textContent =
            "Demo key only works with ?demo=1 in the URL.";
          els.unlockError.hidden = false;
          return;
        }
      }
      persistUnlock(k, false);
      updateUI();
      closeModal();
      return;
    }
    if (els.applyKeyBtn) els.applyKeyBtn.disabled = true;
    els.unlockError.textContent = "Checking license…";
    els.unlockError.hidden = false;
    try {
      const result = await verifyGumroadLicense(rawStr);
      if (result.ok) {
        persistUnlock(k, true);
        updateUI();
        closeModal();
        return;
      }
      els.unlockError.textContent =
        result.message ||
        "Invalid key. Buy from the store to receive a license key, then paste it here.";
      els.unlockError.hidden = false;
    } catch (_) {
      els.unlockError.textContent =
        "Could not verify license. Check your connection and try again.";
      els.unlockError.hidden = false;
    } finally {
      if (els.applyKeyBtn) els.applyKeyBtn.disabled = false;
    }
  }

  function setStatus(msg) {
    if (els.statusLine) els.statusLine.textContent = msg;
  }

  function renderPageList() {
    if (!els.pageList) return;
    els.pageList.innerHTML = "";
    if (!pdfDoc) return;
    for (let i = 1; i <= pageCount; i++) {
      const li = document.createElement("li");
      const n = (redactions[i] || []).length;
      if (n) li.classList.add("has-redact");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent =
        "Page " + i + (n ? " · " + n + " redaction" + (n === 1 ? "" : "s") : "");
      if (!unlocked && i > 1) btn.textContent += " (unlock)";
      btn.addEventListener("click", function () {
        goToPage(i);
      });
      li.appendChild(btn);
      els.pageList.appendChild(li);
    }
  }

  async function loadFile(file) {
    if (!file || !/\.pdf$/i.test(file.name || "") && file.type !== "application/pdf") {
      alert("Please choose a PDF file.");
      return;
    }
    if (!window.pdfjsLib || !window.PDFLib) {
      alert("PDF libraries failed to load. Check your network and reload.");
      return;
    }
    sourceName = (file.name || "document").replace(/\.pdf$/i, "") + "-docburn.pdf";
    setStatus("Loading PDF…");
    try {
      const buf = await file.arrayBuffer();
      pdfBytes = buf.slice(0);
      pdfDoc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      pageCount = pdfDoc.numPages;
      currentPage = 1;
      redactions = {};
      pageSizeCache = {};
      els.dropEmpty.hidden = true;
      els.viewer.hidden = false;
      els.docMeta.innerHTML =
        '<p class="preview-meta"><strong>' +
        escapeHtml(file.name || "document.pdf") +
        "</strong><br />" +
        pageCount +
        " page" +
        (pageCount === 1 ? "" : "s") +
        " · " +
        formatBytes(file.size) +
        "</p>";
      await renderCurrentPage();
      updateToolbar();
      renderPageList();
      setStatus(
        "Draw black rectangles over secrets, then export. Free = page 1 + watermark."
      );
    } catch (err) {
      console.error(err);
      alert("Could not open that PDF. Try another file.");
      setStatus("Failed to load PDF.");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function renderCurrentPage() {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    pageSizeCache[currentPage] = { width: viewport.width, height: viewport.height };

    els.pageCanvas.width = viewport.width;
    els.pageCanvas.height = viewport.height;
    els.drawCanvas.width = viewport.width;
    els.drawCanvas.height = viewport.height;

    // Match display size: let CSS max constrain; keep overlay aligned
    syncOverlayPosition();

    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: pageCtx, viewport: viewport }).promise;

    redrawOverlay();
    updateToolbar();
  }

  function syncOverlayPosition() {
    // Place drawCanvas exactly over pageCanvas inside the wrap
    const wrap = els.canvasWrap;
    const page = els.pageCanvas;
    const draw = els.drawCanvas;
    // Use a stacking approach: wrap becomes relative sized to page's layout box
    wrap.style.position = "relative";
    wrap.style.display = "inline-block";
    wrap.style.margin = "0.75rem auto";
    wrap.style.alignSelf = "center";

    // Reset absolute positioning from CSS for precise overlay
    draw.style.position = "absolute";
    draw.style.left = "0";
    draw.style.top = "0";
    draw.style.transform = "none";
    draw.style.width = page.clientWidth + "px";
    draw.style.height = page.clientHeight + "px";
    draw.style.maxWidth = "none";
    draw.style.maxHeight = "none";
  }

  function redrawOverlay() {
    const w = els.drawCanvas.width;
    const h = els.drawCanvas.height;
    drawCtx.clearRect(0, 0, w, h);
    const rects = redactions[currentPage] || [];
    drawCtx.fillStyle = "#000000";
    rects.forEach(function (r) {
      drawCtx.fillRect(r.x, r.y, r.w, r.h);
    });
    if (currentRect) {
      drawCtx.fillStyle = "rgba(0,0,0,0.85)";
      drawCtx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
      drawCtx.strokeStyle = "#ff6b4a";
      drawCtx.lineWidth = 2;
      drawCtx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
    }
  }

  function canvasPoint(e) {
    const rect = els.drawCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const sx = els.drawCanvas.width / rect.width;
    const sy = els.drawCanvas.height / rect.height;
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  }

  function normalizeRect(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    return { x: x, y: y, w: w, h: h };
  }

  function onPointerDown(e) {
    if (!pdfDoc || exporting) return;
    e.preventDefault();
    drawing = true;
    dragStart = canvasPoint(e);
    currentRect = null;
  }

  function onPointerMove(e) {
    if (!drawing || !dragStart) return;
    e.preventDefault();
    currentRect = normalizeRect(dragStart, canvasPoint(e));
    redrawOverlay();
  }

  function onPointerUp(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    if (currentRect && currentRect.w > 4 && currentRect.h > 4) {
      if (!redactions[currentPage]) redactions[currentPage] = [];
      redactions[currentPage].push(currentRect);
    }
    currentRect = null;
    dragStart = null;
    redrawOverlay();
    updateToolbar();
    renderPageList();
  }

  async function goToPage(n) {
    if (!pdfDoc) return;
    n = Math.max(1, Math.min(pageCount, n));
    if (!unlocked && n > 1) {
      openModal();
      setStatus("Free tier edits page 1 only. Unlock for all pages.");
      // Still allow viewing other pages but warn — actually allow view+edit for UX,
      // free limit is on export. Viewing all pages is fine.
    }
    currentPage = n;
    await renderCurrentPage();
    renderPageList();
  }

  function undo() {
    const list = redactions[currentPage];
    if (!list || !list.length) return;
    list.pop();
    redrawOverlay();
    updateToolbar();
    renderPageList();
  }

  function clearPage() {
    redactions[currentPage] = [];
    redrawOverlay();
    updateToolbar();
    renderPageList();
  }

  function resetAll() {
    pdfDoc = null;
    pdfBytes = null;
    pageCount = 0;
    currentPage = 1;
    redactions = {};
    pageSizeCache = {};
    els.viewer.hidden = true;
    els.dropEmpty.hidden = false;
    els.docMeta.innerHTML = '<p class="preview-meta">No PDF loaded</p>';
    els.pageList.innerHTML = "";
    els.fileInput.value = "";
    updateToolbar();
    setStatus("Processed on-device. Pages become images with black burned in — no peelable text layer.");
  }

  function burnOntoCanvas(baseCanvas, rects, withWatermark) {
    const c = document.createElement("canvas");
    c.width = baseCanvas.width;
    c.height = baseCanvas.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.fillStyle = "#000000";
    (rects || []).forEach(function (r) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    });
    if (withWatermark) {
      ctx.save();
      ctx.font = "bold " + Math.max(18, Math.floor(c.width / 28)) + "px sans-serif";
      ctx.fillStyle = "rgba(255,107,74,0.55)";
      ctx.textAlign = "center";
      ctx.translate(c.width / 2, c.height - Math.max(24, c.height * 0.04));
      ctx.fillText("DocBurn — unlock $2.99 to remove watermark", 0, 0);
      ctx.restore();
    }
    return c;
  }

  function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("encode failed"));
            return;
          }
          blob.arrayBuffer().then(function (ab) {
            resolve(new Uint8Array(ab));
          }, reject);
        },
        "image/jpeg",
        quality || 0.92
      );
    });
  }

  async function renderPageToBurnCanvas(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const c = document.createElement("canvas");
    c.width = viewport.width;
    c.height = viewport.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return c;
  }

  async function doExport(forcePage1Only) {
    if (!pdfDoc || exporting) return;
    const multiPage = pageCount > 1;
    const page1Only = forcePage1Only || !unlocked;

    if (!unlocked && multiPage && forcePage1Only === undefined) {
      openNag();
      return;
    }

    exporting = true;
    updateToolbar();
    setStatus("Burning redactions into pages…");

    try {
      const PDFDocument = PDFLib.PDFDocument;
      const out = await PDFDocument.create();
      // Strip metadata: leave blank / minimal
      out.setTitle("Redacted");
      out.setProducer("DocBurn");
      out.setCreator("DocBurn");

      const start = 1;
      const end = page1Only ? 1 : pageCount;

      for (let i = start; i <= end; i++) {
        setStatus("Burning page " + i + " / " + end + "…");
        const base = await renderPageToBurnCanvas(i);
        const burned = burnOntoCanvas(base, redactions[i] || [], !unlocked);
        const jpg = await canvasToJpegBytes(burned, 0.92);
        const img = await out.embedJpg(jpg);
        // PDF points: use 72dpi equivalent of canvas at RENDER_SCALE
        const wPt = burned.width / RENDER_SCALE;
        const hPt = burned.height / RENDER_SCALE;
        const page = out.addPage([wPt, hPt]);
        page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
      }

      const bytes = await out.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = sourceName;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1500);
      setStatus(
        page1Only && pageCount > 1
          ? "Exported page 1 (free). Unlock for all pages without watermark."
          : "Export complete — redactions burned into page pixels."
      );
    } catch (err) {
      console.error(err);
      alert("Export failed. Try a smaller PDF or reload.");
      setStatus("Export failed.");
    } finally {
      exporting = false;
      updateToolbar();
    }
  }

  /* ——— Events ——— */

  els.pickBtn.addEventListener("click", function () {
    els.fileInput.click();
  });
  els.fileInput.addEventListener("change", function () {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (f) loadFile(f);
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  });
  els.dropZone.addEventListener("drop", function (e) {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  els.drawCanvas.addEventListener("mousedown", onPointerDown);
  els.drawCanvas.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  els.drawCanvas.addEventListener("touchstart", onPointerDown, { passive: false });
  els.drawCanvas.addEventListener("touchmove", onPointerMove, { passive: false });
  els.drawCanvas.addEventListener("touchend", onPointerUp, { passive: false });

  window.addEventListener("resize", function () {
    if (pdfDoc) syncOverlayPosition();
  });

  els.prevPage.addEventListener("click", function () {
    goToPage(currentPage - 1);
  });
  els.nextPage.addEventListener("click", function () {
    goToPage(currentPage + 1);
  });
  els.undoBtn.addEventListener("click", undo);
  els.clearBtn.addEventListener("click", clearPage);
  els.resetBtn.addEventListener("click", resetAll);
  els.exportBtn.addEventListener("click", function () {
    doExport(undefined);
  });

  els.unlockBtn.addEventListener("click", openModal);
  els.unlockLink.addEventListener("click", openModal);
  els.footerUnlock.addEventListener("click", openModal);
  els.modalClose.addEventListener("click", closeModal);
  els.unlockModal.addEventListener("click", function (e) {
    if (e.target === els.unlockModal) closeModal();
  });
  els.applyKeyBtn.addEventListener("click", function () {
    tryUnlock(els.licenseKey && els.licenseKey.value);
  });
  els.licenseKey.addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryUnlock(els.licenseKey.value);
  });
  els.demoUnlockBtn.addEventListener("click", function () {
    tryUnlock(DEMO_KEY);
  });

  els.nagClose.addEventListener("click", closeNag);
  els.nagDismiss.addEventListener("click", function () {
    closeNag();
    doExport(true);
  });
  els.nagUnlockBtn.addEventListener("click", function () {
    closeNag();
    openModal();
  });
  els.nagModal.addEventListener("click", function (e) {
    if (e.target === els.nagModal) closeNag();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (!els.unlockModal.hidden) closeModal();
      if (!els.nagModal.hidden) closeNag();
    }
  });

  /* Clear legacy honor unlock ("1") only — keep seed + Gumroad-verified keys */
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === "1") {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SOURCE_KEY);
    }
  } catch (_) {}

  updateUI();
  updateCheckoutLink();
})();
