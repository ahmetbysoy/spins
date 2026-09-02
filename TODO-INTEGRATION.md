# SPINS ← futures-scanner.html (Stage 4) Entegrasyon TODO Promptu

> Aşağıdaki prompt, tek dosyalık `futures-scanner.html` prototipindeki SPINS'te eksik kalan
> özellikleri Next.js 15 reposuna entegre etmek için bir AI kodlama ajanına verilir.
> Repo: `ahmetbysoy/spins` (Next.js 15 + React 19 + Tailwind 4 + lightweight-charts v5 + vitest).
> Referans kaynak: `uploads/futures-scanner.html` (tek dosya, ~2645 satır).

---

## PROMPT (kopyala-yapıştır)

Sen, SPINS (Binance USD-M Futures orderflow terminali, Next.js 15 App Router, TypeScript,
Tailwind 4, lightweight-charts v5, vitest, IndexedDB desen havuzu) reposunda çalışıyorsun.
Görev: tek dosyalık öncül prototip `futures-scanner.html`'den, SPINS'te eksik olan 5 grup
özelliği entegre etmek. Mevcut davranışı BOZMA; her grup ayrı conventional commit olmalı.
Tüm UI metinleri Türkçe ve mevcut mahalle/jargon üslubunda. Mantık `lib/` altında saf
fonksiyonlar olarak yazılmalı ve birim testlerle korunmalı (mevcut konvansiyon:
`lib/*.ts` + `lib/*.test.ts`, vitest `environment: 'node'`).

Mimari bağlam (dosya haritası):
- `app/page.tsx` — tek sayfa orkestrasyonu (~1650 satır): WS client, dedektörler, karar motoru
- `components/ChartTerminal.tsx` — grafik + canvas overlay'ler (heatmap, DOM ladder, duvar ışınları)
- `lib/flow-detectors.ts`, `lib/flow-snapshot.ts` — saf dedektör/snapshot çekirdekleri (testli)
- `lib/pattern-engine.ts` — IndexedDB desen havuzu (DB: `fs_pattern_pool` v2)
- `lib/types.ts` — `AppSettings`, `FlowSnapshot`, `PatternEvent`, `WallRecord` (kullanılmıyor!)
- `components/SettingsModal.tsx`, `components/Navbar.tsx`, `components/PatternRadarCard.tsx`

---

### GÖREV A — Aydınlık Tema'yı Bitir (Öncelik: YÜKSEK)

> **DURUM: KAPANDI (2026-09-02).** Karar: light tema **kaldırma** yönünde alındı — ölü
> `html.light` CSS blokları ve `AppSettings.dark` alanı temizlendi. Bileşenler sabit hex
> kullandığı için yarım tema görüntüsü kabul edilmedi. İleride tema istenirse CSS-variable
> refactor'u ile sıfırdan yapılmalı (10 bileşen, 100+ sınıf).

Durum: `app/globals.css` içinde `html.light { ... }` CSS değişken blokları ZATEN HAZIR;
`AppSettings.dark` tipi + default'u var ama UI'da toggle yok, `html.light` sınıfı hiçbir
yerde uygulanmıyor, grafik teması sabit koyu.

Yapılacaklar:
1. `components/SettingsModal.tsx`: "GÖRÜNÜM" bölümüne "Karanlık Mod" checkbox'ı ekle
   (`update('dark', e.target.checked)` — mevcut toggle kalıbını kullan).
2. `app/page.tsx`: `useEffect` ile `document.documentElement.classList.toggle('light', !settings.dark)`
   uygula (SSR-safe). `<html>`'e `suppressHydrationWarning` layout'ta zaten var.
3. `components/ChartTerminal.tsx`: chart oluşturma seçeneklerini `settings.dark`'a duyarlı yap:
   koyu: `layout.background '#0d1117'`, `textColor '#8b949e'`, grid `rgba(34,39,46,.5)`;
   açık: `background '#f5f6f8'`, `textColor '#5a6570'`, grid `rgba(216,221,227,.5)`.
   Tema değişince `chart.applyOptions(...)` ile canlı uygula (yeni chart kurma).
4. Canvas overlay'ler (heatmap `rgba(38,166,154,a)` / ladder): açık modda opaklığı ~%15 artır
   (beyaz zeminde kaybolmasın); tek `const themeAlpha = settings.dark ? 0 : 0.10` çarpanı yeter.
5. Kabul kriteri: Ayarlar → Karanlık Mode kapatabil; tüm sekmeler okunabilir, grafik dahil
   tema değişmeli; sayfa yenilendiğinde tercih `fs_settings`'ten korunmalı.

