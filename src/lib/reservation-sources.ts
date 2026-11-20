/**
 * 流入経路の計測（純粋ロジック）。設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 5 章
 *
 * 店頭ポップ・チラシ・Instagram など、置き場所ごとに別々の URL（QR コード）を発行し、どこから予約が入ったかを数える。
 *
 *   発行する URL: {このシステム}/s/{code}
 *     → 「読まれた数」を 1 増やして、予約フォームを ?src={code} 付きで開く
 *     → フォームが予約を送るときに source_code = code を付ける
 *     → サーバーが、その店舗に実在する経路かを確かめてから予約に記録する
 *
 * - 経路は削除しない（「停止」にする）。停止した経路の URL は通常のフォームを開き、記録はしない。過去の集計は残る
 * - `?src=` を送れるのは、対応済みの HTML をデプロイしたフォームだけ（`static_deploy.features` の `source_code`）。
 *   古い HTML は `?src=` を知らず、予約は入るが経路が記録されない → 一覧に「保存＆デプロイしてください」と出す
 */
import type { FormConfig, StaticDeploy } from '@/types/form';
import { hasDeployedFeature } from '@/lib/form-deploy-features';

export const SOURCE_CODE_LENGTH = 8;
/** 経路の合言葉（英小文字と数字 8 文字）。フォーム側の埋め込み JS（getSourceCode）と同じ規則。**直すときは両方** */
export const SOURCE_CODE_PATTERN = /^[a-z0-9]{8}$/;
export const SOURCE_NAME_MAX = 40;
export const SOURCE_MAX_PER_STORE = 100;

export interface ReservationSource {
  id: string;
  store_id: string;
  form_id: string;
  name: string;
  code: string;
  active: boolean;
  /** 発行した URL（QR コード）が開かれた回数。目安（読んだだけで閉じた人も数える） */
  click_count: number;
  created_at: string;
  updated_at: string;
}

/** 紛らわしい文字（0 / o、1 / l / i）を除いた英小文字と数字 */
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateSourceCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < SOURCE_CODE_LENGTH; i++) out += CODE_CHARS[Math.floor(random() * CODE_CHARS.length) % CODE_CHARS.length];
  return out;
}

/** 入力値が合言葉の形ならそのまま、違えば null（お客様が URL を書き換えた値を通さない） */
export function pickSourceCode(value: unknown): string | null {
  return typeof value === 'string' && SOURCE_CODE_PATTERN.test(value) ? value : null;
}

/** 経路の名前を整える（前後の空白を除く・改行を空白に・40 文字まで）。空なら null */
export function normalizeSourceName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim().slice(0, SOURCE_NAME_MAX);
  return v ? v : null;
}

/** 店舗に配る URL（QR コードの中身） */
export function buildSourceEntryUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${code}`;
}

/** URL に ?src=code を足す（既にクエリがあれば & でつなぐ。# より前に入れる） */
export function appendSourceParam(url: string, code: string | null): string {
  if (!code) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}src=${encodeURIComponent(code)}${hash}`;
}

/**
 * その経路のフォームがどういう状態か。
 * - ok           … 経路を記録できる
 * - needs_deploy … 古い HTML のまま（保存＆デプロイが必要。予約は入るが経路が記録されない）
 * - no_url       … 開く先が無い（LINE フォームで LIFF ID が未設定 / Web フォームで未デプロイ）
 * - missing      … フォームが削除されている
 */
export type SourceFormStatus = 'ok' | 'needs_deploy' | 'no_url' | 'missing';

export interface SourceForm {
  config: FormConfig;
  staticDeploy: StaticDeploy | null;
}

function isWebForm(config: FormConfig): boolean {
  return (config as { form_type?: string }).form_type === 'web';
}

/** 予約フォームを開く URL（?src= を付ける前）。開けないときは null */
export function resolveFormBaseUrl(form: SourceForm | null | undefined, origin: string): string | null {
  if (!form) return null;
  if (isWebForm(form.config)) {
    const raw = (form.staticDeploy?.deploy_url || '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return raw.startsWith('/') ? `${origin.replace(/\/+$/, '')}${raw}` : null;
  }
  const liffId = (form.config.basic_info?.liff_id || '').trim();
  return liffId.length >= 10 ? `https://liff.line.me/${liffId}` : null;
}

export function sourceFormStatus(form: SourceForm | null | undefined, origin: string): SourceFormStatus {
  if (!form) return 'missing';
  if (!resolveFormBaseUrl(form, origin)) return 'no_url';
  return hasDeployedFeature(form.staticDeploy, 'source_code') ? 'ok' : 'needs_deploy';
}

export const SOURCE_FORM_STATUS_MESSAGES: Record<Exclude<SourceFormStatus, 'ok'>, string> = {
  needs_deploy: 'このフォームは古い状態のままです。フォームの編集画面で「更新」を押すと、経路が記録されるようになります（それまでは予約は入りますが、経路は記録されません）。',
  no_url: 'このフォームを開く URL がありません（LINE フォームは LIFF ID の設定、Web フォームは公開が必要です）。',
  missing: 'このフォームは削除されています。別のフォームを選んでください。',
};

/**
 * `/s/{code}` を開いたときの移動先。
 * 停止中の経路は ?src= を付けない（通常のフォームとして開き、経路は記録しない）。フォームを開けないときは null
 */
export function resolveSourceRedirect(source: Pick<ReservationSource, 'code' | 'active'>, form: SourceForm | null | undefined, origin: string): string | null {
  const base = resolveFormBaseUrl(form, origin);
  if (!base) return null;
  return appendSourceParam(base, source.active ? source.code : null);
}

/** 検索ロボットやリンクの下見（SNS・メッセージアプリのプレビュー）らしいアクセスか。「読まれた数」に数えない */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|monitor|curl|wget|python-requests|go-http-client/.test(ua);
}

/** 入力の検証（作成・更新で共通）。エラーなら日本語のメッセージ */
export function validateSourceInput(input: { name?: unknown; form_id?: unknown }, opts: { requireAll: boolean }): { ok: true; name?: string; form_id?: string } | { ok: false; error: string } {
  const out: { ok: true; name?: string; form_id?: string } = { ok: true };
  if (opts.requireAll || input.name !== undefined) {
    const name = normalizeSourceName(input.name);
    if (!name) return { ok: false, error: '経路の名前を入力してください（例: 店頭ポップ、Instagram）' };
    out.name = name;
  }
  if (opts.requireAll || input.form_id !== undefined) {
    if (typeof input.form_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.form_id)) return { ok: false, error: '予約フォームを選んでください' };
    out.form_id = input.form_id;
  }
  return out;
}
