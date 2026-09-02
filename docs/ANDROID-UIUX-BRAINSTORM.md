# Spins — Android UI/UX Cilalama Beyin Fırtınası

> Hedef: tarayıcıda zaten iyi çalışan terminali, APK/PWA'da **yerli uygulama hissi** vermek.
> Her madde: neden + nasıl (kod) + spins'te nereye. Öncelik: P0 (APK deneyimini bozar) → P3 (cilalar).
> Mevcut durum notları: `globals.css` zaten `overscroll-behavior-y: none` + safe-area CSS değişkenleri (`--sat/--sab/...`) tanımlı; MINI X butonu 28px; `xs:425px` breakpoint mevcut.

---

## P0 — APK deneyimini bugün bozanlar

### 1. Android GERİ tuşu uygulamayı kapatıyor
WebView'da geri tuşu default'ta activity'yi bitirir. Çözüm: `history.pushState` tekniği — overlay açılınca sahte history gir, `popstate`'te overlay'i kapat.
```ts
// hooks/use-android-back.ts (yeni)
export function useAndroidBack(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    history.pushState({ fs: 1 }, '');
    const onPop = () => close();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // kullanıcı X ile kapattıysa sahte history'yi temizle
      if (history.state?.fs) history.back();
    };
  }, [active, close]);
}
// Kullanım: useAndroidBack(fsSymOpen, () => setFsSymOpen(false));  (ChartTerminal)
//           useAndroidBack(isFullscreen, () => setIsFullscreen(false)); (page)
```
Spins'te back ile kapanması gerekenler: tam ekran sembol arama (`fsSymOpen`), tam ekran modu, ayarlar paneli, radar listesi. **En yüksek etkili tek madde bu.**

### 2. Çift dokunma zoom + tap highlight + grafikte metin seçimi
```css
/* globals.css */
html { -webkit-text-size-adjust: 100%; }
* { -webkit-tap-highlight-color: transparent; }
body { touch-action: pan-y; }              /* dikey sayfa kaydırma serbest */
.chart-wrap, canvas { touch-action: none; user-select: none; -webkit-user-select: none; }
button, a, [role="button"] { touch-action: manipulation; } /* 300ms çift-tık zoom'u keser */
```
`ChartTerminal` konteynerine `select-none` + `touch-none` Tailwind sınıfları da yeter.

### 3. Input/select zoom'u (klavye sayfayı büyütüyor)
Android Chrome, fontu 16px altı olan input'a odaklanınca sayfayı zoom'lar. Ayar paneli select'leri (`text-[11px]`) riskli:
```css
input, select, textarea { font-size: max(16px, 1em); }  /* @layer base */
/* veya odak zoom'unu tamamen kes: */
@media (max-width: 768px) { html { touch-action: pan-y pinch-zoom none; } } /* agresif — tercih edilmez */
```
Pratik çözüm: mobilde ayar select'leri `text-base` (16px) yapmak — görsel hiyerarşiyi bozmamak için sadece `@media (hover:none)` altında.

### 4. Sanal klavye ve 100vh sorunu
`100vh` klavye açılınca değişmez → alttaki karar şeridi klavyenin altında kalır.
```css
.app-shell { height: 100dvh; }  /* dvh: dinamik — klavyeyle daralır */
```
```html
<!-- layout.tsx viewport meta (interactive-widget klavye davranışı) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
```
Ayrıca karar motoru şeridi `padding-bottom: max(env(--sab), 12px)` ile gesture bar'dan taşmasın (değişken zaten var — kullanım denetlenmeli).

