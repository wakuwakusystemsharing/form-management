import { describe, expect, it } from 'vitest';
import { readShowFriends, showFriendsStorageKey, writeShowFriends } from '@/lib/customer-list-prefs';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('顧客一覧の「LINE 友だちのみも表示」を覚える', () => {
  it('何も覚えていないときは、表示しない（今までどおり）', () => {
    expect(readShowFriends('st0001', memoryStorage())).toBe(false);
  });

  it('チェックを入れると覚え、外すと外した状態を覚える', () => {
    const s = memoryStorage();
    writeShowFriends('st0001', true, s);
    expect(readShowFriends('st0001', s)).toBe(true);
    writeShowFriends('st0001', false, s);
    expect(readShowFriends('st0001', s)).toBe(false);
    expect(s.map.get(showFriendsStorageKey('st0001'))).toBe('0');
  });

  it('店舗ごとに別々に覚える', () => {
    const s = memoryStorage();
    writeShowFriends('st0001', true, s);
    expect(readShowFriends('st0002', s)).toBe(false);
  });

  it('保存先が使えない・失敗するときも例外を投げない', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readShowFriends('st0001', broken)).toBe(false);
    expect(() => writeShowFriends('st0001', true, broken)).not.toThrow();
    expect(readShowFriends('st0001', null)).toBe(false);
    expect(() => writeShowFriends('st0001', true, null)).not.toThrow();
  });
});
