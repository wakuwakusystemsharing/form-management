'use client';

// アンケートフォーム 基本情報: Google スプレッドシート連携
// 回答が届くたびに指定したスプレッドシート（タブ）の末尾に 1 行追記する。
// 認証はマスター管理に登録したサービスアカウント。店舗側の作業は「シートをそのメールアドレスに編集者で共有する」だけ。
// ON/OFF トグルが OFF のときは入力欄・ボタンを隠す（設定値は残す）。

import React, { useEffect, useState } from 'react';
import type { SurveyGoogleSheetsSettings } from '@/types/survey';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { isSurveySheetsEnabled, parseSpreadsheetId, SURVEY_SHEET_FIXED_COLUMNS, SURVEY_SHEET_NAME_MAX } from '@/lib/survey-sheets';

interface Props {
  surveyId: string;
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

export default function SurveySheetsSettings({ surveyId, value, onChange }: Props) {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [exportConfirm, setExportConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const enabled = isSurveySheetsEnabled(value);
  const spreadsheetInput = value?.spreadsheet_id ?? '';
  const sheetName = value?.sheet_name ?? '';
  const parsedId = parseSpreadsheetId(spreadsheetInput);
  const inputInvalid = spreadsheetInput.trim() !== '' && !parsedId;
  const ready = enabled && !!parsedId;

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

  const update = (patch: Partial<SurveyGoogleSheetsSettings>) => {
    onChange({ enabled, spreadsheet_id: spreadsheetInput, sheet_name: sheetName, ...patch });
    resetFeedback();
  };

  const toggle = () => {
    onChange({ enabled: !enabled, spreadsheet_id: spreadsheetInput, sheet_name: sheetName });
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
        body: JSON.stringify({ spreadsheet_id: parsedId, sheet_name: sheetName }),
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
          <p className="text-xs text-muted-foreground">
            転記する列: {SURVEY_SHEET_FIXED_COLUMNS.join(' / ')} / 各質問の回答。見出し行は自動で作られ、質問を増やすと右端に列が足されます。
          </p>

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