### 5. Kenar geri-kaydırma (back swipe) grafiği kaydırıyor
Android 13+ kenar swipe'u sayfanın scroll'unu değil activity'yi etkiler, ama WebView içinde yatay grafik pan'i ile yarışır. Grafik tam ekran + `touch-action: none` (madde 2) kombinasyonu çakışmayı bitirir; tam ekranda çıkış için yukarı-sol köşeye görünür bir "↙ çık" butonu ekle (kullanıcı back'i bilmeyebilir).

---

## P1 — Native his (görsel/dokunsal)

### 6. Hover değil `active` state'leri
Telefonda `:hover` yapışkan kalır (tap sonrası). Mevcut `hover:bg-*` sınıflarının çoğu dokunmatikte gecikme hissi verir:
```css
@media (hover: none) {
  .hover\:bg-\[\#1c222b\]:hover { background: inherit; } /* vb. — daha temizi: */
}
```
Daha sürdürülebilir yol: global `@media (hover:hover)` guard + `active:` varyantları:
```tsx
className="... active:bg-[#1c222b] active:scale-[0.98] transition-transform"
```
Öncelikli noktalar: sembol seçici satırları, MINI pill, mini kart, sinyal satırları, ayar toggle'ları.

### 7. Dokunma hedefi denetimi (44px kuralı)
- MINI X 28px (yapıldı) — kartın kendisi `h-24` OK.
- Legend kapatma ✕, ayar satır switch'leri, radar satırları: `min-h-[44px]` veya `py-3`.
- Quick win: `@layer base { button:not(.dense) { min-height: 44px; min-width: 44px; } }` — dar UI'ları `.dense` ile muaf tut.

### 8. Haptik geri bildirim
PREDATOR'daki `triggerHaptic` fikri (orada sinyal ≥5 skorda titrer):
```ts
// lib/haptics.ts
export function buzz(pattern: number | number[] = 15) {
  try { navigator.vibrate?.(pattern); } catch {}
}
// Kullanım: AL/SAT sinyali → buzz([30, 40, 30]); whale → buzz(20); hata → yok (spam olmasın)
```
Ayara bağla (`settings.haptics`, default açık) — `AppSettings` + ayar paneli satırı.

### 9. Momentum + snap kaydırma
Mini grid ve sinyal listesi yumuşak olmalı:
```css
.mini-strip, .log-list { -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; }
.mini-strip > * { scroll-snap-align: start; }
```

### 10. PWA manifest + maskable ikon (APK'sız "Ana ekrana ekle" yolu)
APK zaten geliyor ama Vercel URL'sini paylaşan herkes için:
```ts
// app/manifest.ts (Next.js)
import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Spins Terminal', short_name: 'Spins', display: 'standalone',
    start_url: '/', background_color: '#0B0E14', theme_color: '#0B0E14',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
```
+ `theme-color` meta (status bar rengi koyu). APK ikonuyla aynı varlık kullanılabilir (`android/icon-master.png`'den üret).

### 11. Scrollbar gizleme (mobilde)
İnce şeritlerde kalıcı scrollbarlar yer yakar: `.no-sb { scrollbar-width: none; } .no-sb::-webkit-scrollbar { display: none; }`

---

## P2 — Performans / batarya / ağ

### 12. Arka planda RAF + polling susuzluğu
```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { /* drawOverlays rAF iptal; mini kart 15s poll durdur */ }
  else { /* yeniden çiz + hemen bir snapshot */ }
});
```
WS açık kalabilir (sinyal gecikmesin) ama canvas çizimi gizliyken tamamen atlanmalı — bataryada %20'ye varan fark.

### 13. Ağ farkındalığı
```ts
const conn = (navigator as any).connection;
const slow = conn && /2g|slow/.test(conn.effectiveType ?? '');
// slow → rest-race timeout 4s→6s, heatmap bin sayısı 220→120, mini kart poll 15s→30s
```

### 14. Canvas katmanlarında `will-change`
`domOverlayCanvasRef` + heatmap canvas: `will-change: transform;` + cihaz piksel oranı sabit `devicePixelRatio` ile çizim (retro Look'u önler, APK'da fark edilir).

---

## P3 — İleride
- **Web Push → Capacitor köprüsü**: Telegram bridge yerine/başına telefon bildirimi (Web Push API tarayıcıda, APK'da `@capacitor/push-notifications`).
- **Çevrimdışı kabuk**: `sw.js` precache → "bağlantı yok" ekranı + rest-race degraded rozeti ile uyumlu.
- **Landscape terminal modu**: yatayda otomatik tam ekran + ladder geniş (%60).
- **Onboarding**: ilk açılışta tek ekran "F = tam ekran, MINI = kartlar, ← = geri kapatır".

---

## Hızlı kazanım sıralaması
| # | İş | Dosya | Efor |
|---|---|---|---|
| 1 | Android geri tuşu | yeni `use-android-back` + 4 çağrı | ~1sa |
| 2 | touch-action/user-select/tap-highlight | `globals.css` | 15dk |
| 3 | 100dvh + interactive-widget | `layout.tsx` + css | 15dk |
| 6 | active: state'ler | buton sınıfları | 45dk |
| 8 | haptics (ayarlı) | `lib/haptics` + sinyal yolı | 30dk |
| 10 | manifest.ts + theme-color | `app/manifest.ts` | 20dk |
| 12 | visibilitychange rAF kilidi | ChartTerminal + MiniChartCard | 30dk |
