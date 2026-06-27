export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method === "OPTIONS") return res.status(204).end();

  const sourceUrl = "https://pegadaian.co.id/harga-emas";
  const errors = [];

  // ─── LAPIS 1: Scrape langsung pegadaian.co.id ───────────────────────────────
  try {
    const r = await fetch(`${sourceUrl}?_=${Date.now()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9",
        "Cache-Control": "no-cache"
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const parsed = parsePegadaianHTML(html);
    if (!parsed?.beli_001) throw new Error("Harga tidak ditemukan di HTML");
    return res.status(200).json(buildResponse(true, "Pegadaian Galeri24 (live)", sourceUrl, parsed.beli_001, parsed.jual_001, parsed.tanggal));
  } catch (e) { errors.push(`L1-Pegadaian: ${e.message}`); }

  // ─── LAPIS 2: iamutaki workers — Galeri24 (URL BARU!) ───────────────────────
  try {
    const r = await fetch("https://logam-mulia-api.iamutaki.workers.dev/api/prices/galeri24", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    // Cari spesifik 1 gram dengan harga > 2jt, bukan 0.5gram atau lainnya
    const item = Array.isArray(json?.data)
      ? json.data.find(d => Number(d.sellPrice || d.buy || 0) > 2000000 && (d.weight === 1 || d.weightUnit === "gr"))
        || json.data.find(d => Number(d.sellPrice || d.buy || 0) > 2000000)
      : null;
    if (!item) throw new Error("Item 1gram tidak ditemukan");
    const buy = Number(item.sellPrice || item.buy || 0);
    if (!(buy > 2000000)) throw new Error(`Harga tidak valid: ${buy}`);
    const b001 = Math.round(buy / 100);
    const j001 = Math.round(Number(item.buybackPrice || item.sel || buy * 0.93) / 100);
    return res.status(200).json(buildResponse(true, "Galeri24 (iamutaki workers)", sourceUrl, b001, j001, item.recordedDate || null, errors));
  } catch (e) { errors.push(`L2-iamutaki-galeri24: ${e.message}`); }

  // ─── LAPIS 3: iamutaki workers — Antam ──────────────────────────────────────
  try {
    const r = await fetch("https://logam-mulia-api.iamutaki.workers.dev/api/prices/anekalogam", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const item = Array.isArray(json?.data)
      ? json.data.find(d => Number(d.sellPrice || d.buy || 0) > 2000000 && (d.weight === 1 || d.weightUnit === "gr"))
        || json.data.find(d => Number(d.sellPrice || d.buy || 0) > 2000000)
      : null;
    if (!item) throw new Error("Item 1gram tidak ditemukan");
    const buy = Number(item.sellPrice || item.buy || 0);
    if (!(buy > 2000000)) throw new Error(`Harga tidak valid: ${buy}`);
    const b001 = Math.round(buy / 100);
    const j001 = Math.round(Number(item.buybackPrice || item.sel || buy * 0.89) / 100);
    return res.status(200).json(buildResponse(true, "Antam (iamutaki workers)", sourceUrl, b001, j001, item.recordedDate || null, errors));
  } catch (e) { errors.push(`L3-iamutaki-antam: ${e.message}`); }

  // ─── LAPIS 4: harga-emas.org — scrape Galeri24 ──────────────────────────────
  try {
    const r = await fetch(`https://harga-emas.org/?_=${Date.now()}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const harga = scrapeHargaPerGram(html, ["Galeri24", "Galeri 24"]);
    if (!harga) throw new Error("Galeri24 tidak ditemukan");
    const b001 = Math.round(harga / 100);
    return res.status(200).json(buildResponse(true, "Galeri24 (harga-emas.org)", sourceUrl, b001, Math.round(b001 * 0.93), null, errors));
  } catch (e) { errors.push(`L4-hargaemas-galeri24: ${e.message}`); }

  // ─── LAPIS 5: harga-emas.org — scrape Antam ─────────────────────────────────
  try {
    const r = await fetch(`https://harga-emas.org/?_=${Date.now()}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,*/*" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const harga = scrapeHargaPerGram(html, ["Antam", "ANTAM"]);
    if (!harga) throw new Error("Antam tidak ditemukan");
    const b001 = Math.round(harga / 100);
    return res.status(200).json(buildResponse(true, "Antam (harga-emas.org)", sourceUrl, b001, Math.round(b001 * 0.89), null, errors));
  } catch (e) { errors.push(`L5-hargaemas-antam: ${e.message}`); }

  // ─── LAPIS 6: iamutaki workers — endpoint pegadaian (jika ada) ──────────────
  try {
    const r = await fetch("https://logam-mulia-api.iamutaki.workers.dev/api/prices/pegadaian", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const item = Array.isArray(json?.data)
      ? json.data.find(d => Number(d.sellPrice || d.buy || 0) > 2000000)
      : null;
    if (!item) throw new Error("Item 1gram tidak ditemukan");
    const buy = Number(item.sellPrice || item.buy || 0);
    if (!(buy > 2000000)) throw new Error(`Harga tidak valid: ${buy}`);
    const b001 = Math.round(buy / 100);
    const j001 = Math.round(Number(item.buybackPrice || item.sel || buy * 0.93) / 100);
    return res.status(200).json(buildResponse(true, "Pegadaian (iamutaki workers)", sourceUrl, b001, j001, item.recordedDate || null, errors));
  } catch (e) { errors.push(`L6-iamutaki-pegadaian: ${e.message}`); }

  // ─── LAPIS 7: XAU spot + kurs USD/IDR ───────────────────────────────────────
  try {
    const [fxR, goldR] = await Promise.all([
      fetch("https://open.er-api.com/v6/latest/USD"),
      fetch("https://api.metals.live/v1/spot/gold")
    ]);
    if (!fxR.ok) throw new Error("FX gagal");
    if (!goldR.ok) throw new Error("Gold API gagal");
    const fxJson = await fxR.json();
    const goldJson = await goldR.json();
    const usdIdr = fxJson?.rates?.IDR;
    const xauUsd = goldJson?.[0]?.gold || goldJson?.price || goldJson?.gold;
    if (!(usdIdr > 10000)) throw new Error("Kurs tidak valid");
    if (!(xauUsd > 0)) throw new Error("Harga XAU tidak valid");
    // per gram × markup 6% (spread lokal Pegadaian)
    const perGramIdr = Math.round((xauUsd / 31.1035) * usdIdr * 1.06);
    const b001 = Math.round(perGramIdr / 100);
    return res.status(200).json(buildResponse(
      true,
      `Estimasi XAU spot ($${Math.round(xauUsd)}, kurs Rp${Math.round(usdIdr)})`,
      sourceUrl, b001, Math.round(b001 * 0.92), null, errors
    ));
  } catch (e) { errors.push(`L7-XAU/IDR: ${e.message}`); }

  // ─── LAPIS 8: Semua gagal — jangan tampilkan harga ─────────────────────────
  return res.status(503).json({
    success: false,
    harga_tersedia: false,
    sumber: null,
    beli_001: null,
    jual_001: null,
    beli_per_gram: null,
    jual_per_gram: null,
    timestamp: new Date().toISOString(),
    errors,
    message: "Semua sumber harga tidak dapat diakses. Harga tidak ditampilkan."
  });
}

// ─── HELPER: build response standar ─────────────────────────────────────────
function buildResponse(success, sumber, sourceUrl, beli001, jual001, tanggal, errors = []) {
  const resp = {
    success,
    sumber,
    source_url: sourceUrl,
    beli_001: beli001,
    jual_001: jual001 || 0,
    beli_per_gram: beli001 * 100,
    jual_per_gram: (jual001 || 0) * 100,
    berat: 0.01,
    satuan: "gram",
    timestamp: new Date().toISOString()
  };
  if (tanggal) resp.tanggal = tanggal;
  if (errors?.length) resp.errors_sebelumnya = errors;
  return resp;
}

// ─── HELPER: scrape harga per gram dari HTML ─────────────────────────────────
function scrapeHargaPerGram(html, labels) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  for (const label of labels) {
    const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${safeLabel}[\\s\\S]{0,300}?Rp\\s*([\\d.,]+)`, "i"),
      new RegExp(`${safeLabel}[\\s\\S]{0,300}?([\\d]{1,3}(?:[.,][\\d]{3}){2,})`, "i")
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (!m?.[1]) continue;
      const val = parseRupiah(m[1]);
      if (val >= 2000000 && val <= 8000000) return val;
    }
  }
  return 0;
}

