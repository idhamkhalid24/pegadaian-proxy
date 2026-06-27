export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const sourceUrl = "https://pegadaian.co.id/harga-emas";

  // LAPIS 1: Scrape langsung dari pegadaian.co.id
  try {
    const response = await fetch(`${sourceUrl}?_=${Date.now()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    });

    if (!response.ok) {
      throw new Error(`Gagal ambil halaman Pegadaian (${response.status})`);
    }

    const html = await response.text();
    const parsed = parsePegadaianHargaUtama(html);

    if (!parsed?.beli_001) {
      throw new Error("Harga utama Beli Emas tidak ditemukan di halaman Pegadaian");
    }

    return res.status(200).json({
      success: true,
      sumber: "Pegadaian (live)",
      source_url: sourceUrl,
      beli_001: parsed.beli_001,
      jual_001: parsed.jual_001 || 0,
      beli_per_gram: parsed.beli_001 * 100,
      jual_per_gram: parsed.jual_001 ? parsed.jual_001 * 100 : 0,
      berat: 0.01,
      satuan: "gram",
      tanggal: parsed.tanggal || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {

    // LAPIS 2A: harga-emas.org — scrape tabel harga Galeri24
    try {
      const alt1 = await fetchFromHargaEmasOrg();
      if (alt1) {
        return res.status(200).json({
          success: true,
          sumber: "Galeri24 Pegadaian (harga-emas.org)",
          source_url: sourceUrl,
          beli_001: alt1.beli_001,
          jual_001: alt1.jual_001,
          beli_per_gram: alt1.beli_per_gram,
          jual_per_gram: alt1.jual_per_gram,
          berat: 0.01,
          satuan: "gram",
          tanggal: alt1.tanggal || null,
          timestamp: new Date().toISOString(),
          note: `Scrape utama gagal (${err.message}), pakai harga-emas.org.`
        });
      }
    } catch (_) {}

    // LAPIS 2B: logam-mulia-api — endpoint pegadaian
    try {
      const alt2 = await fetchFromLogamMuliaApi();
      if (alt2) {
        return res.status(200).json({
          success: true,
          sumber: "Pegadaian (logam-mulia-api)",
          source_url: sourceUrl,
          beli_001: alt2.beli_001,
          jual_001: alt2.jual_001,
          beli_per_gram: alt2.beli_per_gram,
          jual_per_gram: alt2.jual_per_gram,
          berat: 0.01,
          satuan: "gram",
          tanggal: alt2.tanggal || null,
          timestamp: new Date().toISOString(),
          note: `Scrape utama gagal (${err.message}), pakai logam-mulia-api.`
        });
      }
    } catch (_) {}

    // LAPIS 3: Fallback manual — diupdate ke harga Galeri24 terkini (28 Juni 2026)
    // Galeri24 1gr = Rp 2.638.000 → per 0,01gr = 26.380
    // Jual balik (estimasi ~4% di bawah beli): ~25.300
    return res.status(200).json({
      success: false,
      message: err.message,
      sumber: "Galeri24 Pegadaian - fallback manual",
      source_url: sourceUrl,
      fallback: {
        beli_001: 26380,
        jual_001: 25300,
        beli_per_gram: 2638000,
        jual_per_gram: 2530000,
        berat: 0.01,
        satuan: "gram",
        sumber: "Galeri24 Pegadaian - fallback manual"
      },
      beli_001: 26380,
      jual_001: 25300,
      beli_per_gram: 2638000,
      jual_per_gram: 2530000,
      berat: 0.01,
      satuan: "gram",
      timestamp: new Date().toISOString()
    });
  }
}

// --- SUMBER ALTERNATIF 2A: harga-emas.org ---
async function fetchFromHargaEmasOrg() {
  const response = await fetch("https://harga-emas.org/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
      "Accept-Language": "id-ID,id;q=0.9"
    }
  });

  if (!response.ok) return null;
  const html = await response.text();

  // Cari harga Galeri24 per gram dari tabel harga
  // Format: "Galeri 24" ... "Rp X.XXX.XXX"
  const patterns = [
    /Galeri\s*24[\s\S]{0,300}?Rp\s*([\d.,]+)/i,
    /galeri24[\s\S]{0,300}?Rp\s*([\d.,]+)/i,
    /Galeri[\s\S]{0,50}?24[\s\S]{0,200}?([\d]{1,3}(?:[.,][\d]{3})+)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const hargaPerGram = parseRupiah(match[1]);
    if (hargaPerGram >= 2000000 && hargaPerGram <= 5000000) {
      const beli001 = Math.round(hargaPerGram / 100);
      return {
        beli_001: beli001,
        jual_001: Math.round(beli001 * 0.96),
        beli_per_gram: hargaPerGram,
        jual_per_gram: Math.round(hargaPerGram * 0.96),
        tanggal: null
      };
    }
  }
  return null;
}

// --- SUMBER ALTERNATIF 2B: logam-mulia-api ---
async function fetchFromLogamMuliaApi() {
  const response = await fetch(
    "https://logam-mulia-api.vercel.app/prices/pegadaian",
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) return null;
  const json = await response.json();
  const item = Array.isArray(json?.data) ? json.data[0] : null;
  if (!item) return null;

  const buy = Number(item.buy || item.sellPrice || 0);
  const sel = Number(item.sel || item.buybackPrice || 0);
  if (!(buy > 0)) return null;

  const isPerHundredthGram = buy >= 10000 && buy <= 60000;

  return {
    sumber: "Pegadaian (logam-mulia-api)",
    beli_001: isPerHundredthGram ? Math.round(buy) : Math.round(buy / 100),
    jual_001: isPerHundredthGram ? Math.round(sel) : Math.round(sel / 100),
    beli_per_gram: isPerHundredthGram ? Math.round(buy * 100) : Math.round(buy),
    jual_per_gram: isPerHundredthGram ? Math.round(sel * 100) : Math.round(sel),
    berat: 0.01,
    satuan: "gram",
    tanggal: item.recordedDate || item.date || json.timestamp || null
  };
}

// --- PARSER PEGADAIAN UTAMA ---
function parsePegadaianHargaUtama(html) {
  const decoded = decodeHtmlEntities(String(html || ""));
  const textOnly = decoded
    .replace(/<script\b[^>]*>/gi, " <script> ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const searchable = `${decoded}\n${textOnly}`
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ");

  const mainArea = cutBeforeGrafik(searchable);
  const beli001 = extractHargaByLabel(mainArea, "Beli Emas");
  const jual001 = extractHargaByLabel(mainArea, "Jual Emas");
  const tanggal = extractTanggal(mainArea) || extractTanggal(searchable);

  if (!isValidHarga001(beli001)) return null;

  return {
    beli_001: beli001,
    jual_001: isValidHarga001(jual001) ? jual001 : 0,
    tanggal
  };
}

function cutBeforeGrafik(text) {
  const idx = text.search(/Grafik\s+Harga\s+Emas\s+Pegadaian/i);
  if (idx > -1) return text.slice(0, idx);
  return text;
}

function extractHargaByLabel(text, label) {
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${safeLabel}[\\s\\S]{0,900}?Rp\\s*([0-9][0-9.\\s,]{3,})\\s*(?:/|per)\\s*0[,.]01\\s*gr`, "i"),
    new RegExp(`${safeLabel}[\\s\\S]{0,500}?Rp\\s*([0-9][0-9.\\s,]{3,})`, "i"),
    new RegExp(`${safeLabel}[\\s\\S]{0,700}?(?:price|harga|value|amount)["'\\s:=]+Rp?\\s*([0-9][0-9.\\s,]{3,})`, "i")
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const harga = parseRupiah(match[1]);
    if (isValidHarga001(harga)) return harga;
  }
  return 0;
}

function parseRupiah(value) {
  if (value == null) return 0;
  const raw = String(value).replace(/&nbsp;/gi, " ").replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
  if (!raw) return 0;
  const cleaned = raw.replace(/[.,]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function isValidHarga001(value) {
  return Number.isFinite(value) && value >= 10000 && value <= 60000;
}

function extractTanggal(text) {
  const patterns = [
    /Diperbarui\s+([0-9]{1,2}\s+[A-Za-zÀ-ÿ]+\s+[0-9]{4})/i,
    /Update\s+(?:[A-Za-zÀ-ÿ]+,\s*)?([0-9]{1,2}\s+[A-Za-zÀ-ÿ]+\s+[0-9]{4})/i,
    /Harga\s+Emas\s+Hari\s+Ini[\s\S]{0,120}?([0-9]{1,2}\s+[A-Za-zÀ-ÿ]+\s+[0-9]{4})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
