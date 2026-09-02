# Zaman Ekseni (Time Scale) — Beyin Fırtınası ve Rötuşlar

> Soru: `secondsVisible: false` 1m/5m'de bilgi kaybı mı?
> Cevap: **Eksen etiketlerinde hayır, ama saniye ihtiyacı gerçek — doğru yerde verilmeli.**

## Neden eksen etiketlerinde saniye = gürültü?
TF seti `1m/5m/15m/1h/4h` — hepsi dakika hizalı. Her bar `:00` saniyesinde açılır;
eksende saniye göstermek "14:05:00, 14:10:00, …" üretir; `:00` sabittir, sıfır bilgi,
%30 daha uzun etiketler. TradingView de 1m'de "14:05" gösterir. **Karar: eksende
saniye yok (kalıyor), saniyelik ihtiyaç aşağıdaki üç doğru yerde karşılanıyor.**

## Saniyelik bilginin gerçek adresleri (uygulananlar ✅)
1. **Mum kapanış geri sayımı** (en çok istenen saniye bilgisi bu): sağ altta `⏱ 4:32`
   rozeti, son 10sn'de amber. 1m scalp'te "bu mum daha kaç saniye yaşayacak" =
   giriş penceresi. `sonBar.time + tfSec` hesabıyla 1sn tick.
2. **Crosshair OHLC+Zaman okuma satırı** (spins'te hiç yoktu!): imleç hangi mumdaysa
   sol üstte `2 Eyl 14:05 · O 117.23 H 117.40 L 117.10 C 117.31 (+0.34%) · V 1.2K`.
   İmleç yoksa son mumu gösterir. Artık hover'da hangi bara baktığın + mum istatistikleri tek bakışta.
3. **Crosshair zaman etiketi Türkçe**: `localization.timeFormatter` → "2 Eyl 14:05"
   (default en-US "Sep 2, 14:05" idi).

## Eksen etiketleri (uygulanan ✅)
4. **tickMarkFormatter + tr-TR**: gün sınırı etiketleri "2 Eyl", ay "Eyl",
   yıl rakam, saat dilimleri "14:05" — tüm eksen Türkçe (fiyat ekseni dokunulmadı:
   `locale` global set edilirse ondalık virgüle döner, karışıklık olur; sadece
   zaman formatlayıcılar özelleştirildi).

## Değerlendirilen, yapılmayanlar (gerekçeli)
- **Eksen saniyeleri (secondsVisible:true)**: yukarıda — gürültü.
- **Gün ayrım dikey çizgileri**: 4h'da faydalı olurdu ama lightweight-charts'ta
  custom grid yok; tick etiketinin "2 Eyl" olması yeterli ayırt edicilik.
- **Mini kartlara zaman ekseni**: kart felsefesi "sadece şekil"; scale zaten kapalı.
- **Oturum/hafta sonu boyaması**: kripto 7/24, anlamsız.
