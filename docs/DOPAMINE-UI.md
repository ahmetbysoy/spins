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

## Sırada (kullanıcıdan gelirse)
- (boş — kullanıcı maddeleri geldikçe eklenir)
