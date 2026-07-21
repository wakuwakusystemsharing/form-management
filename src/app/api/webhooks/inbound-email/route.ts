// 外部予約メール連携: Resend Inbound Webhook（email.received）
//
// フロー（設計書 2-2）:
//   1. svix 署名検証（RESEND_INBOUND_WEBHOOK_SECRET）
//   2. 宛先 rsv-{token}@… から店舗を特定
//   3. Webhook は本文を含まないため Received Emails API で本文を取得
//   4. 媒体判定 → パーサーで解析
//   5. 所要時間を決定（メール本文 → キーワードルール → デフォルト）
//   6. 重複チェック（store_id + source + 予約番号）
//   7. external_reservations に記録 → Googleカレンダーにイベント作成
//
// 解析失敗・未対応媒体・Gmail転送確認メールも必ず記録する（管理画面で確認するため）

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { createGenericCalendarEvent } from '@/lib/google-calendar';
import { detectMailSource, parseExternalMail, ParsedReservation } from '@/lib/external-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ===== svix 署名検証（Resend Webhook は svix 形式） =====
function verifySvixSignature(
  secret: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  payload: string
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  // タイムスタンプの新しさ（±5分）でリプレイ攻撃を防ぐ
  const ts = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // svix-signature は "v1,署名 v1,署名..." のスペース区切り
  return svixSignature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

// ===== Received Emails API で本文を取得 =====
// 失敗時は詳細（HTTPステータス等）を返し、Webhook レスポンスで確認できるようにする
type FetchMailResult =
  | { ok: true; from: string; to: string[]; subject: string; text: string; html: string }
  | { ok: false; detail: string };

async function fetchReceivedEmail(emailId: string): Promise<FetchMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, detail: 'RESEND_API_KEY が未設定です' };
  }
  // ドキュメント上は /emails/receiving/{id}。旧パス表記の可能性に備え /emails/received/{id} も試す
  const paths = [
    `https://api.resend.com/emails/receiving/${emailId}`,
    `https://api.resend.com/emails/received/${emailId}`,
  ];
  let lastDetail = '';
  for (const url of paths) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        from: data.from || '',
        to: Array.isArray(data.to) ? data.to : [data.to].filter(Boolean),
        subject: data.subject || '',
        text: data.text || '',
        html: data.html || '',
      };
    }
    const bodyText = (await res.text()).slice(0, 300);
    lastDetail = `${res.status} ${bodyText}`;
    console.error(`[inbound-email] 受信メール取得失敗: ${url} → ${lastDetail}`);
    if (res.status !== 404) break; // 404 のときだけ別パスを試す
  }
  return { ok: false, detail: lastDetail };
}

// HTMLメールしか無い場合の簡易テキスト化
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ===== 所要時間の決定（設計書 3 章の優先順位） =====
async function resolveDurationMinutes(
  adminClient: any,
  storeId: string,
  parsed: ParsedReservation,
  defaultMinutes: number
): Promise<number> {
  // ① メール本文に記載があればそれを使う
  if (parsed.durationMinutesFromMail && parsed.durationMinutesFromMail > 0) {
    return parsed.durationMinutesFromMail;
  }
  // ② メニュー名キーワードルール（sort_order 昇順で最初に一致）
  if (parsed.menuText) {
    const { data: rules } = await adminClient
      .from('menu_duration_rules')
      .select('keyword,duration_minutes')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: true });
    for (const rule of rules || []) {
      if (rule.keyword && parsed.menuText.includes(rule.keyword)) {
        return rule.duration_minutes;
      }
    }
  }
  // ③ デフォルト
  return defaultMinutes > 0 ? defaultMinutes : 60;
}

// イベントタイトル（Q4-A: 参考GASと同じ形式）
function buildEventTitle(parsed: ParsedReservation): string {
  const prefix = parsed.source === 'salonboard' ? 'HPB予約' : 'エキテン予約';
  return `${prefix}, ${parsed.customerName || 'お客様'}`;
}

