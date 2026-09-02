import type {Metadata, Viewport} from 'next';
import './globals.css'; // Global styles
import { ToastProvider } from '@/components/ui/toast';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b0e14',
  // Klavye acilinca gorunur alan daralir (karar sutu klavye altinda kalmaz)
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  title: 'Binance Futures Pro Scanner & OrderFlow Terminal',
  description: 'High-frequency real-time Binance USD-M Futures orderflow scanner, CVD delta analyzer, liquidity heatmap, DOM ladder, and quantitative pattern engine.',
  openGraph: {
    title: 'Binance Futures Pro Scanner & OrderFlow Terminal',
    description: 'High-frequency real-time Binance USD-M Futures orderflow scanner, CVD delta analyzer, liquidity heatmap, DOM ladder, and quantitative pattern engine.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Binance Futures Pro Scanner & OrderFlow Terminal',
    description: 'High-frequency real-time Binance USD-M Futures orderflow scanner, CVD delta analyzer, liquidity heatmap, DOM ladder, and quantitative pattern engine.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="mx-auto w-full max-w-[480px] sm:border-x sm:border-[#1f252e]">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