// ─── HELPER: parse angka rupiah ──────────────────────────────────────────────
function parseRupiah(value) {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^0-9]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ─── PARSER HTML PEGADAIAN ───────────────────────────────────────────────────
function parsePegadaianHTML(html) {
  const decoded = html
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));

  const text = decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const cutIdx = text.search(/Grafik\s+Harga\s+Emas/i);
  const area = cutIdx > -1 ? text.slice(0, cutIdx) : text;

  const beli001 = extractHarga001(area, "Beli Emas");
  const jual001 = extractHarga001(area, "Jual Emas");
  const tanggal = area.match(/Diperbarui\s+([0-9]{1,2}\s+\w+\s+[0-9]{4})/i)?.[1] || null;

  return beli001 ? { beli_001: beli001, jual_001: jual001 || 0, tanggal } : null;
}

function extractHarga001(text, label) {
  const safe = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    new RegExp(`${safe}[\\s\\S]{0,900}?Rp\\s*([0-9][0-9.,\\s]{3,})\\s*(?:/|per)\\s*0[,.]01`, "i"),
    new RegExp(`${safe}[\\s\\S]{0,500}?Rp\\s*([0-9][0-9.,\\s]{3,})`, "i")
  ];
  for (const pat of pats) {
    const m = text.match(pat);
    if (!m?.[1]) continue;
    const val = parseRupiah(m[1]);
    if (val >= 10000 && val <= 60000) return val;
  }
  return 0;
}
