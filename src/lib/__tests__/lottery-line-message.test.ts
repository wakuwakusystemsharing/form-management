import { describe, expect, it } from 'vitest';
import {
  buildLotteryResultText,
  buildLotteryWinFlex,
  buildPrizeLabel,
  renderLotteryTemplate,
  resolvePrizeRankColor,
  type LotteryMessageContext,
} from '@/lib/lottery-line-message';
import { normalizeLotteryConfig } from '@/lib/lottery-normalizer';
import type { LotteryPrize } from '@/types/lottery';

const ctx: LotteryMessageContext = {
  lotteryTitle: '夏の来店感謝くじ',
  storeName: 'テスト店',
  lineDisplayName: '太郎',
  prizeLabel: 'A賞「お会計 30% OFF」',
  redeemCode: '7X4K2P',
  expiresText: '2026/10/31',
  drawScheduledText: '',
};

describe('renderLotteryTemplate', () => {
  it('プレースホルダを展開する', () => {
    expect(renderLotteryTemplate('{LINE名}さん {賞品名} {引換コード} {有効期限} @{店舗名} / {抽選名}', ctx)).toBe(
      '太郎さん A賞「お会計 30% OFF」 7X4K2P 2026/10/31 @テスト店 / 夏の来店感謝くじ'
    );
  });

  it('値の無いプレースホルダだけの行は省略する', () => {
    const text = renderLotteryTemplate('結果：{賞品名}\n有効期限：{有効期限}\n抽選日：{抽選日}\n以上', { ...ctx, expiresText: '' });
    expect(text).toBe('結果：A賞「お会計 30% OFF」\n以上');
  });

  it('値のあるプレースホルダが 1 つでもあれば行を残す', () => {
    const text = renderLotteryTemplate('{引換コード} / {有効期限}', { ...ctx, expiresText: '' });
    expect(text).toBe('7X4K2P /'); // 全体の trim で末尾の空白は落ちる
  });

  it('同じプレースホルダが複数回あってもすべて置換する', () => {
    expect(renderLotteryTemplate('{LINE名}{LINE名}', ctx)).toBe('太郎太郎');
  });

  it('前後の空行を取り除く', () => {
    expect(renderLotteryTemplate('\n\nA\n{有効期限}\n\n', { ...ctx, expiresText: '' })).toBe('A');
  });
});

describe('buildPrizeLabel', () => {
  it('説明があれば「」で付ける', () => {
    expect(buildPrizeLabel({ name: 'A賞', description: '30% OFF' })).toBe('A賞「30% OFF」');
    expect(buildPrizeLabel({ name: 'A賞' })).toBe('A賞');
    expect(buildPrizeLabel(null)).toBe('');
  });
});

describe('buildLotteryResultText', () => {
  const config = normalizeLotteryConfig({
    basic_info: { title: 'くじ' },
    deferred: { draw_scheduled_at: '2026-10-01T00:00:00+09:00' },
  });
  const prize: LotteryPrize = { id: 'a', name: 'A賞', description: '30% OFF', probability: 10, stock: null };

  it('当選: 既定テンプレートで賞品・コード・期限を出す', () => {
    const text = buildLotteryResultText(
      config,
      { status: 'drawn', is_win: true, is_consolation: false, redeem_code: 'ABC234', expires_at: '2026-10-31T14:59:59.999Z' },
      prize,
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text).toBe('🎯 くじ に参加しました\n結果：A賞「30% OFF」\n引換コード：ABC234\n有効期限：2026/10/31\n\n※店頭でこの画面をご提示ください');
  });

  it('当選で無期限なら有効期限の行が消える', () => {
    const text = buildLotteryResultText(
      config,
      { status: 'drawn', is_win: true, is_consolation: false, redeem_code: 'ABC234', expires_at: null },
      prize,
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text).not.toContain('有効期限');
    expect(text).toContain('引換コード：ABC234');
  });

  it('残念賞も win_text を使う', () => {
    const text = buildLotteryResultText(
      config,
      { status: 'drawn', is_win: false, is_consolation: true, redeem_code: 'ABC234', expires_at: null },
      { ...prize, name: '残念賞' },
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text).toContain('結果：残念賞「30% OFF」');
  });

  it('はずれは lose_text', () => {
    const text = buildLotteryResultText(
      config,
      { status: 'lost', is_win: false, is_consolation: false, redeem_code: null, expires_at: null },
      null,
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text).toBe('🎯 くじ に参加しました\n結果：はずれ\n\nまたのご参加をお待ちしております');
  });

  it('後日抽選の応募は entry_text で抽選日を出す', () => {
    const text = buildLotteryResultText(
      config,
      { status: 'entered', is_win: false, is_consolation: false, redeem_code: null, expires_at: null },
      null,
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text).toBe('🎯 くじ に応募しました\n抽選日：2026/10/01\n\n結果は LINE でお知らせします');
  });

  it('タイトル未設定なら「抽選」', () => {
    const text = buildLotteryResultText(
      normalizeLotteryConfig({}),
      { status: 'lost', is_win: false, is_consolation: false, redeem_code: null, expires_at: null },
      null,
      { storeName: '店', lineDisplayName: '太郎' }
    );
    expect(text.startsWith('🎯 抽選 に参加しました')).toBe(true);
  });
});

