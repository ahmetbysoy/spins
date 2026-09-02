import type { MetadataRoute } from 'next';

// Statik metadata route'u — output:export (APK kabuğu) bunu ister; normal build etkilenmez
export const dynamic = 'force-static';

// PWA — "Ana ekrana ekle" (APK'siz kurulum); ikonlar android/icon-master.png'den üretildi
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Spins Terminal',
    short_name: 'Spins',
    description: 'Binance futures orderflow ve likidite terminali',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0B0E14',
    theme_color: '#0B0E14',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