function buildEventDescription(parsed: ParsedReservation): string {
  const sourceName = parsed.source === 'salonboard' ? 'HOT PEPPER Beauty（サロンボード）' : 'エキテン ネット予約';
  const lines = [
    '◇ご予約内容（外部予約メール連携で自動登録）',
    `■媒体`,
    sourceName,
    `■予約番号`,
    parsed.reservationNumber || '-',
    `■氏名`,
    parsed.customerName || '-',
    `■メニュー`,
    parsed.menuText || '-',
    `■スタッフ`,
    parsed.staffText || '-',
    `■ご利用クーポン`,
    parsed.couponText || '-',
  ];
  if (parsed.totalAmountText) {
    lines.push('■合計金額', parsed.totalAmountText);
  }
  if (parsed.customerPhone) {
    lines.push('■電話番号', parsed.customerPhone);
  }
  if (parsed.requestText) {
    lines.push('■ご要望・ご相談', parsed.requestText);
  }
  return lines.join('\n');
}

export async function POST(request: Request) {
  try {
    const payload = await request.text();

    // 1. 署名検証
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[inbound-email] RESEND_INBOUND_WEBHOOK_SECRET 未設定');
      return NextResponse.json({ error: 'Webhook シークレットが未設定です' }, { status: 500 });
    }
    const valid = verifySvixSignature(
      secret,
      request.headers.get('svix-id'),
      request.headers.get('svix-timestamp'),
      request.headers.get('svix-signature'),
      payload
    );
    if (!valid) {
      return NextResponse.json({ error: '署名が不正です' }, { status: 401 });
    }

    const event = JSON.parse(payload);
    if (event.type !== 'email.received') {
      return NextResponse.json({ ignored: true });
    }

    const emailId: string | undefined = event.data?.email_id || event.data?.id;
    const toList: string[] = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to].filter(Boolean);
    if (!emailId) {
      return NextResponse.json({ ignored: true, reason: 'email_id なし' });
    }

    // 2. 宛先 rsv-{token}@… から店舗を特定
    const tokenMatch = toList
      .map((addr: string) => /^rsv-([a-z0-9]+)@/i.exec((addr || '').trim()))
      .find(Boolean);
    if (!tokenMatch) {
      // 専用アドレス宛てでないメール（test@ 等）は破棄（Phase 0 のテスト用アドレスを想定）
      console.log(`[inbound-email] 対象外の宛先のためスキップ: ${toList.join(', ')}`);
      return NextResponse.json({ ignored: true, reason: '対象外の宛先' });
    }
    const inboundToken = tokenMatch[1];

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: integration } = await (adminClient as any)
      .from('external_mail_integrations')
      .select('store_id,enabled,default_duration_minutes,target_calendar_id')
      .eq('inbound_token', inboundToken)
      .single();

    if (!integration) {
      console.log(`[inbound-email] トークンに対応する店舗なし: rsv-${inboundToken}`);
      return NextResponse.json({ ignored: true, reason: '店舗が見つかりません' });
    }
    const storeId: string = integration.store_id;

    // 3. 本文を取得
    const mail = await fetchReceivedEmail(emailId);
    if (!mail.ok) {
      return NextResponse.json(
        { error: '受信メールの取得に失敗しました', detail: mail.detail },
        { status: 500 }
      );
    }
    const bodyText = mail.text || htmlToText(mail.html || '');

    // 4. 媒体判定
    const source = detectMailSource(mail.from, mail.subject, bodyText);

    // Gmail 転送確認メール / 未対応媒体: ログのみ記録（イベントは作らない）
    if (source === 'gmail_forwarding' || source === 'unknown') {
      await (adminClient as any).from('external_reservations').insert({
        store_id: storeId,
        source,
        status: 'unknown',
        mail_subject: mail.subject,
        mail_from: mail.from,
        raw_body: bodyText.slice(0, 20000),
        error_message: source === 'gmail_forwarding'
          ? 'Gmail の転送確認メールです。本文内の確認リンク/コードで転送設定を完了してください。'
          : '対応していない媒体のメールのため、カレンダー登録は行いませんでした。',
      });
      return NextResponse.json({ logged: true, source });
    }

    // 連携OFFの店舗はログのみ
    if (integration.enabled !== true) {
      await (adminClient as any).from('external_reservations').insert({
        store_id: storeId,
        source,
        status: 'unknown',
        mail_subject: mail.subject,
        mail_from: mail.from,
        raw_body: bodyText.slice(0, 20000),
        error_message: '連携がOFFのためカレンダー登録をスキップしました。',
      });
      return NextResponse.json({ logged: true, reason: '連携OFF' });
    }

    // 5. 解析
    const result = parseExternalMail(source, bodyText);
    if (!result.ok || !result.reservation) {
      await (adminClient as any).from('external_reservations').insert({
        store_id: storeId,
        source,
        status: 'parse_failed',
        mail_subject: mail.subject,
        mail_from: mail.from,
        raw_body: bodyText.slice(0, 20000),
        error_message: result.error || '解析に失敗しました',
      });
      return NextResponse.json({ logged: true, parse: 'failed' });
    }
    const parsed = result.reservation;

    // 6. 重複チェック
    if (parsed.reservationNumber) {
      const { data: existing } = await (adminClient as any)
        .from('external_reservations')
        .select('id')
        .eq('store_id', storeId)
        .eq('source', source)
        .eq('reservation_number', parsed.reservationNumber)
        .in('status', ['created', 'cancelled'])
        .limit(1);
      if (existing && existing.length > 0) {
        console.log(`[inbound-email] 重複スキップ: ${source} ${parsed.reservationNumber}`);
        return NextResponse.json({ skipped: 'duplicate' });
      }
    }

    // 7. 所要時間決定 → カレンダーイベント作成
    const durationMinutes = await resolveDurationMinutes(
      adminClient, storeId, parsed, integration.default_duration_minutes
    );

    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
    const timeStr = `${pad(parsed.hour)}:${pad(parsed.minute)}`;
    const startMs = Date.parse(`${dateStr}T${timeStr}:00+09:00`);
    const endDate = new Date(startMs + durationMinutes * 60 * 1000);
    const endIso = endDate.toISOString();

    // 登録先カレンダー: 連携設定 > 店舗カレンダー
    let calendarId: string | null = integration.target_calendar_id || null;
    if (!calendarId) {
      const { data: storeData } = await (adminClient as any)
        .from('stores')
        .select('google_calendar_id')
        .eq('id', storeId)
        .single();
      calendarId = storeData?.google_calendar_id || null;
    }

    let eventId: string | null = null;
    let eventError: string | null = null;
    if (calendarId) {
      try {
        eventId = await createGenericCalendarEvent(
          {
            calendarId,
            title: buildEventTitle(parsed),
            description: buildEventDescription(parsed),
            startIso: `${dateStr}T${timeStr}:00+09:00`,
            endIso,
          },
          storeId
        );
      } catch (calError) {
        console.error('[inbound-email] カレンダーイベント作成エラー:', calError);
        eventError = calError instanceof Error ? calError.message : String(calError);
      }
    } else {
      eventError = '店舗にGoogleカレンダーが設定されていません';
    }

    // 記録（イベント作成に失敗しても受信自体は記録する）
    await (adminClient as any).from('external_reservations').insert({
      store_id: storeId,
      source,
      reservation_number: parsed.reservationNumber,
      reservation_date: dateStr,
      reservation_time: timeStr,
      duration_minutes: durationMinutes,
      customer_name: parsed.customerName,
      customer_phone: parsed.customerPhone,
      menu_text: parsed.menuText,
      staff_text: parsed.staffText,
      google_calendar_event_id: eventId,
      status: eventId ? 'created' : 'parse_failed',
      mail_subject: mail.subject,
      mail_from: mail.from,
      raw_body: bodyText.slice(0, 20000),
      error_message: eventError,
    });

    return NextResponse.json({
      ok: !!eventId,
      source,
      reservation_number: parsed.reservationNumber,
      duration_minutes: durationMinutes,
    });
  } catch (error) {
    console.error('[inbound-email] Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
