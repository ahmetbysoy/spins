'use client';

// Tarayıcı bildirimleri: izin takibi + aç/kapa.
// Kod, app/page.tsx içinden birebir taşındı (davranış değişikliği yok).
import { useCallback, useEffect, useState } from 'react';
import { showToast } from '@/components/ui/toast';
import {
  getNotifyEnabled,
  notifyPermission,
  requestNotifyPermission,
  setNotifyEnabled,
  type NotifyPermissionState
} from '@/lib/notifications';

export interface NotificationsApi {
  notifyEnabled: boolean;
  notifyPerm: NotifyPermissionState;
  toggleNotify: () => Promise<void>;
}

export function useNotifications(): NotificationsApi {
  // Tarayıcı bildirimleri
  const [notifyEnabled, setNotifyEnabledState] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermissionState>('unsupported');

  const handleToggleNotify = useCallback(async () => {
    if (notifyPerm === 'unsupported') return;
    if (!getNotifyEnabled()) {
      const perm = await requestNotifyPermission();
      setNotifyPerm(perm);
      if (perm !== 'granted') {
        showToast('Bildirim izni verilemedi — tarayıcı ayarlarından kontrol edebilirsin.', 'warning');
        return;
      }
      setNotifyEnabled(true);
      setNotifyEnabledState(true);
      showToast('Tarayıcı bildirimleri açıldı (sinyal, radar, whale).', 'success');
    } else {
      setNotifyEnabled(false);
      setNotifyEnabledState(false);
      showToast('Tarayıcı bildirimleri kapatıldı.', 'info');
    }
  }, [notifyPerm]);

  // Bildirim tercihini mount'ta oku (SSR-safe)
  useEffect(() => {
    setNotifyPerm(notifyPermission());
    setNotifyEnabledState(getNotifyEnabled() && notifyPermission() === 'granted');
  }, []);

  return { notifyEnabled, notifyPerm, toggleNotify: handleToggleNotify };
}
