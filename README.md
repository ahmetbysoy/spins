# SPINS — Futures Scanner

SPINS, Binance vadeli piyasaları için geliştirilmiş, ileri düzey orderflow ve desen analizi yapan, Next.js 15 tabanlı bir orderflow terminalidir.

## Özellikler

- **Gelişmiş Analiz:** MA cross, SAR flip, Wilson lower bound ve rejim istatistikleri.
- **Orderflow:** CVD, OBI, whale trade, sweep, absorption ve spoof dedektörü.
- **Likidite:** Canlı likidite heatmap ve DOM ladder.
- **Pattern Motoru:** 48'lik desen taksonomisi ile 1m/5m periyotlarda otomatik sinyal üretimi.

## Gereksinimler

- Node.js 18+
- Binance API Key (vadeli işlemler yetkili)

## Kurulum

1. `npm install`
2. `.env` dosyasını yapılandırın (Binance API ayarları).
3. `npm run dev`

> [!CAUTION]
> **Geo-block Uyarısı:** Binance API, bazı bölgelerden gelen isteklere 451 (Unavailable For Legal Reasons) hatası döndürebilir. Uygulamayı deploy ederken `europe-west` gibi Binance'e erişimi olan bölgeleri seçin.
