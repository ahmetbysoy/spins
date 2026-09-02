// Tarayıcı Bildirim Katmanı — Notification API sarmalayıcı.
// İzin yönetimi + localStorage tercihleri + spam koruması (throttle).
// window olmayan ortamlarda (SSR/test) tüm çağrılar sessizce no-op/false döner.

const LS_KEY = 'fs_notify_enabled';
const DEFAULT_MIN_INTERVAL_MS = 8000;

let lastNotifyTs = 0;

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotifyEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setNotifyEnabled(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {}
}

export type NotifyPermissionState = NotificationPermission | 'unsupported';

export function notifyPermission(): NotifyPermissionState {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotifyPermission(): Promise<NotifyPermissionState> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface NotifyEvent {
  title: string;
  body: string;
  tag?: string;
}

/** Bildirim gönderir; kapalı/izinsiz/throttled durumlarında false döner. */
export function pushNotify(e: NotifyEvent, minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS): boolean {
  if (!getNotifyEnabled() || !notificationsSupported() || Notification.permission !== 'granted') {
    return false;
  }
  const now = Date.now();
  if (now - lastNotifyTs < minIntervalMs) return false;
  lastNotifyTs = now;
  try {
    new Notification(e.title, { body: e.body, tag: e.tag, icon: '/icon.svg' });
    return true;
  } catch {
    return false;
  }
}

/** Sadece testler için. */
export function __resetNotifyThrottle(): void {
  lastNotifyTs = 0;
}
