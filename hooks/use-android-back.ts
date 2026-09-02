'use client';

// Overlay aktifken Android geri tusunu 'kapat' eylemine baglar (LIFO — bkz. lib/back-button).
import { useEffect, useRef } from 'react';
import { registerBackHandler } from '@/lib/back-button';

export function useAndroidBack(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => closeRef.current());
  }, [active]);
}