### GÖREV B — Duvar Yaşı Takibi + Etiketli Duvar Işınları (Öncelik: YÜKSEK)

Durum: `WallRecord` tipi (`established`, `ageSec`) `lib/types.ts`'te kullanılmıyor.
ChartTerminal'de duvar ışınları çiziliyor ama yaş bilinmiyor. HTML'de: `wallAges` Map'i
duvar doğum anını tutar, `WALL_MIN_AGE = 25000` ms sonrası "yerleşik" sayılır, duvar
etiketinde yaş saniyesi gösterilir; `SPOOF_MAX_AGE = 8000` ms.

Yapılacaklar:
1. `components/ChartTerminal.tsx`: `wallsAgeRef = useRef<Map<string, { born: number; peak: number }>>`
   ekle. Duvar tespit döngüsünde (mevcut `isWall` blokları, ~satır 880 ve 920) anahtar:
   `${side}|${tickBucket(taban fiyat, symbolInfo.tickSize)}`. Duvar görünüyorsa doğum anını
   koru (ilk görünüm), kaybolursa ref'ten sil (10sn detached sonrası). Etiket formatı:
   `$1.2M • 42sn` ve yerleşikse (≥25s) başına `🔒` veya kalın çizgi.
2. Spoof penceresini 8sn'ye çek: `lib/flow-detectors.ts` `detectSpoofRemovals` içinde
   `age < 4000` → `age < 8000`; `lib/flow-detectors.test.ts`'teki spoof testlerini güncelle
   (yaşlı duvar senaryosu 9-12sn'de test edilmeli).
3. Kabul kriteri: DOM ladder duvar ışınlarında yaş saniyesi görünüyor; 25sn+ duvarlar görsel
   olarak ayrışıyor; spoof testleri 8sn pencereyle geçiyor.

### GÖREV C — Karar Motoru Parite Kuralları (Öncelik: ORTA)

> **DURUM: TAMAMLANDI (2026-09-02).** Kurallar `lib/scoring-rules.ts` içinde saf fonksiyonlar
> olarak uygulandı (12 birim test) ve `evaluateRawFlow`'a bağlandı. Spoof penceresi de
> `SPOOF_MAX_AGE_MS = 8000`'e çekildi (flow-detectors + sınır testi).

Durum: `app/page.tsx` → `evaluateRawFlow` (Katman 2 skorlama). HTML'de olup bizde olmayan
kurallar. Her kural `reasons[]` elemanı üretmeli (mevcut üslup).

Yapılacaklar:
1. Funding "kalabalık" penaltısı (mevcut funding bloğuna ekle):
   - `dir==='AL' && funding > 0.00025` → `-5p` "AL tarafı kalabalık; long unwind riski."
   - `dir==='SAT' && funding < -0.00025` → `-5p` "SAT tarafı kalabalık; short squeeze riski."
2. Fade-AL erken çıkış penaltısı: `cascadeDown` dalında `obi < -0.08` → `-8p`
   "OBI hâlâ ask baskılı; fade AL erken olabilir."
3. Liq-cluster bonusunu şartlandır: mevcut `+12p` likidasyon bonusu yalnızca
   `snap.takerSpike` ise verilsin (metne "+ taker spike" ekle).
4. Ters liq akışını oran bazlı yap: mevcut `0.75 * liqMin` mutlak eşiği yerine:
   - SAT: `shortLiq60 > longLiq60 * 1.5 && shortLiq60 >= liqMin` → `-5p`
   - AL: `longLiq60 > shortLiq60 * 1.5 && longLiq60 >= liqMin` → `-5p`
5. Veri tazeliği: `onDepthUpdate` için `lastDepthTsRef`, `onMarkPrice` için `lastMarkTsRef`
   ekle (page.tsx); tazelik kontrolünde `Math.max(lastTradeTs, lastDepthTs, lastMarkTs)` kullan.
6. Whale eşiği tabanı: hesaplama yapılan her yerde `Math.max(50000, whaleMin)` (page.tsx
   onTrade, radar hook'u `use-pattern-radar.ts` buna gerek yok — sadece seçili sembol akışı).
7. OI artış eşiğini `0.35` → `0.25` hizala (yorum metnini koru).
8. Test: mümkünse skor katkılarını saf fonksiyona çıkar (`lib/scoring-rules.ts` önerisi;
   `applyFlowRules(dir, snap, opts) → { delta, reasons }`) ve vitest ile kural bazlı test et.
   Refactor riskli görünürse en azından Manuel doğrulama listesi commit mesajına yazılır.
Kabul: mevcut sinyal akışı regresyona uğramıyor; yeni kurallar gerekçelerle görünüyor.

### GÖREV D — Heatmap Kalite (Öncelik: ORTA-DÜŞÜK)

> **DURUM: TAMAMLANDI (2026-09-02).** `onDepthUpdate` örneklemesi tick-bucket dedupe +
> %3.5 gürültü kesimi + 220 bin limitine geçirildi; tick boyutu `symbolInfos`'tan
> `tickSizeRef` ile takip ediliyor.

Durum: `app/page.tsx` → `onDepthUpdate` içindeki heatmap örnekleme: ±%1.5 bant, ham
180 bin, gürültü kesimi yok. HTML: tick-bucket dedupe + max'ın %3.5 altını kes + 220 bin.

Yapılacaklar:
1. `symbolInfo.tickSize`'ı `page.tsx`'te hesapla (`symbolInfos.find(...)` zaten prop olarak
   ChartTerminal'e gidiyor; page kopyasını çıkar).
2. Örneklemede: fiyatları `Math.round(p / tick) * tick` kovalarına indir (aynı kova birleştir),
   `notional < max * 0.035` olanları at, ilk 220 bin'i tut (sabit `HEAT_MAX_BINS`).
3. Kabul: heatmap daha temiz/keskin; düşük gürültülü seviyeler kayboluyor; pencere 900s aynı.

### GÖREV E — Desen Havuzu Sağlamlaştırma (Öncelik: ORTA)

> **DURUM: TAMAMLANDI (2026-09-02).** `patternRecentExists` (DB ±3 mum dedupe, live yolda
> çağrılıyor), backfill'de RAM seviyesinde aynı guard, `settlePatternEventWithCandles` (saf,
> testli) ve `patternCompleteAllOpenEvents` (açılışta fire-and-forget) eklendi.

Yapılacaklar:
1. `lib/pattern-engine.ts`'e ekle ve test et:
   `async function patternRecentExists(coin, tf, patId, ts, excludeId?)` —
   `coinPatternKey` indeksinden oku, `|timestamp - ts| <= intervalSec(tf) * 3` ise true.
   (Referans HTML satır 2041-2046.)
2. `patternBackfillFromCandles` içinde yeni event yazmadan önce bu guard'ı kullan
   (eventKey dedupe'nin yanına; maliyeti için mevcut `existingMap` yaklaşımını koru —
   map'e zaman da ekleyerek RAM'de çözebilirsin, DB sorgusuz).
3. Live yazımı (`app/page.tsx` sinyal üretim bloğu) mevcut in-memory 3-bar guard'ınin yanına
   DB-level `patternRecentExists` çağrısı ekle (await, hata yutma mevcut kalıp).
4. `lib/pattern-engine.ts`'e `patternCompleteAllOpenEvents()`: tüm `pending`/`tracking`
   event'leri gez; her coin+tf için son mumları `fetchKlines(coin, tf, 60)` ile çekip
   20+ mum geçtiyse `patternOutcome` ile settle et. `app/page.tsx` mount effect'inde
   `initPatternDB()` sonrası fire-and-forget çağır.
5. Kabul: farklı oturumlarda aynı kurgu duplicate yazılmıyor; açılışta bayat tracking
   kayıtları settle oluyor; mevcut 90 test + yeni testler geçiyor.

---

### GENEL DOĞRULAMA (her görev sonrası)
```bash
npx vitest run        # tüm testler geçmeli (şu an 90)
npx tsc --noEmit      # tip hatasız
npx eslint app components lib hooks
npm run build         # production build başarılı
```

### COMMIT STRATEJİSİ
- `feat(theme): aydınlık tema — toggle + grafik/canvas teması (A)`
- `feat(flow): duvar yaşı takibi ve etiketli duvar ışınları; spoof penceresi 8s (B)`
- `feat(engine): karar motoru parite kuralları — funding crowded, fade-OBI, oran bazlı ters liq, tazelik (C)`
- `feat(heatmap): tick-bucket dedupe + gürültü kesimi (D)`
- `feat(pool): DB-level ±3 mum dedupe + açılışta açık event settle (E)`

### YASAKLAR / DİKKAT
- Mevcut WS lifecycle (ref arkası runSignalEngine) tasarımını bozma (reconnect storm fix'i).
- `evaluateRawFlow` imzasını koru; Katman 1 tetik akışını değiştirme.
- Kullanılmayan paket ekleme; lightweight-charts v5 API'si (`chart.addSeries(...)`) kullan.
- Yorum/harleman metinlerini İngilizceleştirme; mevcut Türkçe jargonu koru.
