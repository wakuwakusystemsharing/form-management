/**
 * 抽選結果の LINE メッセージ生成
 *
 * - テキスト: LIFF `sendMessages`（お客様側からトークへ送る）用のテンプレート展開
 * - Flex:    店舗の Bot から push する当選カード（`stores.line_channel_access_token` がある店舗のみ）
 *
 * 純粋関数のみ。送信は `line-push.ts`、呼び出しは API ルートが行う。
 */
import type { LotteryConfig, LotteryEntry, LotteryPrize } from '@/types/lottery';
import { formatDateJst } from '@/lib/lottery-engine';

export const LOTTERY_TEMPLATE_PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: '{抽選名}', label: '抽選フォームのタイトル' },
  { key: '{賞品名}', label: '賞品名（例: A賞「お会計 10% OFF」）' },
  { key: '{引換コード}', label: '引換コード（6 桁）' },
  { key: '{有効期限}', label: '有効期限（例: 2026/10/31。無期限なら行ごと省略）' },
  { key: '{店舗名}', label: '店舗名' },
  { key: '{LINE名}', label: 'LINE の表示名' },
  { key: '{抽選日}', label: '後日抽選の抽選予定日' },
];

export interface LotteryMessageContext {
  lotteryTitle: string;
  storeName: string;
  lineDisplayName: string;
  prizeLabel: string;      // 例: A賞「お会計 10% OFF」。はずれなら ''
  redeemCode: string;      // '' なら行ごと省略
  expiresText: string;     // '' なら行ごと省略
  drawScheduledText: string;
}

/**
 * プレースホルダを展開する。
 * 値が空のプレースホルダだけを含む行（例: 「有効期限：{有効期限}」で無期限）は行ごと削除する。
 */
export function renderLotteryTemplate(template: string, ctx: LotteryMessageContext): string {
  const values: Record<string, string> = {
    '{抽選名}': ctx.lotteryTitle,
    '{賞品名}': ctx.prizeLabel,
    '{引換コード}': ctx.redeemCode,
    '{有効期限}': ctx.expiresText,
    '{店舗名}': ctx.storeName,
    '{LINE名}': ctx.lineDisplayName,
    '{抽選日}': ctx.drawScheduledText,
  };
  const keys = Object.keys(values);
  const lines = template.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const used = keys.filter((k) => line.includes(k));
    if (used.length > 0 && used.every((k) => !values[k])) {
      continue; // 値のないプレースホルダしか無い行は省略
    }
    let rendered = line;
    for (const k of used) rendered = rendered.split(k).join(values[k] ?? '');
    out.push(rendered);
  }
  return out.join('\n').trim();
}

export function buildPrizeLabel(prize: Pick<LotteryPrize, 'name' | 'description'> | null): string {
  if (!prize) return '';
  return prize.description ? `${prize.name}「${prize.description}」` : prize.name;
}

/**
 * 抽選結果に応じた LIFF 送信テキストを作る。
 * - 後日抽選の応募: entry_text
 * - 当選 / 残念賞: win_text
 * - はずれ: lose_text
 */
export function buildLotteryResultText(
  config: LotteryConfig,
  entry: Pick<LotteryEntry, 'status' | 'is_win' | 'is_consolation' | 'redeem_code' | 'expires_at'>,
  prize: LotteryPrize | null,
  extra: { storeName: string; lineDisplayName: string }
): string {
  const ctx: LotteryMessageContext = {
    lotteryTitle: config.basic_info.title || '抽選',
    storeName: extra.storeName,
    lineDisplayName: extra.lineDisplayName,
    prizeLabel: buildPrizeLabel(prize),
    redeemCode: entry.redeem_code || '',
    expiresText: formatDateJst(entry.expires_at),
    drawScheduledText: formatDateJst(config.deferred?.draw_scheduled_at ?? null),
  };
  // 仮当選（provisional）は確定までお客様には応募済みとして扱う
  if (entry.status === 'entered' || entry.status === 'provisional') {
    return renderLotteryTemplate(config.messages.entry_text, ctx);
  }
  if (entry.is_win || entry.is_consolation) {
    return renderLotteryTemplate(config.messages.win_text, ctx);
  }
  return renderLotteryTemplate(config.messages.lose_text, ctx);
}

