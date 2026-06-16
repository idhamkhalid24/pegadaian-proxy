export default async function handler(req, res) {
  // Biar aplikasi dari GitHub Pages / APK WebView boleh ambil data
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // Sumber Pegadaian via API publik community.
    // Nanti kalau sudah ketemu endpoint internal resmi Pegadaian,
    // bagian URL ini saja yang diganti.
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
      throw new Error("Gagal ambil harga emas");
    }

    const json = await response.json();
    const item = json?.data?.[0];

    if (!item) {
      throw new Error("Data harga kosong");
    }

    const berat = Number(item.weight || 0.01);
    const beli001 = Number(item.sellPrice || 0);
    const jual001 = Number(item.buybackPrice || 0);

    return res.status(200).json({
      success: true,
      sumber: "Pegadaian",
      beli_001: beli001,
      jual_001: jual001,
      beli_per_gram: Math.round(beli001 / berat),
      jual_per_gram: Math.round(jual001 / berat),
      berat: berat,
      satuan: item.weightUnit || "gram",
      tanggal: item.recordedDate || null,
      timestamp: json.timestamp || new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      fallback: {
        beli_001: 26330,
        jual_001: 25270,
        beli_per_gram: 2633000,
        jual_per_gram: 2527000,
        sumber: "Manual fallback"
      }
    });
  }
}
