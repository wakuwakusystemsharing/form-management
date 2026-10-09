import { describe, expect, it } from 'vitest';
import { STORE_ADMIN_GUIDES, STORE_ADMIN_HINTS, getStoreAdminGuide } from '@/lib/store-admin-guide';
import { STORE_ADMIN_TAB_IDS } from '@/lib/store-admin-tabs';

describe('store-admin-guide（店舗管理者ページの使い方の文言）', () => {
  it('すべてのタブに説明があり、項目名・本文が空でない', () => {
    for (const tab of STORE_ADMIN_TAB_IDS) {
      const guide = STORE_ADMIN_GUIDES[tab];
      expect(guide, tab).toBeDefined();
      expect(guide.intro.trim().length, `${tab}.intro`).toBeGreaterThan(10);
      expect(guide.items.length, `${tab}.items`).toBeGreaterThan(0);
      for (const item of guide.items) {
        expect(item.title.trim(), `${tab} item title`).not.toBe('');
        expect(item.text.trim().length, `${tab} ${item.title}`).toBeGreaterThan(10);
      }
      // 同じ項目名が重複していない（dl の key に使う）
      expect(new Set(guide.items.map((i) => i.title)).size).toBe(guide.items.length);
      (guide.tips || []).forEach((tip) => expect(tip.trim()).not.toBe(''));
    }
  });

  it('画面の言葉と説明の項目名が一致している（主要なもの）', () => {
    const titles = (tab: keyof typeof STORE_ADMIN_GUIDES) => STORE_ADMIN_GUIDES[tab].items.map((i) => i.title);
    expect(titles('reservations')).toEqual(expect.arrayContaining(['フォーム管理', '一覧', '分析', 'ステータス', '店舗側手動予約フォーム']));
    expect(titles('customers')).toEqual(expect.arrayContaining(['一覧', '分析', 'セグメント', '顧客詳細']));
    expect(titles('surveys')).toEqual(expect.arrayContaining(['フォーム管理', '回答一覧']));
    expect(titles('lotteries')).toEqual(expect.arrayContaining(['フォーム管理', '抽選履歴', '後日抽選の管理']));
    expect(titles('walls')).toEqual(expect.arrayContaining(['付箋の確認', 'ボード', '見た目', 'NGワード']));
    expect(titles('settings')).toEqual(expect.arrayContaining(['表示設定', 'アカウント情報']));
  });

  it('getStoreAdminGuide は未知のタブで undefined、ヒントは空でない', () => {
    expect(getStoreAdminGuide('dashboard')?.intro).toContain('店舗全体');
    expect(getStoreAdminGuide('nope')).toBeUndefined();
    Object.values(STORE_ADMIN_HINTS).forEach((h) => expect(h.trim().length).toBeGreaterThan(10));
  });
});
