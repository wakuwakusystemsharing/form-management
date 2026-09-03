import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { listLotteryEntries, listLotteryForms } from '@/lib/lottery-repository';
import { formatDateJst } from '@/lib/lottery-engine';
import type { LotteryEntryEffectiveStatus, LotteryEntryView } from '@/types/lottery';

const STATUS_LABELS: Record<LotteryEntryEffectiveStatus, string> = {
  entered: '応募',
  provisional: '仮当選',
  drawn: '当選',
  lost: 'はずれ',
  redeemed: '引換済み',
  cancelled: '取り消し',
  expired: '期限切れ',
};

function formatDateTimeJst(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}/${p(jst.getUTCMonth() + 1)}/${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  // 先頭が = + - @ のセルは Excel で数式扱いされるため無害化
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function answersToText(answers: Record<string, unknown> | null): string {
  if (!answers) return '';
  return Object.entries(answers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')}`)
    .join('\n');
}

/**
 * GET /api/stores/[storeId]/lotteries/entries/export - 抽選履歴 CSV（UTF-8 BOM 付き）
 *   クエリは一覧 API と同じ（form_id / prize_id / status / search / from / to）。件数上限なし（最大 500 件ずつ取得して連結）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const status = statusParam && statusParam in STATUS_LABELS ? (statusParam as LotteryEntryEffectiveStatus) : 'all';

    const forms = await listLotteryForms(storeId);
    const formTitle = new Map(forms.map((f) => [f.id, f.config.basic_info.title || f.id]));

    const rows: LotteryEntryView[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await listLotteryEntries({
        storeId,
        formId: url.searchParams.get('form_id'),
        prizeId: url.searchParams.get('prize_id'),
        status,
        search: url.searchParams.get('search'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        limit: pageSize,
        offset,
      });
      rows.push(...page.entries);
      if (page.entries.length < pageSize || rows.length >= page.total) break;
    }

    const header = ['日時', '抽選フォーム', 'LINE名', '賞品', '結果', '引換コード', '状態', '有効期限', '引換日時', '備考', '事前質問の回答'];
    const lines = [header.map(csvCell).join(',')];
    for (const e of rows) {
      lines.push([
        formatDateTimeJst(e.entered_at),
        formatTitle(formTitle, e.lottery_form_id),
        e.line_display_name ?? '',
        e.prize_name ?? (e.status === 'entered' ? '' : 'はずれ'),
        e.is_win ? '当選' : e.is_consolation ? '残念賞' : e.status === 'entered' || e.status === 'provisional' ? '' : 'はずれ',
        e.redeem_code ?? '',
        STATUS_LABELS[e.effective_status],
        formatDateJst(e.expires_at),
        formatDateTimeJst(e.redeemed_at),
        e.redeemed_note ?? '',
        answersToText(e.answers),
      ].map(csvCell).join(','));
    }

    const csv = String.fromCharCode(0xfeff) + lines.join('\r\n'); // Excel で文字化けしないよう UTF-8 BOM を付ける
    const filename = `lottery_entries_${storeId}_${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API] Lottery entries export error:', error);
    return NextResponse.json({ error: '抽選履歴の出力に失敗しました' }, { status: 500 });
  }
}

function formatTitle(map: Map<string, string>, formId: string): string {
  return map.get(formId) ?? formId;
}