// ---------------------------------------------------------------------------
// Flex メッセージ（当選カード）
// ---------------------------------------------------------------------------

const RANK_FALLBACK_COLORS = ['#d4af37', '#a8a9ad', '#cd7f32'];
const DEFAULT_HEADER_COLOR = '#1b2a4e';

function isHex(value: string | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function resolvePrizeRankColor(prize: LotteryPrize, prizes: LotteryPrize[]): string {
  if (isHex(prize.rank_color)) return prize.rank_color;
  const idx = prizes.findIndex((p) => p.id === prize.id);
  return RANK_FALLBACK_COLORS[idx] ?? '#6b7280';
}

export interface LotteryFlexParams {
  config: LotteryConfig;
  prize: LotteryPrize;
  entry: Pick<LotteryEntry, 'redeem_code' | 'qr_token' | 'expires_at' | 'is_consolation'>;
  storeName: string;
  /** QR 方式のときに QR 画像として貼る URL（PNG）。null ならコードのみ */
  qrImageUrl: string | null;
}

/** LINE Flex Message（bubble）を組み立てる。返り値はそのまま messages[] に入れられる */
export function buildLotteryWinFlex(params: LotteryFlexParams): Record<string, unknown> {
  const { config, prize, entry, storeName, qrImageUrl } = params;
  const headerColor = isHex(config.basic_info.theme_color) ? config.basic_info.theme_color : DEFAULT_HEADER_COLOR;
  const rankColor = resolvePrizeRankColor(prize, config.prizes);
  const expires = formatDateJst(entry.expires_at);
  const title = entry.is_consolation ? '【残念賞のお知らせ】' : '【当選のお知らせ】';

  const bodyContents: Record<string, unknown>[] = [
    { type: 'text', text: prize.name, weight: 'bold', size: 'xl', color: rankColor, wrap: true },
  ];
  if (prize.description) {
    bodyContents.push({ type: 'text', text: prize.description, size: 'md', wrap: true, margin: 'sm' });
  }
  bodyContents.push({ type: 'separator', margin: 'lg' });

  if (qrImageUrl) {
    bodyContents.push({
      type: 'image',
      url: qrImageUrl,
      size: 'md',
      aspectRatio: '1:1',
      aspectMode: 'fit',
      margin: 'lg',
    });
  }
  if (entry.redeem_code) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'lg',
      contents: [
        { type: 'text', text: '引換コード', size: 'sm', color: '#888888', flex: 2 },
        { type: 'text', text: entry.redeem_code, size: 'lg', weight: 'bold', align: 'end', flex: 3 },
      ],
    });
  }
  if (expires) {
    bodyContents.push({
      type: 'box',
      layout: 'horizontal',
      margin: 'md',
      contents: [
        { type: 'text', text: '有効期限', size: 'sm', color: '#888888', flex: 2 },
        { type: 'text', text: expires, size: 'sm', align: 'end', flex: 3 },
      ],
    });
  }
  bodyContents.push({ type: 'separator', margin: 'lg' });
  bodyContents.push({
    type: 'text',
    text: prize.redeem_note || '店頭でこの画面をご提示ください',
    size: 'sm',
    color: '#555555',
    wrap: true,
    margin: 'lg',
  });

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerColor,
      paddingAll: '14px',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'md', color: '#ffffff', align: 'center' },
        { type: 'text', text: storeName, size: 'xs', color: '#ffffffcc', align: 'center', margin: 'sm', wrap: true },
      ],
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: bodyContents },
  };

  if (prize.image_url && /^https:\/\//.test(prize.image_url)) {
    bubble.hero = {
      type: 'image',
      url: prize.image_url,
      size: 'full',
      aspectRatio: '16:9',
      aspectMode: 'cover',
    };
  }

  const footerButton = config.messages.flex_footer_button;
  if (footerButton && footerButton.label && /^https:\/\//.test(footerButton.url)) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: headerColor,
          action: { type: 'uri', label: footerButton.label.slice(0, 20), uri: footerButton.url },
        },
      ],
    };
  }

  const altText = `${title} ${prize.name}${entry.redeem_code ? ` 引換コード ${entry.redeem_code}` : ''}`.slice(0, 400);
  return { type: 'flex', altText, contents: bubble };
}
