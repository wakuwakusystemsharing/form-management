'use client';

// アンケートフォーム 基本情報: Google スプレッドシート連携
// 回答が届くたびに指定したスプレッドシート（タブ）の末尾に 1 行追記する。
// 認証はマスター管理に登録したサービスアカウント。店舗側の作業は「シートをそのメールアドレスに編集者で共有する」だけ。
// ON/OFF トグルが OFF のときは入力欄・ボタンを隠す（設定値は残す）。
// 「列をカスタマイズ」で 列の ON/OFF・並び順・見出し名 を変えられる（既定 = おすすめ: 固定 4 列 + 質問の順）。

import React, { useEffect, useState } from 'react';
import type { SurveyGoogleSheetsSettings, SurveyQuestion, SurveySheetColumn } from '@/types/survey';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  buildSurveySheetColumnPlan,
  defaultSurveySheetColumnLabel,
  isQuestionColumnKey,
  isSurveySheetsEnabled,
  normalizeSurveySheetColumns,
  parseSpreadsheetId,
  questionColumnKey,
  SURVEY_SHEET_LABEL_MAX,
  SURVEY_SHEET_NAME_MAX,
} from '@/lib/survey-sheets';

interface Props {
  surveyId: string;
  questions: SurveyQuestion[];
  value: SurveyGoogleSheetsSettings | undefined;
  onChange: (next: SurveyGoogleSheetsSettings | undefined) => void;
}

interface StatusInfo {
  service_account_email: string | null;
  unsynced_count: number | null;
}

type TestResult =
  | { kind: 'ok'; title: string; url: string; sheetExists: boolean; sheetTitles: string[] }
  | { kind: 'error'; message: string };

type ExportResult = { kind: 'ok'; exported: number; remaining: number } | { kind: 'error'; message: string };

