/**
 * フォーム操作履歴（監査ログ）
 *
 * 予約フォーム / アンケートフォームの 作成・更新・保存＆デプロイ・複製・削除 を記録する。
 * 「店舗側が編集して挙動がおかしくなった」といった問い合わせ時のエビデンスとして、
 * いつ・誰が（メール / ロール）・どこから・何を変えたか（セクション単位の before/after）を残す。
 *
 * 記録処理は本体の API を失敗させてはならないため、例外はすべて握りつぶしてログ出力のみ行う。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getCurrentUserRole } from '@/lib/auth-helper';
import { normalizeForm } from '@/lib/form-normalizer';
import { normalizeLotteryConfig } from '@/lib/lottery-normalizer';

export type FormAuditAction = 'create' | 'update' | 'deploy' | 'duplicate' | 'delete';
export type FormAuditFormType = 'reservation' | 'survey' | 'lottery';

export interface FormAuditChange {
  key: string;      // 変更したセクション / 項目のキー
  label: string;    // 日本語ラベル
  before: unknown;
  after: unknown;
}

export interface FormAuditEntry {
  id: string;
  store_id: string;
  form_id: string;
  form_type: FormAuditFormType;
  action: FormAuditAction;
  form_name: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  source: string | null;
  summary: string | null;
  changes: FormAuditChange[] | null;
  created_at: string;
}

export const FORM_AUDIT_ACTION_LABELS: Record<FormAuditAction, string> = {
  create: '作成',
  update: '保存（更新）',
  deploy: '保存＆デプロイ（更新）',
  duplicate: '複製',
  delete: '削除',
};

// 予約フォーム config の各セクションの日本語ラベル
const RESERVATION_SECTION_LABELS: Record<string, string> = {
  basic_info: '基本情報',
  form_type: 'フォームタイプ',
  menu_structure: 'メニュー構成',
  calendar_settings: '営業時間・ルール',
  custom_fields: 'カスタムフィールド',
  staff_selection: 'スタッフ選択',
  content_blocks: '画像orテキスト設置',
  line_message_items: '送信時の項目編集',
  notification_messages: '通知メッセージ',
  reservation_summary: 'ご予約内容（サマリー）',
  gender_selection: '性別選択',
  visit_count_selection: 'ご来店回数',
  coupon_selection: 'クーポン',
  visit_options: '来店オプション',
  ui_settings: 'UI設定',
  validation_rules: '入力ルール',
  design: 'デザイン',
};

// アンケートフォーム config の各セクションの日本語ラベル
const SURVEY_SECTION_LABELS: Record<string, string> = {
  basic_info: '基本情報',
  questions: '質問',
  ui_settings: 'UI設定',
  design: 'デザイン',
};

// 抽選フォーム config の各セクションの日本語ラベル
const LOTTERY_SECTION_LABELS: Record<string, string> = {
  lottery_type: '抽選方式',
  redeem_method: '引換方式',
  basic_info: '基本情報',
  deferred: '後日抽選の設定',
  prizes: '賞品と確率',
  consolation_prize: '残念賞',
  entry_rules: '参加条件',
  presentation: '演出・デザイン',
  messages: 'メッセージ',
  ui_settings: 'UI設定',
};

// フォーム行レベルの項目
const FORM_LEVEL_LABELS: Record<string, string> = {
  status: '公開ステータス',
  form_name: 'フォーム名',
  name: 'フォーム名',
};

const DATA_DIR = path.join(process.cwd(), 'data');
const LOCAL_LOG_FILE = path.join(DATA_DIR, 'form_audit_logs.json');

function parseConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stable(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * フォームの before / after からセクション単位の差分を作る。
 * before / after はフォーム行（{ config, status, form_name / name }）または config そのもの。
 */
export function diffFormForAudit(
  formType: FormAuditFormType,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): FormAuditChange[] {
  const changes: FormAuditChange[] = [];
  const b = before || {};
  const a = after || {};

  // フォーム行レベル（config を持つ行かどうかで判定）
  const isRow = (v: Record<string, unknown>) => 'config' in v || 'status' in v;
  let beforeConfig = parseConfig(isRow(b) ? b.config : b);
  let afterConfig = parseConfig(isRow(a) ? a.config : a);
  // 予約フォームは両側を normalizeForm で揃えてから比較する
  // （保存経路によってデフォルト値の有無が違い、実際には変えていないセクションが差分に混ざるため）
  if (formType === 'reservation') {
    try {
      beforeConfig = normalizeForm({ id: '', store_id: '', config: beforeConfig }).config as unknown as Record<string, unknown>;
      afterConfig = normalizeForm({ id: '', store_id: '', config: afterConfig }).config as unknown as Record<string, unknown>;
    } catch {
      /* 正規化に失敗した場合は生の config で比較 */
    }
  }

  if (isRow(b) || isRow(a)) {
    // 公開ステータス
    if (('status' in b || 'status' in a) && stable(b.status) !== stable(a.status)) {
      changes.push({ key: 'status', label: FORM_LEVEL_LABELS.status, before: b.status ?? null, after: a.status ?? null });
    }
    // フォーム名: 保存形式によって置き場所（行の form_name / name、config 内）が違うため表示名に統一して比較
    const nameOf = (row: Record<string, unknown>, cfg: Record<string, unknown>): string | null => {
      const bi = (cfg.basic_info || {}) as Record<string, unknown>;
      const v = (typeof bi.form_name === 'string' && bi.form_name)
        || (typeof bi.title === 'string' && bi.title)
        || (typeof row.form_name === 'string' && row.form_name)
        || (typeof row.name === 'string' && row.name)
        || null;
      return v || null;
    };
    const beforeName = nameOf(b, beforeConfig);
    const afterName = nameOf(a, afterConfig);
    if (beforeName !== afterName && (beforeName || afterName)) {
      changes.push({ key: 'form_name', label: FORM_LEVEL_LABELS.form_name, before: beforeName, after: afterName });
    }
  }

  // 抽選フォームも両側を正規化してから比較する（欠落フィールドの既定値補完による偽の差分を防ぐ）
  if (formType === 'lottery') {
    try {
      beforeConfig = normalizeLotteryConfig(beforeConfig) as unknown as Record<string, unknown>;
      afterConfig = normalizeLotteryConfig(afterConfig) as unknown as Record<string, unknown>;
    } catch {
      /* 正規化に失敗した場合は生の config で比較 */
    }
  }

  const labels = formType === 'survey'
    ? SURVEY_SECTION_LABELS
    : formType === 'lottery'
      ? LOTTERY_SECTION_LABELS
      : RESERVATION_SECTION_LABELS;
  const keys = new Set([...Object.keys(beforeConfig), ...Object.keys(afterConfig)]);
  for (const key of keys) {
    if (stable(beforeConfig[key]) !== stable(afterConfig[key])) {
      changes.push({
        key,
        label: labels[key] || key,
        before: beforeConfig[key] ?? null,
        after: afterConfig[key] ?? null,
      });
    }
  }
  return changes;
}

