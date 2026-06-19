export default async function handler(req, res) {
  // Biar aplikasi dari GitHub Pages / APK WebView boleh ambil data
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const sourceUrl = "https://pegadaian.co.id/harga-emas";

  try {
    // Sumber harga tetap Pegadaian. Endpoint community ini hanya dipakai sebagai jembatan JSON
    // karena halaman Pegadaian sering tidak bisa dibaca langsung dari APK/WebView akibat CORS.
    const response = await fetch(
      "https://logam-mulia-api.iamutaki.workers.dev/api/prices/pegadaian",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error("Gagal ambil harga emas Pegadaian");
    }

    const json = await response.json();
    const item = json?.data?.[0];

    if (!item) {
      throw new Error("Data harga Pegadaian kosong");
    }

    const berat = Number(item.weight || 0.01);
    const beli001 = Number(item.sellPrice || 0);
    const jual001 = Number(item.buybackPrice || 0);

    // Ini fix utamanya: endpoint bisa sukses tapi harga 0, jadi jangan dianggap valid.
    // Kalau dibiarkan, aplikasi membaca format tidak cocok dan card tetap kosong.
    if (!berat || beli001 <= 0) {
      throw new Error("Harga Pegadaian dari endpoint masih 0 / belum valid");
    }

    return res.status(200).json({
      success: true,
      sumber: "Pegadaian Tring",
      source_url: sourceUrl,
      beli_001: beli001,
      jual_001: jual001,
      beli_per_gram: Math.round(beli001 / berat),
      jual_per_gram: jual001 > 0 ? Math.round(jual001 / berat) : 0,
      berat: berat,
      satuan: item.weightUnit || "gram",
      tanggal: item.recordedDate || null,
      timestamp: json.timestamp || new Date().toISOString()
    });
  } catch (err) {
    // Cadangan manual hanya supaya aplikasi tidak blank saat endpoint Pegadaian mengirim 0.
    // Ubah nilai di bawah sesuai harga Tring yang kamu lihat di aplikasi Pegadaian.
    return res.status(200).json({
      success: false,
      message: err.message,
      sumber: "Pegadaian Tring - fallback manual",
      source_url: sourceUrl,
      fallback: {
        beli_001: 26330,
        jual_001: 25270,
        beli_per_gram: 2633000,
        jual_per_gram: 2527000,
        sumber: "Pegadaian Tring - fallback manual"
      },
      timestamp: new Date().toISOString()
    });
  }
}
