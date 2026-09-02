# Dopamin Tetikleyiciler — UI Serisi

Kullanıcı serisi: "PARA BASACAK DOKUNUŞLAR". Her madde uygulandıkça işaretlenir.

## 1. ✅ Sinyal Animasyonları — glow-up/glow-down (2026-09-02)
Yeni AL/SAT sinyalinde (mount/restore hariç — `lastTopSignalIdRef` guard):
- **Halo halkası**: sinyal barının piksel konumunda `fs-signal-ring` (1.5sn,
  0.35→2.6 ölçek + glow, AL=#22c55e / SAT=#ef4444), 1.6sn sonra kendini temizler
- **Kenar flaşı**: `fs-edge-flash` üst+alt kenar gradyanı (0.9sn, 0.55→0 opaklık)
- CSS keyframe (GPU, canvas loop'a dokunmaz) + `prefers-reduced-motion` saygısı
- Konum: `timeToCoordinate(ts)` + `priceToCoordinate(price)`; haptic/ses zaten vardı —
  görsel üçüncü bacak tamam

## 2. ✅ Price Line Flash (2026-09-02)
Son fiyat **anlamlı oynamada** (≥1bp — her tick değil, strobe değil) fiyat çizgisi
yönlü renkte 0.3s parlar (yeşil yukarı / kırmızı aşağı, glow'lu); alpha zamanla
söner, sönme karesi için kendiliğinden redraw planlanır. Canvas'ta (`priceFlashRef`),
ladder kapalıyken de çalışır (domOverlay canvas'ı artık her zaman çizilir).

## 3. ✅ Volume Spike Highlight (2026-09-02)
`lib/volume-spike.ts` (saf + 3 test): bar, önündeki ≤20 barın ortalamasının **3x**'ini
aşıyorsa `#fbbf24` altın (0.55 alpha); yön rengini ezer — whale activity tek bakışta.
Açılış barları (≥5 örnek yok) muaf. Batch setData + canlı update yollarının ikisi bağlı.

## 4. ✅ Pattern Overlay Glow (2026-9-02)
Overlay aktifken giriş barından 20 barlık sonuç penceresine yumuşak yeşil bant
(`rgba(34,197,94,0.08)`); **yeni tespitte 1.2sn boyunca 0.26'ya kadar parlayıp söner**
("buldum" hissi). Son 3 event, TF eşleşenler; ladder dışında da çalışır.

## 5. ✅ Real-time Pulse (2026-09-02)
Header'da (MINI anahtarının yanında) canlı nabız: WS açık = yeşil nokta +
dalga (`fs-live-dot`, 1.6s döngü) + "CANLI"; REST düşüş modunda amber "REST";
kopmuşta kırmızı "OFFLINE". `prefers-reduced-motion` saygılı.

## Beyin fırtınası — ek öneriler (sıra sende)
- **Öz-skor chip pop**: 3/5/7/15dk ✓/✗ sonucu yazıldığında chip'in küçük
  scale-pop animasyonu (OrderFlowLog satırında)
- **Wall ₺pulse**: duvar yerleşik (30s+) olduğunda etikette tek seferlik altın flash
- **Radar hit satır flaşı**: PatternRadar listesinde yeni satır 1s highlight
- **Streak sayacı**: üst üste isabetli öz-skor chip'leri → "🔥 3/3" rozeti
- **Ses paketleri**: whale/sweep/liq için ayrı kısa sesler (şu an tek ses)
