# SPINS — Futures Scanner

SPINS, Binance vadeli piyasaları için geliştirilmiş, ileri düzey orderflow ve desen analizi yapan, Next.js 15 tabanlı bir orderflow terminalidir.

## Özellikler

- **Gelişmiş Analiz:** MA cross, SAR flip, Wilson lower bound ve rejim istatistikleri.
- **Orderflow:** CVD, OBI, whale trade, sweep, absorption ve spoof dedektörü.
- **Likidite:** Canlı likidite heatmap ve DOM ladder.
- **Pattern Motoru:** 48'lik desen taksonomisi ile 1m/5m periyotlarda otomatik sinyal üretimi.
- **AI Yorum (opsiyonel):** Sinyal anında Gemini destekli Türkçe piyasa yorumu; anahtar yoksa yerel esprili fallback havuzu.
- **Desen Radarı:** Favoriler + top hacimli coinleri 1m/5m'de arka planda tarayan çoklu sembol tarayıcı (toast + ses + sinyal logu).
- **Robustluk:** Sinyal logu IndexedDB'de kalıcı, tarayıcı bildirimleri (sinyal/radar/whale/likidasyon), error boundary ve temalı yükleme ekranı.

## Gereksinimler

- Node.js 18+
- Binance API key gerekmez, tüm veriler public endpoint'lerden gelir.
- (Opsiyonel) `GEMINI_API_KEY` — AI yorum katmanı için. Tanımsızsa uygulama fallback ile sorunsuz çalışır.

## Kurulum

1. `npm install`
2. `npm run dev`

### Test & Build

```bash
npm test        # vitest (indicators, pattern engine, proxy allowlist, AI yorum katmanı)
npm run lint    # eslint
npm run build   # production build
```

### AI Yorum Katmanı (opsiyonel)

Sinyal ateşlendiğinde karar motoru + orderflow anlık görüntüsü `POST /api/ai/commentary` üzerinden
sunucu tarafında Gemini'a gönderilir; yanıt 2 cümlelik Türkçe yorum olarak arayüzde fallback'in
yerini alır. Davranış:

- `GEMINI_API_KEY` tanımsızsa endpoint `available: false` döner, istemci yerel fallback havuzunu kullanır.
- İstemci tarafında 45s cooldown + 5dk sinyal önbelleği, sunucu tarafında IP başına 20 istek/dk limit ve 8s upstream timeout vardır.
- Herhangi bir hata durumunda sesssizce fallback'e dönülür; sinyal akışı asla bloklanmaz.

### Desen Radarı (arka plan tarayıcı)

Tarayıcı görünümünün en üstündeki radar kartı, favorilerin + top hacimli USDT-M perpetual'ları
(ayarlardan `scanTopN`, varsayılan 10) 1m ve 5m periyotlarda arka planda tarar:

- Birincil kurgu (MA1×MA2 cross + SAR onayı) doğrudan bildirilir; ikincil çiftler yalnızca desen havuzu onaylıysa (n ≥ 15, Wilson ≥ %50) bildirilir.
- İlk tur sessiz baseline'dır (açılışta eski kurgular için spam yok); ardından yeni kurgular toast + ses + sinyal loguna `RADAR` etiketiyle düşer.
- Sekme gizliyken istek atılmaz; semboller arası throttle ile Binance limitleri korunur. Aynı desen için 30 dk bildirim cooldown'u vardır.
- Radar sinyalleri grafik (Katman 1) kurgusudur; orderflow teyidi (Katman 2) yalnızca seçili sembolde çalışır.

> [!CAUTION]
> **Geo-block Uyarısı:** Binance API, bazı bölgelerden gelen isteklere 451 (Unavailable For Legal Reasons) hatası döndürebilir. Uygulamayı deploy ederken `europe-west` gibi Binance'e erişimi olan bölgeleri seçin.

## Yol Haritası & Durum

| Faz | Özellik | Durum |
|-----|---------|-------|
| P1 | Çekirdek terminal: WS market+depth, CVD/OBI, heatmap, DOM ladder, pattern motoru (48 desen) | ✅ |
| P1.5 | Desen event'lerinin grafik overlay'i (giriş→MFE/MAE) | ✅ |
| P2 | AI yorum katmanı (Gemini, server-side + fallback), WS reconnect storm fix | ✅ |
| P2.1 | Desen Radarı: favoriler + top hacim çoklu sembol arka plan tarayıcı | ✅ |
| P2.2 | Robustluk: kalıcı sinyal logu, tarayıcı bildirimleri, error boundary, loading UI | ✅ |
| P3 | `page.tsx` hook'lara ayrıştırma, saf flow dedektörleri (test kapsamı) | ✅ (dedektörler); UI hook ayrıştırma sürüyor |
| P4 (fikir) | Geçmiş test (backtest) paneli, çoklu düzen kaydırma, Telegram bridge | 💡 |

## Lisans

MIT — bkz. [LICENSE](./LICENSE).