export default function SurveySheetsSettings({ surveyId, questions, value, onChange }: Props) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [exportConfirm, setExportConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const enabled = isSurveySheetsEnabled(value);
  const spreadsheetInput = value?.spreadsheet_id ?? '';
  const sheetName = value?.sheet_name ?? '';
  const parsedId = parseSpreadsheetId(spreadsheetInput);
  const inputInvalid = spreadsheetInput.trim() !== '' && !parsedId;
  const ready = enabled && !!parsedId;

  // 列: 保存値 + 現在の質問（あとから足した質問は末尾に ON で入る）
  const columns = normalizeSurveySheetColumns(value?.columns, questions);
  const includeUnlisted = value?.include_unlisted !== false;
  const customized = !!value?.columns || value?.include_unlisted === false;
  const plan = buildSurveySheetColumnPlan({ columns: value?.columns, include_unlisted: value?.include_unlisted }, questions);
  const currentQuestionKeys = new Set(questions.map((q) => questionColumnKey(q.title || '')));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/surveys/${surveyId}/sheets`, { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as StatusInfo) : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [surveyId, enabled]);

  const resetFeedback = () => {
    setTestResult(null);
    setExportResult(null);
    setExportConfirm(false);
  };

  const base = (): SurveyGoogleSheetsSettings => ({
    enabled,
    spreadsheet_id: spreadsheetInput,
    sheet_name: sheetName,
    ...(value?.columns ? { columns: value.columns } : {}),
    ...(typeof value?.include_unlisted === 'boolean' ? { include_unlisted: value.include_unlisted } : {}),
  });

  const update = (patch: Partial<SurveyGoogleSheetsSettings>) => {
    onChange({ ...base(), ...patch });
    resetFeedback();
  };

  const toggle = () => update({ enabled: !enabled });

  const setColumns = (next: SurveySheetColumn[]) => update({ columns: next });
  const updateColumn = (key: string, patch: Partial<SurveySheetColumn>) => setColumns(columns.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const moveColumn = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= columns.length) return;
    const next = [...columns];
    [next[index], next[to]] = [next[to], next[index]];
    setColumns(next);
  };
  const removeColumn = (key: string) => setColumns(columns.filter((c) => c.key !== key));
  const resetColumns = () => {
    const next = base();
    delete next.columns;
    delete next.include_unlisted;
    onChange(next);
    resetFeedback();
  };

  // URL を貼ったら ID に置き換える（フォーカスが外れたとき）
  const normalizeInput = () => {
    if (parsedId && parsedId !== spreadsheetInput) update({ spreadsheet_id: parsedId });
  };

  const copyEmail = async () => {
    if (!status?.service_account_email) return;
    try {
      await navigator.clipboard.writeText(status.service_account_email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボード不可は無視 */
    }
  };

  const runTest = async () => {
    if (!parsedId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/surveys/${surveyId}/sheets/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ spreadsheet_id: parsedId, sheet_name: sheetName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestResult({ kind: 'error', message: json.error || '接続確認に失敗しました' });
      } else {
        setTestResult({ kind: 'ok', title: json.title, url: json.url, sheetExists: json.sheet_exists !== false, sheetTitles: json.sheet_titles || [] });
      }
    } catch {
      setTestResult({ kind: 'error', message: '接続確認に失敗しました（通信エラー）' });
    } finally {
      setTesting(false);
    }
  };

  const runExport = async () => {
    if (!parsedId) return;
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch(`/api/surveys/${surveyId}/sheets/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ spreadsheet_id: parsedId, sheet_name: sheetName, columns: value?.columns, include_unlisted: value?.include_unlisted }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExportResult({ kind: 'error', message: json.error || '書き出しに失敗しました' });
      } else {
        setExportResult({ kind: 'ok', exported: json.exported ?? 0, remaining: json.remaining ?? 0 });
        setStatus((prev) => (prev ? { ...prev, unsynced_count: json.remaining ?? 0 } : prev));
      }
    } catch {
      setExportResult({ kind: 'error', message: '書き出しに失敗しました（通信エラー）' });
    } finally {
      setExporting(false);
      setExportConfirm(false);
    }
  };

  const email = status?.service_account_email;
  const unsynced = status?.unsynced_count;

  return (
    <div className="space-y-3 pt-2 border-t" data-slot="survey-sheets-settings">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="survey_sheets_enabled">Google スプレッドシート連携</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            ON にすると、回答が届くたびに指定したスプレッドシートの末尾へ 1 行ずつ自動で追記します。
          </p>
        </div>
        <button
          id="survey_sheets_enabled"
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {enabled && (
        <>
          {/* 転記する列 + カスタマイズ */}
          <div className="rounded-md border p-3 text-xs space-y-2" data-slot="survey-sheets-columns">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">転記する列{customized ? '（カスタマイズ済み）' : '（おすすめ）'}</p>
                <p className="text-muted-foreground mt-0.5 break-words">
                  {plan.columns.map((c) => c.header).join(' / ') || '（列がありません）'}
                  {includeUnlisted ? '　＋ 一覧に無い回答（追加質問など）は右端に自動追加' : ''}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => setColumnsOpen((v) => !v)}>
                {columnsOpen ? '閉じる' : '列をカスタマイズ'}
              </Button>
            </div>

            {columnsOpen && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-muted-foreground">
                  チェックで列の ON/OFF、↑↓ で並び順、入力欄で見出し名を変えられます。見出し行は 1 行目にこの名前で作られます。
                  すでに回答が入っているシートで見出し名を変えると、新しい列として右端に追加されます（既存の列はそのまま）。
                </p>
                <ul className="space-y-1">
                  {columns.map((c, index) => {
                    const on = c.enabled !== false;
                    const isQuestion = isQuestionColumnKey(c.key);
                    const deleted = isQuestion && !currentQuestionKeys.has(c.key);
                    return (
                      <li key={c.key} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${on ? 'bg-background' : 'bg-muted/50 text-muted-foreground'}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0"
                          checked={on}
                          onChange={(e) => updateColumn(c.key, { enabled: e.target.checked })}
                          aria-label={`${defaultSurveySheetColumnLabel(c.key)} を転記する`}
                        />
                        <span className="inline-flex items-center gap-1 min-w-0 flex-1 basis-32">
                          <span className="truncate" title={defaultSurveySheetColumnLabel(c.key)}>
                            {isQuestion ? `質問: ${defaultSurveySheetColumnLabel(c.key)}` : defaultSurveySheetColumnLabel(c.key)}
                          </span>
                          {deleted && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800">削除された質問</span>}
                        </span>
                        <Input
                          type="text"
                          value={c.label ?? ''}
                          maxLength={SURVEY_SHEET_LABEL_MAX}
                          onChange={(e) => updateColumn(c.key, { label: e.target.value })}
                          placeholder={`見出し: ${defaultSurveySheetColumnLabel(c.key)}`}
                          className="h-7 text-xs flex-1 basis-40 min-w-[8rem]"
                          disabled={!on}
                        />
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label="上へ">↑</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === columns.length - 1} onClick={() => moveColumn(index, 1)} aria-label="下へ">↓</Button>
                          {deleted && (
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs text-destructive" onClick={() => removeColumn(c.key)}>
                              一覧から外す
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={includeUnlisted}
                    onChange={(e) => update({ include_unlisted: e.target.checked })}
                  />
                  <span>一覧に無い回答（選択肢の追加質問など）も右端に自動で列を足して転記する</span>
                </label>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground">おすすめ: 回答日時 / LINE表示名 / LINEユーザーID / 回答ID のあとに質問の順。</p>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={!customized} onClick={resetColumns}>
                    おすすめに戻す
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium">事前準備（1 回だけ）</p>
            <p>
              スプレッドシートの「共有」で、次のメールアドレスを<span className="font-medium">「編集者」</span>として追加してください。
              他のアカウントから共有されたシートも、wakuwakusystemsharing@gmail.com から再共有できれば使えます。
            </p>
            {email ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-background px-2 py-1 break-all select-all">{email}</code>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={copyEmail}>
                  {copied ? 'コピーしました' : 'コピー'}
                </Button>
              </div>
            ) : status ? (
              <p className="text-destructive">Google サービスアカウントが設定されていません（マスター管理 → 設定 で登録してください）</p>
            ) : (
              <p className="text-muted-foreground">共有先のメールアドレスを取得中…</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="survey_sheets_id" className="text-xs">スプレッドシートの ID（URL を貼り付けても OK）</Label>
            <Input
              id="survey_sheets_id"
              type="text"
              value={spreadsheetInput}
              onChange={(e) => update({ spreadsheet_id: e.target.value })}
              onBlur={normalizeInput}
              placeholder="例: https://docs.google.com/spreadsheets/d/1AbC…/edit"
              className={inputInvalid ? 'border-destructive' : undefined}
            />
            {inputInvalid && <p className="text-xs text-destructive">スプレッドシートの ID または URL として読み取れません</p>}
            {!inputInvalid && !parsedId && (
              <p className="text-xs text-amber-700">ID が未入力のため、ON でもまだ転記されません</p>
            )}
            {!inputInvalid && parsedId && parsedId !== spreadsheetInput.trim() && (
              <p className="text-xs text-muted-foreground">ID: <code>{parsedId}</code>（保存時にこの ID が使われます）</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="survey_sheets_tab" className="text-xs">シート名（タブ。空欄なら 1 枚目のタブ）</Label>
            <Input
              id="survey_sheets_tab"
              type="text"
              value={sheetName}
              maxLength={SURVEY_SHEET_NAME_MAX}
              onChange={(e) => update({ sheet_name: e.target.value })}
              placeholder="例: 回答"
            />
            <p className="text-xs text-muted-foreground">指定したタブが無ければ自動で作ります。1 つのスプレッドシートに複数のアンケートをタブ分けで集められます。</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!ready || testing} onClick={runTest}>
              {testing ? '確認中…' : '接続を確認'}
            </Button>
            {!exportConfirm ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!ready || exporting || unsynced === 0}
                onClick={() => {
                  setExportResult(null);
                  setExportConfirm(true);
                }}
              >
                過去の回答を書き出す{typeof unsynced === 'number' ? `（未転記 ${unsynced} 件）` : ''}
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                <span>
                  まだ転記していない回答{typeof unsynced === 'number' ? ` ${unsynced} 件` : ''}を、このスプレッドシートの末尾に追記します。よろしいですか？
                </span>
                <Button type="button" size="sm" className="h-7 text-xs" disabled={exporting} onClick={runExport}>
                  {exporting ? '書き出し中…' : '書き出す'}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={exporting} onClick={() => setExportConfirm(false)}>
                  やめる
                </Button>
              </div>
            )}
          </div>

          {testResult?.kind === 'ok' && (
            <div className="rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-900 space-y-1">
              <p>
                接続できました: <a href={testResult.url} target="_blank" rel="noreferrer" className="underline">{testResult.title || 'スプレッドシート'}</a>
              </p>
              {sheetName.trim() && (
                <p>
                  {testResult.sheetExists
                    ? `タブ「${sheetName.trim()}」が見つかりました`
                    : `タブ「${sheetName.trim()}」はまだありません（最初の回答のときに自動で作ります）`}
                </p>
              )}
              {testResult.sheetTitles.length > 0 && <p className="text-green-800/80">既存のタブ: {testResult.sheetTitles.join(' / ')}</p>}
            </div>
          )}
          {testResult?.kind === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{testResult.message}</div>
          )}
          {exportResult?.kind === 'ok' && (
            <div className="rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-900">
              {exportResult.exported} 件を書き出しました
              {exportResult.remaining > 0 ? `（残り ${exportResult.remaining} 件。もう一度押すと続きを書き出します）` : ''}
            </div>
          )}
          {exportResult?.kind === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{exportResult.message}</div>
          )}

          {ready && (
            <p className="text-xs text-muted-foreground">
              ※ 今後の回答を自動で転記するには、このあと「更新」でフォームを保存してください。フォームの再デプロイは不要です。
            </p>
          )}
        </>
      )}
    </div>
  );
}
