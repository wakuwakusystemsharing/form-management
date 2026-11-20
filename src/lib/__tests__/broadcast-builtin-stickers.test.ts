import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BUILTIN_STICKERS,
  STICKER_GENRES,
  isBuiltinStickerId,
  listBuiltinStickers,
  matchesStickerFilter,
  resolveStickerUrl,
  stickerFilterOptions,
} from '../broadcast-builtin-stickers';
import { buildBroadcastPayloads } from '../broadcast-items';

const own = { id: 'u1', store_id: 's1', label: '店の画像', url: 'https://cdn/x.png', preview_url: 'https://cdn/x.png', sort: 0 };

describe('最初から入っているスタンプ', () => {
  it('10 個あり、ID・名前が重複しない', () => {
    const list = listBuiltinStickers();
    expect(list).toHaveLength(10);
    expect(new Set(list.map((s) => s.id)).size).toBe(10);
    expect(new Set(list.map((s) => s.label)).size).toBe(10);
    expect(list.every((s) => s.store_id === null && isBuiltinStickerId(s.id))).toBe(true);
  });

  it('どのジャンルにも 1 個以上ある', () => {
    for (const g of STICKER_GENRES) {
      expect(BUILTIN_STICKERS.some((s) => s.genre === g.id)).toBe(true);
    }
  });

  it('画像ファイル（送信用 / 一覧用）が置いてあり、LINE の上限に収まる', () => {
    for (const s of listBuiltinStickers()) {
      const main = path.join(process.cwd(), 'public', s.url);
      const preview = path.join(process.cwd(), 'public', s.preview_url);
      expect(fs.existsSync(main), s.url).toBe(true);
      expect(fs.existsSync(preview), s.preview_url).toBe(true);
      // LINE の画像メッセージ: 本体 10MB / プレビュー 1MB まで
      expect(fs.statSync(main).size).toBeLessThan(10 * 1024 * 1024);
      expect(fs.statSync(preview).size).toBeLessThan(1024 * 1024);
      // PNG であること
      expect(fs.readFileSync(main).subarray(1, 4).toString()).toBe('PNG');
    }
  });
});

describe('resolveStickerUrl', () => {
  it('サイト内のパスは origin を付け、それ以外はそのまま', () => {
    expect(resolveStickerUrl('/broadcast-stickers/thanks.png', 'https://app.example')).toBe('https://app.example/broadcast-stickers/thanks.png');
    expect(resolveStickerUrl('/broadcast-stickers/thanks.png', 'https://app.example/')).toBe('https://app.example/broadcast-stickers/thanks.png');
    expect(resolveStickerUrl('https://cdn/x.png', 'https://app.example')).toBe('https://cdn/x.png');
    expect(resolveStickerUrl('/other/x.png', 'https://app.example')).toBe('/other/x.png');
    expect(resolveStickerUrl(null, 'https://app.example')).toBe('');
  });
});

describe('ジャンルの絞り込み', () => {
  const all = [...listBuiltinStickers(), own];

  it('ジャンルごと・店舗で追加・すべて', () => {
    expect(all.filter((s) => matchesStickerFilter(s, 'all'))).toHaveLength(11);
    expect(all.filter((s) => matchesStickerFilter(s, 'greeting')).map((s) => s.label)).toEqual([
      'ありがとうございます', 'お待ちしております', 'よろしくお願いします', 'おつかれさまです',
    ]);
    expect(all.filter((s) => matchesStickerFilter(s, 'notice'))).toHaveLength(4);
    expect(all.filter((s) => matchesStickerFilter(s, 'season'))).toHaveLength(2);
    expect(all.filter((s) => matchesStickerFilter(s, 'store'))).toEqual([own]);
  });

  it('選択肢は「すべて」が先頭。店舗の画像が無ければ「店舗で追加」は出さない', () => {
    expect(stickerFilterOptions(all).map((o) => [o.id, o.count])).toEqual([
      ['all', 11], ['greeting', 4], ['notice', 4], ['season', 2], ['store', 1],
    ]);
    expect(stickerFilterOptions(listBuiltinStickers()).map((o) => o.id)).toEqual(['all', 'greeting', 'notice', 'season']);
    expect(stickerFilterOptions([own]).map((o) => o.id)).toEqual(['all', 'store']);
  });
});

describe('送信用メッセージ', () => {
  it('最初から入っているスタンプは https の絶対 URL の画像メッセージになる', () => {
    const stickers: Record<string, { url: string; preview_url: string }> = {};
    for (const s of listBuiltinStickers()) stickers[s.id] = { url: s.url, preview_url: s.preview_url };
    const r = buildBroadcastPayloads({
      items: [{ key: 'a', type: 'sticker', sticker_id: 'builtin:thanks' }],
      refMessages: {},
      stickers,
      origin: 'https://app.example',
      broadcastId: 'b1',
      trackTaps: true,
    });
    expect(r.error).toBeNull();
    expect(r.payloads).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://app.example/broadcast-stickers/thanks.png',
        previewImageUrl: 'https://app.example/broadcast-stickers/thanks_s.png',
      },
    ]);
  });
});
