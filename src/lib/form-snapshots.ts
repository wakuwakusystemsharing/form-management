/**
 * 予約フォーム設定のスナップショット（元に戻す用）— サーバー専用（fs / Supabase に依存）
 *
 * 「更新」「他のフォームにも反映」「復元」で config を上書きする直前に、上書き前の config 全体を保存する。
 * フォームごとに直近 MAX_SNAPSHOTS_PER_FORM 件だけ保持する。
 * local 環境は data/form_config_snapshots.json。
 */
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import type { FormConfig } from '@/types/form';

export type SnapshotReason = 'update' | 'sync' | 'restore';

export interface FormConfigSnapshot {
  id: string;
  store_id: string;
  form_id: string;
  form_type: 'reservation';
  config: FormConfig;
  reason: SnapshotReason;
  reason_label: string | null;
  source_form_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  created_at: string;
}

/** 一覧用（config を含めない） */
export type FormConfigSnapshotSummary = Omit<FormConfigSnapshot, 'config'>;

export const MAX_SNAPSHOTS_PER_FORM = 20;

export const SNAPSHOT_REASON_LABELS: Record<SnapshotReason, string> = {
  update: '更新前',
  sync: '他のフォームからの反映前',
  restore: '復元前',
};

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'form_config_snapshots.json');

function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}

function readLocal(): FormConfigSnapshot[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: FormConfigSnapshot[]) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(rows, null, 2));
}

function requireAdminClient() {
  const client = createAdminClient();
  if (!client) throw new Error('Supabase 接続エラー');
  return client;
}

function toSummary(row: FormConfigSnapshot): FormConfigSnapshotSummary {
  const { config: _config, ...rest } = row;
  return rest;
}

export interface CreateSnapshotInput {
  store_id: string;
  form_id: string;
  config: FormConfig;
  reason: SnapshotReason;
  reason_label?: string | null;
  source_form_id?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
}

/** スナップショットを 1 件保存し、フォームごとの保持数を超えた古い行を削除する */
export async function createFormSnapshot(input: CreateSnapshotInput): Promise<FormConfigSnapshotSummary> {
  const now = new Date().toISOString();
  if (isLocal()) {
    const rows = readLocal();
    const row: FormConfigSnapshot = {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      store_id: input.store_id,
      form_id: input.form_id,
      form_type: 'reservation',
      config: JSON.parse(JSON.stringify(input.config)),
      reason: input.reason,
      reason_label: input.reason_label ?? SNAPSHOT_REASON_LABELS[input.reason],
      source_form_id: input.source_form_id ?? null,
      actor_user_id: input.actor_user_id ?? null,
      actor_email: input.actor_email ?? null,
      created_at: now,
    };
    const same = rows.filter((r) => r.form_id === input.form_id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const keepIds = new Set([row.id, ...same.slice(0, MAX_SNAPSHOTS_PER_FORM - 1).map((r) => r.id)]);
    const next = [row, ...rows].filter((r) => r.form_id !== input.form_id || keepIds.has(r.id));
    writeLocal(next);
    return toSummary(row);
  }

  const client = requireAdminClient();
  const { data, error } = await (client as any)
    .from('form_config_snapshots')
    .insert([{
      store_id: input.store_id,
      form_id: input.form_id,
      form_type: 'reservation',
      config: input.config,
      reason: input.reason,
      reason_label: input.reason_label ?? SNAPSHOT_REASON_LABELS[input.reason],
      source_form_id: input.source_form_id ?? null,
      actor_user_id: input.actor_user_id ?? null,
      actor_email: input.actor_email ?? null,
    }])
    .select('id, store_id, form_id, form_type, reason, reason_label, source_form_id, actor_user_id, actor_email, created_at')
    .single();
  if (error || !data) throw new Error(`スナップショットの保存に失敗しました: ${error?.message || 'unknown'}`);

  // 保持数を超えた古い行を削除（失敗しても保存自体は成功扱い）
  try {
    const { data: olds } = await (client as any)
      .from('form_config_snapshots')
      .select('id')
      .eq('form_id', input.form_id)
      .order('created_at', { ascending: false })
      .range(MAX_SNAPSHOTS_PER_FORM, MAX_SNAPSHOTS_PER_FORM + 200);
    const ids = (olds || []).map((r: { id: string }) => r.id);
    if (ids.length > 0) await (client as any).from('form_config_snapshots').delete().in('id', ids);
  } catch (e) {
    console.warn('[form-snapshots] prune failed:', e);
  }
  return data as FormConfigSnapshotSummary;
}

/** フォームのスナップショット一覧（新しい順。config は含めない） */
export async function listFormSnapshots(formId: string, limit = MAX_SNAPSHOTS_PER_FORM): Promise<FormConfigSnapshotSummary[]> {
  if (isLocal()) {
    return readLocal()
      .filter((r) => r.form_id === formId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, limit)
      .map(toSummary);
  }
  const client = requireAdminClient();
  const { data, error } = await (client as any)
    .from('form_config_snapshots')
    .select('id, store_id, form_id, form_type, reason, reason_label, source_form_id, actor_user_id, actor_email, created_at')
    .eq('form_id', formId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`スナップショットの取得に失敗しました: ${error.message}`);
  return (data || []) as FormConfigSnapshotSummary[];
}

/** スナップショット 1 件（config 付き）。フォーム ID が一致しないものは返さない */
export async function getFormSnapshot(formId: string, snapshotId: string): Promise<FormConfigSnapshot | null> {
  if (isLocal()) {
    return readLocal().find((r) => r.id === snapshotId && r.form_id === formId) ?? null;
  }
  const client = requireAdminClient();
  const { data, error } = await (client as any)
    .from('form_config_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .eq('form_id', formId)
    .maybeSingle();
  if (error) throw new Error(`スナップショットの取得に失敗しました: ${error.message}`);
  return (data as FormConfigSnapshot) ?? null;
}
