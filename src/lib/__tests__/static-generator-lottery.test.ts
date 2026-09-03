import { describe, expect, it } from 'vitest';
import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';
import { buildQrImageUrl, extractQrToken, QR_TOKEN_PATTERN } from '@/lib/lottery-qr';

function makeForm(config: Record<string, unknown> = {}) {
  return normalizeLotteryForm({
    id: 'form1',
    store_id: 'st1',
    status: 'active',
    config: {
      basic_info: { title: '夏の<くじ>', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e', notice: 'お一人様1回' },
      prizes: [
        { id: 'a', name: 'A賞', description: '30% "OFF"', probability: 10, stock: 3, image_url: 'https://img/a.png' },
        { id: 'b', name: 'B賞', probability: 20, stock: null },
      ],
      entry_rules: {
        limit: 'daily',
        require_friend: true,
        when_sold_out: 'lose',
        pre_questions: [
          { id: 'q1', type: 'text', title: 'お名前', required: true },
          { id: 'q2', type: 'radio', title: '来店動機', required: false, allow_other: true, options: [
            { label: 'HP', value: 'HP' },
            { label: '紹介', value: '紹介', follow_up: { enabled: true, title: 'ご紹介者', type: 'text', required: true } },
          ] },
          { id: 'q3', type: 'select', title: '年代', required: false, options: [{ label: '20代', value: '20代' }] },
          { id: 'q4', type: 'checkbox', title: '興味', required: false, options: [{ label: 'A', value: 'A' }] },
          { id: 'q5', type: 'date', title: '来店日', required: false },
        ],
      },
      ...config,
    },
  });
}

const gen = new StaticLotteryGenerator();

describe('StaticLotteryGenerator', () => {
  it('本番モード: LIFF SDK を読み込み、設定を JSON で埋め込み、HTML をエスケープする', () => {
    const html = gen.generateHTML(makeForm(), 'production');
    expect(html).toContain('<script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>');
    expect(html).not.toContain('preview-banner">');
    expect(html).toContain('<title>夏の&lt;くじ&gt;</title>');
    expect(html).toContain('30% &quot;OFF&quot;');
    expect(html).toContain('"form_id":"form1"');
    expect(html).toContain('"store_id":"st1"');
    expect(html).toContain('"liff_id":"1234567890-abcdefgh"');
    expect(html).toContain('var IS_PREVIEW = false;');
    // JS 側の演出クラスと本体
    expect(html).toContain('class="anim-scratch"');
    expect(html).toContain('function startScratch()');
    expect(html).toContain('function startGacha()');
    expect(html).toContain('function startDrum()');
    expect(html).toContain('/api/lotteries/draw');
    expect(html).toContain('/my-result');
  });

  it('プレビューモード: LIFF を読み込まず、バナーを出す', () => {
    const html = gen.generateHTML(makeForm(), 'preview');
    expect(html).not.toContain('static.line-scdn.net/liff');
    expect(html).toContain('preview-banner');
    expect(html).toContain('var IS_PREVIEW = true;');
  });

  it('埋め込んだ JS にバッククォートを含まない（テンプレート崩れ防止）', () => {
    const html = gen.generateHTML(makeForm(), 'production');
    const scriptStart = html.indexOf('var FORM_CONFIG');
    const script = html.slice(scriptStart);
    expect(script).not.toContain('`');
    // 改行エスケープが JS 文字列として正しく出ている
    expect(script).toContain("split('\\n')");
    expect(script).toContain("replace(/\\n/g, '<br>')");
  });

  it('事前質問: 各タイプ・その他・追加質問を描画する', () => {
    const html = gen.generateHTML(makeForm(), 'production');
    expect(html).toContain('id="q-q1"');
    expect(html).toContain('Q1. お名前<span class="required">必須</span>');
    expect(html).toContain('id="choices-q2"');
    expect(html).toContain('data-other="1"');
    expect(html).toContain('id="other-q2"');
    expect(html).toContain('id="fu-q2-1"');
    expect(html).toContain('id="fu-q2-1-input"');
    expect(html).toContain('<select id="q-q3"');
    expect(html).toContain('id="choices-q4"');
    expect(html).toContain('type="date" id="q-q5"');
  });

  it('事前質問が無ければ質問セクションを出さない', () => {
    const html = gen.generateHTML(makeForm({ entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [] } }), 'production');
    expect(html).not.toContain('id="questionsSection"');
  });

  it('注意事項: 参加制限・友だち必須・引換方式に応じた文言', () => {
    const html = gen.generateHTML(makeForm(), 'production');
    expect(html).toContain('お一人様 1 日 1 回まで参加できます');
    expect(html).toContain('参加には公式 LINE の友だち追加が必要です');
    expect(html).toContain('引換コードをご提示ください');
    expect(html).toContain('お一人様1回'); // 店舗が書いた notice
    const qr = gen.generateHTML(makeForm({ redeem_method: 'qr' }), 'production');
    expect(qr).toContain('QR コードをご提示ください');
  });

  it('演出の切り替え: gacha / simple のステージを出す', () => {
    const gacha = gen.generateHTML(makeForm({ presentation: { animation: 'gacha' } }), 'production');
    expect(gacha).toContain('class="anim-gacha"');
    expect(gacha).toContain('id="gachaLever"');
    const simple = gen.generateHTML(makeForm({ presentation: { animation: 'simple' } }), 'production');
    expect(simple).toContain('id="drumText"');
    expect(simple).not.toContain('id="scratchCanvas"');
  });

  it('確率・在庫の表示は設定で ON/OFF', () => {
    const off = gen.generateHTML(makeForm(), 'production');
    expect(off).not.toContain('data-prize-stock');
    const on = gen.generateHTML(makeForm({ presentation: { show_probability: true, show_stock: true } }), 'production');
    expect(on).toContain('data-prize-stock="a"');
    expect(on).toContain('残り3');
    expect(on).toContain('はずれ 70%');
  });

  it('後日抽選: ボタン文言と締切バッジ', () => {
    const html = gen.generateHTML(makeForm({
      lottery_type: 'deferred',
      basic_info: { title: 'キャンペーン', liff_id: '1234567890-abcdefgh', period: { end_at: '2026-09-30T23:59:59+09:00' } },
      prizes: [{ id: 'a', name: 'A賞', probability: 0, stock: 2 }],
    }), 'production');
    expect(html).toContain('>応募する</button>');
    expect(html).toContain('応募締切 9/30（水）');
    expect(html).toContain('お一人様 1 口まで応募できます');
    expect(html).toContain('"lottery_type":"deferred"');
  });

  it('期間バッジ: 開始〜終了', () => {
    const html = gen.generateHTML(makeForm({
      basic_info: { title: 'T', liff_id: '1234567890-abcdefgh', period: { start_at: '2026-09-01T00:00:00+09:00', end_at: '2026-09-30T23:59:59+09:00' } },
    }), 'production');
    expect(html).toContain('9/1（火） 〜 9/30（水）');
  });

  it('不正なテーマカラーは既定色に落とす', () => {
    const html = gen.generateHTML(makeForm({ basic_info: { title: 'T', liff_id: 'x', theme_color: 'javascript:alert(1)' } }), 'production');
    expect(html).toContain('--primary-color: #1b2a4e;');
    expect(html).not.toContain('--primary-color: javascript');
  });

  it('タイトルに </script> が含まれてもスクリプトを閉じられない', () => {
    const html = gen.generateHTML(makeForm({ basic_info: { title: 'x</script><script>alert(1)</script>', liff_id: '1234567890-abcdefgh' } }), 'production');
    const scriptStart = html.indexOf('var FORM_CONFIG');
    const script = html.slice(scriptStart);
    expect(script).not.toContain('</script><script>alert');
    expect(script).toContain('x\\u003c/script\\u003e');
    expect(html).toContain('<title>x&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
  });
});

describe('lottery-qr', () => {
  it('トークン形式', () => {
    expect(QR_TOKEN_PATTERN.test('a'.repeat(32))).toBe(true);
    expect(QR_TOKEN_PATTERN.test('A'.repeat(32))).toBe(false);
    expect(QR_TOKEN_PATTERN.test('a'.repeat(31))).toBe(false);
  });
  it('画像 URL', () => {
    expect(buildQrImageUrl('x'.repeat(32), 'https://app')).toBe('https://app/api/lotteries/qr/' + 'x'.repeat(32) + '.png');
  });
  it('スキャン結果からトークンを取り出す', () => {
    const t = 'k'.repeat(32);
    expect(extractQrToken(t)).toBe(t);
    expect(extractQrToken(`https://app/r/${t}`)).toBe(t);
    expect(extractQrToken(`https://app/r/${t}?x=1`)).toBe(t);
    expect(extractQrToken('https://evil/r/short')).toBeNull();
    expect(extractQrToken('')).toBeNull();
  });
});