/** Referer からどの画面からの操作かを推定する（ロールが主、これは補助情報） */
function detectSource(request: Request): string {
  const referer = request.headers.get('referer') || '';
  try {
    const p = new URL(referer).pathname;
    if (p.startsWith('/tenant/')) return 'tenant_admin';
    if (p.startsWith('/master-admin')) return 'master_admin';
    if (/^\/[^/]+\/(admin|forms|surveys)(\/|$)/.test(p)) return 'store_admin';
  } catch {
    /* referer なし */
  }
  return 'unknown';
}

export function buildAuditSummary(action: FormAuditAction, changes: FormAuditChange[], note?: string): string {
  const parts: string[] = [];
  if (action === 'update' || action === 'deploy') {
    parts.push(changes.length > 0 ? `${changes.map(c => c.label).join('、')} を変更` : '変更なし（保存のみ）');
  } else {
    parts.push(FORM_AUDIT_ACTION_LABELS[action]);
  }
  if (note) parts.push(note);
  return parts.join(' / ');
}

/**
 * 操作履歴を 1 件記録する。失敗しても呼び出し元には影響させない。
 */
export async function logFormAudit(
  request: Request,
  params: {
    storeId: string;
    formId: string;
    formType: FormAuditFormType;
    action: FormAuditAction;
    formName?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string;
  }
): Promise<void> {
  try {
    const changes = (params.action === 'update' || params.action === 'deploy')
      ? diffFormForAudit(params.formType, params.before, params.after)
      : [];
    const summary = buildAuditSummary(params.action, changes, params.note);

    let actor: { userId: string | null; email: string | null; role: string | null } = { userId: null, email: null, role: null };
    try {
      const roleInfo = await getCurrentUserRole(request);
      if (roleInfo) {
        actor = { userId: roleInfo.userId, email: roleInfo.email || null, role: roleInfo.role || 'unknown' };
      }
    } catch {
      /* 認証情報が取れなくても記録は続行 */
    }

    const entry = {
      store_id: params.storeId,
      form_id: params.formId,
      form_type: params.formType,
      action: params.action,
      form_name: params.formName || null,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role: actor.role,
      source: detectSource(request),
      summary,
      changes: changes.length > 0 ? changes : null,
    };

    const env = getAppEnvironment();
    if (env === 'local') {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const logs = fs.existsSync(LOCAL_LOG_FILE) ? JSON.parse(fs.readFileSync(LOCAL_LOG_FILE, 'utf-8')) : [];
      logs.push({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
        actor_email: entry.actor_email || 'local',
        actor_role: entry.actor_role || 'local',
        created_at: new Date().toISOString(),
      });
      fs.writeFileSync(LOCAL_LOG_FILE, JSON.stringify(logs, null, 2));
      return;
    }

    const adminClient = createAdminClient();
    if (!adminClient) return;
    const { error } = await (adminClient as any).from('form_audit_logs').insert(entry);
    if (error) {
      console.error('[form-audit] insert error:', error);
    }
  } catch (e) {
    console.error('[form-audit] log error:', e);
  }
}

/** 指定フォームの操作履歴を新しい順に取得 */
export async function listFormAuditLogs(
  storeId: string,
  formId: string,
  formType: FormAuditFormType,
  limit = 100
): Promise<FormAuditEntry[]> {
  const env = getAppEnvironment();
  if (env === 'local') {
    if (!fs.existsSync(LOCAL_LOG_FILE)) return [];
    const logs = JSON.parse(fs.readFileSync(LOCAL_LOG_FILE, 'utf-8')) as FormAuditEntry[];
    return logs
      .filter(l => l.store_id === storeId && l.form_id === formId && l.form_type === formType)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
  }

  const adminClient = createAdminClient();
  if (!adminClient) return [];
  const { data, error } = await (adminClient as any)
    .from('form_audit_logs')
    .select('*')
    .eq('store_id', storeId)
    .eq('form_id', formId)
    .eq('form_type', formType)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[form-audit] list error:', error);
    return [];
  }
  return (data || []) as FormAuditEntry[];
}