describe('resolvePrizeRankColor', () => {
  const prizes: LotteryPrize[] = [
    { id: 'a', name: 'A', probability: 1, stock: null },
    { id: 'b', name: 'B', probability: 1, stock: null, rank_color: '#ff0000' },
    { id: 'c', name: 'C', probability: 1, stock: null, rank_color: 'red' },
    { id: 'd', name: 'D', probability: 1, stock: null },
  ];
  it('HEX 指定があればそれ、無ければ順位色、4 位以降はグレー', () => {
    expect(resolvePrizeRankColor(prizes[0], prizes)).toBe('#d4af37');
    expect(resolvePrizeRankColor(prizes[1], prizes)).toBe('#ff0000');
    expect(resolvePrizeRankColor(prizes[2], prizes)).toBe('#cd7f32');
    expect(resolvePrizeRankColor(prizes[3], prizes)).toBe('#6b7280');
  });
});

describe('buildLotteryWinFlex', () => {
  const config = normalizeLotteryConfig({
    basic_info: { title: 'くじ', theme_color: '#112233' },
    prizes: [{ id: 'a', name: 'A賞', description: '30% OFF', probability: 10, stock: null, image_url: 'https://img/x.png', redeem_note: 'レジで提示' }],
    messages: { flex_footer_button: { label: '地図を見る', url: 'https://maps.example.com' } },
  });
  const prize = config.prizes[0];

  it('当選カードを組み立てる', () => {
    const flex = buildLotteryWinFlex({
      config,
      prize,
      entry: { redeem_code: 'ABC234', qr_token: null, expires_at: '2026-10-31T14:59:59.999Z', is_consolation: false },
      storeName: '店',
      qrImageUrl: null,
    });
    expect(flex.type).toBe('flex');
    expect(flex.altText).toBe('【当選のお知らせ】 A賞 引換コード ABC234');
    const bubble = flex.contents as Record<string, any>;
    expect(bubble.header.backgroundColor).toBe('#112233');
    expect(bubble.hero.url).toBe('https://img/x.png');
    expect(bubble.footer.contents[0].action.uri).toBe('https://maps.example.com');
    const texts = JSON.stringify(bubble.body);
    expect(texts).toContain('ABC234');
    expect(texts).toContain('2026/10/31');
    expect(texts).toContain('レジで提示');
    expect(texts).not.toContain('"type":"image"');
  });

  it('QR 画像 URL があれば body に画像を入れる', () => {
    const flex = buildLotteryWinFlex({
      config,
      prize,
      entry: { redeem_code: 'ABC234', qr_token: 'tok', expires_at: null, is_consolation: false },
      storeName: '店',
      qrImageUrl: 'https://app/api/lotteries/qr/tok.png',
    });
    const body = (flex.contents as Record<string, any>).body;
    expect(JSON.stringify(body)).toContain('https://app/api/lotteries/qr/tok.png');
    expect(JSON.stringify(body)).not.toContain('有効期限');
  });

  it('残念賞はタイトルが変わる。http の画像・ボタンは付けない', () => {
    const cfg = normalizeLotteryConfig({
      prizes: [{ id: 'a', name: '残念賞', probability: 0, stock: null, image_url: 'http://insecure/x.png' }],
      messages: { flex_footer_button: { label: 'x', url: 'http://insecure' } },
    });
    const flex = buildLotteryWinFlex({
      config: cfg,
      prize: cfg.prizes[0],
      entry: { redeem_code: null, qr_token: null, expires_at: null, is_consolation: true },
      storeName: '店',
      qrImageUrl: null,
    });
    const bubble = flex.contents as Record<string, any>;
    expect(flex.altText).toBe('【残念賞のお知らせ】 残念賞');
    expect(bubble.hero).toBeUndefined();
    expect(bubble.footer).toBeUndefined();
    expect(bubble.header.backgroundColor).toBe('#1b2a4e');
  });
});
