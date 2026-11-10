/**
 * LINE メッセージの分岐ボタンの回答（サーバー専用。fs / Supabase）
 * - 記録: `line_flex_answers`（local は data/line_flex_answers.json）。1 回押す = 1 行
 * - 選択肢のタグを、押したお客様の顧客レコードへ付ける（顧客は LINE ユーザー ID で検索。無ければ何もしない）
 * - 記録・タグ付けに失敗しても、次のメッセージの返信は止めない
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { findCustomerByLineOrPhone, updateCustomer } from '@/lib/customer-utils';
import { mergeCustomerTags } from '@/lib/survey-tags';
import type { LineFlexAnswerRow } from '@/lib/line-flex-branch';
import type { LineFlexBranch } from '@/types/line-flex';

const FILE = 'line_flex_answers.json';
const PAGE = 1000;

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}
function dataFile(): string {
  return path.join(process.cwd(), 'data', FILE);
}
function readAll(): LineFlexAnswerRow[] {
  try {
    const f = dataFile();
    if (!fs.existsSync(f)) return [];
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as LineFlexAnswerRow[]) : [];
  } catch {
    return [];
  }
}
function writeAll(rows: LineFlexAnswerRow[]) {
  const dir = path.dirname(dataFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(rows, null, 2));
}
function client() {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c as any;
}

/** 選んだお客様の顧客レコードにタグを足す（顧客が無ければ何もしない）。足したタグを返す */
export async function applyTagsToLineCustomer(storeId: string, lineUserId: string, tags: string[]): Promise<string[]> {
  if (!lineUserId || tags.length === 0) return [];
  const customer = await findCustomerByLineOrPhone(storeId, lineUserId, null);
  if (!customer) return [];
  const before = Array.isArray(customer.tags) ? customer.tags : [];
  const merged = mergeCustomerTags(customer.tags, tags);
  const changed = merged.length !== before.length || merged.some((t, i) => before[i] !== t);
  if (changed) await updateCustomer(customer.id, { tags: merged });
  return changed ? merged.filter((t) => !before.includes(t)) : [];
}

/** ボタンが押されたことを記録し、タグを付ける。どちらも失敗は握りつぶす（ログのみ） */
export async function recordLineFlexAnswer(params: { storeId: string; messageId: string; key: string; branch: LineFlexBranch; lineUserId: string }): Promise<void> {
  const { storeId, messageId, key, branch, lineUserId } = params;
  const row: LineFlexAnswerRow = {
    id: randomUUID(),
    store_id: storeId,
    message_id: messageId,
    button_key: key,
    question: branch.question ?? '',
    label: branch.label ?? '',
    line_user_id: lineUserId,
    created_at: new Date().toISOString(),
  };
  try {
    if (isLocal()) {
      const rows = readAll();
      rows.push(row);
      writeAll(rows);
    } else {
      const { error } = await client().from('line_flex_answers').insert(row);
      if (error) console.warn('[line-flex] 回答の記録に失敗:', error.message);
    }
  } catch (e) {
    console.warn('[line-flex] 回答の記録に失敗:', e);
  }
  try {
    await applyTagsToLineCustomer(storeId, lineUserId, branch.tags ?? []);
  } catch (e) {
    console.warn('[line-flex] 回答のタグ付けに失敗:', e);
  }
}

/** メッセージの回答すべて（集計用。1000 件ずつ全件） */
export async function listLineFlexAnswers(storeId: string, messageId: string): Promise<LineFlexAnswerRow[]> {
  if (isLocal()) return readAll().filter((r) => r.store_id === storeId && r.message_id === messageId);
  const out: LineFlexAnswerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client()
      .from('line_flex_answers')
      .select('id, store_id, message_id, button_key, question, label, line_user_id, created_at')
      .eq('store_id', storeId)
      .eq('message_id', messageId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`回答の取得に失敗しました: ${error.message}`);
    const rows = (data ?? []) as LineFlexAnswerRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** お客様（LINE ユーザー）の回答を新しい順に（顧客詳細用） */
export async function listLineFlexAnswersByUser(storeId: string, lineUserId: string, limit = 100): Promise<LineFlexAnswerRow[]> {
  if (!lineUserId) return [];
  if (isLocal()) {
    return readAll()
      .filter((r) => r.store_id === storeId && r.line_user_id === lineUserId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await client()
    .from('line_flex_answers')
    .select('id, store_id, message_id, button_key, question, label, line_user_id, created_at')
    .eq('store_id', storeId)
    .eq('line_user_id', lineUserId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`回答の取得に失敗しました: ${error.message}`);
  return (data ?? []) as LineFlexAnswerRow[];
}
