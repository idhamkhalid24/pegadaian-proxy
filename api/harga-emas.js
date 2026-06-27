export default async function handler(req, res) {
  // Biar aplikasi dari GitHub Pages / APK WebView boleh ambil data
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

  try {
    // FIX: ambil langsung dari halaman resmi Pegadaian, bukan endpoint community.
    // Parser dipaksa baca kotak utama "Beli Emas" dan "Jual Emas",
    // bukan angka grafik/riwayat yang tanggalnya bisa berbeda.
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
      sumber: "Pegadaian Tring",
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
    // LAPIS 2: kalau scraping pegadaian.co.id gagal (blocked/berubah struktur),
    // coba sumber live alternatif dulu sebelum jatuh ke angka manual statis.
    try {
      const altResult = await fetchFromAlternativeSource();
      if (altResult) {
        return res.status(200).json({
          success: true,
          sumber: altResult.sumber,
          source_url: sourceUrl,
          beli_001: altResult.beli_001,
          jual_001: altResult.jual_001,
          beli_per_gram: altResult.beli_per_gram,
          jual_per_gram: altResult.jual_per_gram,
          berat: altResult.berat,
          satuan: altResult.satuan,
          tanggal: altResult.tanggal,
          timestamp: new Date().toISOString(),
          note: `Scrape utama gagal (${err.message}), pakai sumber alternatif live.`
        });
      }
    } catch (altErr) {
      // lanjut ke fallback manual di bawah
    }

    // LAPIS 3: Cadangan manual supaya aplikasi tidak blank kalau semua sumber live gagal.
    // Angka ini disamakan dengan kotak utama Pegadaian di screenshot:
    // Beli Emas Rp 25.720 / 0,01 gr dan Jual Emas Rp 24.690 / 0,01 gr.
    return res.status(200).json({
      success: false,
      message: err.message,
      sumber: "Pegadaian Tring - fallback manual",
      source_url: sourceUrl,
      fallback: {
        beli_001: 25720,
        jual_001: 24690,
        beli_per_gram: 2572000,
        jual_per_gram: 2469000,
        berat: 0.01,
        satuan: "gram",
        sumber: "Pegadaian Tring - fallback manual"
      },
      timestamp: new Date().toISOString()
    });
  }
}

async function fetchFromAlternativeSource() {
  const response = await fetch(
    "https://logam-mulia-api.iamutaki.workers.dev/api/prices/pegadaian",
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) return null;

  const json = await response.json();
  const item = json?.data?.[0];
  if (!item) return null;

  const berat = Number(item.weight || 0.01);
  const beli001 = Number(item.sellPrice || 0);
  const jual001 = Number(item.buybackPrice || 0);
  if (!(beli001 > 0)) return null;

  return {
    sumber: "Pegadaian (sumber alternatif live)",
    beli_001: beli001,
    jual_001: jual001,
    beli_per_gram: berat > 0 ? Math.round(beli001 / berat) : beli001 * 100,
    jual_per_gram: berat > 0 ? Math.round(jual001 / berat) : jual001 * 100,
    berat: berat,
    satuan: item.weightUnit || "gram",
    tanggal: item.recordedDate || json.timestamp || null
  };
}

function parsePegadaianHargaUtama(html) {
  const decoded = decodeHtmlEntities(String(html || ""));

  // Gabungkan versi raw + versi text supaya aman untuk HTML biasa, JSON hydration,
  // atau data yang masih ada tag/class di antaranya.
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

  // Yang dipakai hanya area sebelum grafik, karena grafik bisa berisi angka tanggal lama.
  const mainArea = cutBeforeGrafik(searchable);

  const beli001 = extractHargaByLabel(mainArea, "Beli Emas");
  const jual001 = extractHargaByLabel(mainArea, "Jual Emas");
  const tanggal = extractTanggal(mainArea) || extractTanggal(searchable);

  if (!isValidHarga001(beli001)) {
    return null;
  }

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
    // Beli Emas ... Rp 25.720 / 0,01 gr
    new RegExp(`${safeLabel}[\\s\\S]{0,900}?Rp\\s*([0-9][0-9.\\s,]{3,})\\s*(?:/|per)\\s*0[,.]01\\s*gr`, "i"),
    // Beli Emas ... Rp25.720
    new RegExp(`${safeLabel}[\\s\\S]{0,500}?Rp\\s*([0-9][0-9.\\s,]{3,})`, "i"),
    // JSON/hydration kemungkinan: "Beli Emas" ... "price":"25.720"
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

  const raw = String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, "")
    .replace(/[^0-9.,]/g, "");

  if (!raw) return 0;

  // Format Indonesia: 25.720 atau 25,720 untuk nilai 0,01 gr.
  const cleaned = raw.replace(/[.,]/g, "");
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : 0;
}

function isValidHarga001(value) {
  // Harga 0,01 gram Pegadaian normalnya puluhan ribu, bukan jutaan dan bukan nol.
  return Number.isFinite(value) && value >= 10000 && value <= 50000;
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
