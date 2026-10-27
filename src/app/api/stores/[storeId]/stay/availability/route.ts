/**
 * GET /api/stores/{storeId}/stay/availability?form_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&guests=
 *
 * 宿泊モードの夜ごとの空き状況と料金（公開。認証なし）。
 * 返すのは { available, remaining, price, reason } だけで、予定のタイトルや予約者は返さない。
 * 料金は静的 HTML に焼き込まず（再デプロイ / 公開プロキシのキャッシュで古くなる）ここで計算して返す。
 * guests は { "<category_id>": n } の JSON 文字列、または "adult:2,child:1" 形式。省略時は各区分の最小人数
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStayNightStatus, loadStayFormConfig } from '@/lib/stay-service';
import { diffDays, isDateString, type GuestCounts } from '@/lib/stay-pricing';
import { normalizeGuestCounts } from '@/lib/stay-reservation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SPAN_DAYS = 93;

function parseGuests(raw: string | null): unknown {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  }
  const out: Record<string, number> = {};
  for (const part of s.split(',')) {
    const [k, v] = part.split(':');
    if (k && v !== undefined && Number.isFinite(Number(v))) out[k.trim()] = Number(v);
  }
  return out;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const url = new URL(req.url);
  const formId = url.searchParams.get('form_id') || '';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';

  if (!formId) return NextResponse.json({ error: 'form_id は必須です' }, { status: 400 });
  if (!isDateString(from) || !isDateString(to) || to < from) {
    return NextResponse.json({ error: 'from / to は YYYY-MM-DD で、to は from 以降にしてください' }, { status: 400 });
  }
  if (diffDays(from, to) > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: `期間は最大 ${MAX_SPAN_DAYS} 日までです` }, { status: 400 });
  }

  const config = await loadStayFormConfig(storeId, formId);
  if (!config) return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
  if (config.calendar_settings?.booking_mode !== 'stay' || !config.calendar_settings.stay_settings) {
    return NextResponse.json({ error: 'このフォームは宿泊モードではありません' }, { status: 400 });
  }

  const counts: GuestCounts = normalizeGuestCounts(config.calendar_settings.stay_settings, parseGuests(url.searchParams.get('guests')));

  try {
    const result = await getStayNightStatus({ storeId, config, from, to, counts });
    const s = result.settings;
    return NextResponse.json(
      {
        from,
        to,
        guests: counts,
        nights: result.status,
        settings: {
          check_in_time: s.check_in_time,
          check_out_time: s.check_out_time,
          check_in_time_options: s.check_in_time_options || [],
          min_nights: s.min_nights,
          max_nights: s.max_nights,
          show_price_on_calendar: s.show_price_on_calendar,
          price_note: s.price_note || '',
          // 連泊割引はフォームが見積もり表示に使う（料金表と同じく再デプロイなしで反映）
          long_stay_discounts: s.pricing.long_stay_discounts || [],
        },
        calendar_degraded: result.calendar_degraded,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('[stay] availability error:', e);
    return NextResponse.json({ error: '空き状況の取得に失敗しました' }, { status: 500 });
  }
}
