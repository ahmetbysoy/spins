import { describe, expect, it } from 'vitest';
import {
  __resetNotifyThrottle,
  getNotifyEnabled,
  notificationsSupported,
  notifyPermission,
  pushNotify,
  setNotifyEnabled
} from './notifications';

// Not: vitest environment 'node' — window yok. Guard'ların hepsi sessiz no-op dönmeli.

describe('notifications (SSR/test ortamı guardları)', () => {
  it('window yokken supported/permission güvenli döner', () => {
    expect(notificationsSupported()).toBe(false);
    expect(notifyPermission()).toBe('unsupported');
  });

  it('window yokken enable/disable ve push no-op', () => {
    expect(getNotifyEnabled()).toBe(false);
    expect(() => setNotifyEnabled(true)).not.toThrow();
    expect(getNotifyEnabled()).toBe(false); // localStorage yok -> false kalır
    __resetNotifyThrottle();
    expect(pushNotify({ title: 't', body: 'b' })).toBe(false);
  });

  it('throttle reset sonrası da izinsiz ortamda bildirim gönderilmez', () => {
    __resetNotifyThrottle();
    expect(pushNotify({ title: 'x', body: 'y', tag: 'z' }, 0)).toBe(false);
  });
});
