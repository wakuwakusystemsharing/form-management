import { describe, expect, it } from 'vitest';
import { fnv1a, noteStyleFor } from '@/lib/wall-layout';
import { findNgWords, normalizeForNgMatch } from '@/lib/wall-ng-words';
import { checkWallRate, decodeWallCursor, encodeWallCursor, jstDayStart, validateWallBody } from '@/lib/wall-rules';
import { DEFAULT_NOTE_COLORS, normalizeStoreNgWords, normalizeWallSettings, normalizeWallTheme } from '@/lib/wall-themes';
import { computeWallAuthorHash } from '@/lib/wall-author-hash';

describe('wall-layout（投稿 ID から決まる見た目）', () => {
  it('同じ ID は常に同じ色・傾き・ずれ。範囲内に収まる', () => {
    const colors = ['#111111', '#222222', '#333333'];
    const a = noteStyleFor('abc123def456', colors);
    expect(noteStyleFor('abc123def456', colors)).toEqual(a);
    expect(colors).toContain(a.color);
    for (let i = 0; i < 200; i++) {
      const s = noteStyleFor(`post${i}`, colors);
      expect(s.rotate).toBeGreaterThanOrEqual(-4);
      expect(s.rotate).toBeLessThanOrEqual(4);
      expect(Math.abs(s.offsetX)).toBeLessThanOrEqual(6);
      expect(Math.abs(s.offsetY)).toBeLessThanOrEqual(4);
    }
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
});

describe('wall-ng-words', () => {
  it('共通語・店舗の追加語・形式（URL / メール / 電話 / @ID）を検出する。全角・ひらがなの揺れも吸収', () => {
    expect(findNgWords('死ね')).toEqual(['死ね']);
    expect(findNgWords('ＦＸで稼げる')).toEqual(expect.arrayContaining(['fx', '稼げる']));
    expect(findNgWords('詳しくは https://example.com を見て')).toContain('URL');
    expect(findNgWords('連絡は foo@example.jp まで')).toContain('メールアドレス');
    expect(findNgWords('電話 090-1234-5678')).toContain('電話番号');
    expect(findNgWords('インスタ @my_shop_01 フォローして')).toEqual(expect.arrayContaining(['@ID', 'フォローして']));
    expect(findNgWords('店長の田中さん最高', ['田中'])).toEqual(['田中']);
    expect(normalizeForNgMatch('キモい')).toBe(normalizeForNgMatch('きもい'));
  });

  it('普通の感想・悪い評価は止めない（カスタム / バカンス / シネマ / 素敵な出会い / 日付 / 金額 / 低評価）', () => {
    for (const body of [
      'カスタムメニューがよかった', 'バカンス気分になれました', 'シネマ帰りに寄りました', '素敵な出会いに感謝です',
      '2026-10-01 に来店', '5,500円でした', '料理は正直まずかったし高い', 'おしゃれなお店でした', '10時30分に予約',
    ]) {
      expect(findNgWords(body), body).toEqual([]);
    }
  });
});

describe('wall-rules', () => {
  it('本文: 前後空白を除いて 1〜140 文字', () => {
    expect(validateWallBody('  ありがとう  ')).toEqual({ ok: true, body: 'ありがとう' });
    expect(validateWallBody('   ').ok).toBe(false);
    expect(validateWallBody('あ'.repeat(140)).ok).toBe(true);
    expect(validateWallBody('あ'.repeat(141)).ok).toBe(false);
    expect(validateWallBody(123).ok).toBe(false);
  });

  it('1 日 3 件（JST の日付で判定）と 30 秒間隔', () => {
    const now = new Date('2026-10-09T03:00:00Z'); // 12:00 JST
    expect(jstDayStart(now).toISOString()).toBe('2026-10-08T15:00:00.000Z');
    expect(checkWallRate([], now)).toEqual({ ok: true });
    // 前日（JST）の投稿は数えない
    expect(checkWallRate(['2026-10-08T14:59:00Z', '2026-10-08T14:00:00Z', '2026-10-08T13:00:00Z'], now)).toEqual({ ok: true });
    expect(checkWallRate(['2026-10-08T15:00:00Z', '2026-10-09T01:00:00Z', '2026-10-09T02:00:00Z'], now)).toEqual({ ok: false, reason: 'daily' });
    expect(checkWallRate(['2026-10-09T02:59:50Z'], now)).toEqual({ ok: false, reason: 'interval', retry_after: 20 });
    expect(checkWallRate(['2026-10-09T02:59:30Z'], now)).toEqual({ ok: true });
  });

  it('カーソルの往復と不正値', () => {
    const c = encodeWallCursor('2026-10-09T03:00:00.000Z', 'abc');
    expect(decodeWallCursor(c)).toEqual({ created_at: '2026-10-09T03:00:00.000Z', id: 'abc' });
    expect(decodeWallCursor('???')).toBeNull();
    expect(decodeWallCursor(undefined)).toBeNull();
  });
});

describe('wall-themes', () => {
  it('不正な値は既定値。色は 3〜8 色の HEX のみ', () => {
    const t = normalizeWallTheme({ preset: 'x', font: 'y', note_colors: ['#fff', 'red', '#AABBCC'], title: '  ', background_color: 'blue' });
    expect(t.preset).toBe('cork');
    expect(t.font).toBe('rounded');
    expect(t.note_colors).toEqual(DEFAULT_NOTE_COLORS);
    expect(t.title).toBe('みんなの寄せ書き');
    expect(t.background_color).toBe('');
    expect(normalizeWallTheme({ note_colors: ['#AABBCC', '#112233', '#445566'] }).note_colors).toEqual(['#aabbcc', '#112233', '#445566']);
  });

  it('設定: 行が無い店舗は無効。NG ワードは空・30 文字超・重複を除く', () => {
    const s = normalizeWallSettings('st1', null);
    expect(s).toMatchObject({ store_id: 'st1', enabled: false, moderation: 'instant', access_mode: 'login', ng_words: [] });
    expect(normalizeStoreNgWords([' a ', 'a', '', 'x'.repeat(31), 3])).toEqual(['a']);
  });
});

describe('wall-author-hash', () => {
  it('店舗が違えば同じ人でも別の値。同じ入力は同じ値', () => {
    const secret = 'x'.repeat(40);
    const a = computeWallAuthorHash('st1', 'U1', secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeWallAuthorHash('st1', 'U1', secret)).toBe(a);
    expect(computeWallAuthorHash('st2', 'U1', secret)).not.toBe(a);
    expect(computeWallAuthorHash('st1', 'U2', secret)).not.toBe(a);
  });
});
