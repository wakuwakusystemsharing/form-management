/**
 * 自動配信（ステップ配信）のきっかけの判定（純粋ロジック）
 * 仕様: docs/LINE配信機能_仕様書.md §3-4 / §7-2
 *
 * evaluateAutomationTrigger は「今日この顧客に送るべきなら、その理由を表す marker」を返す。
 * 送信記録（broadcast_automation_sends）は ルール × 顧客 × marker で一意なので、同じきっかけで 2 回送らない。
 *   dormant            … `dormant:{最終来店日}`（来店して再び休眠したら、また送る）
 *   birthday           … `birthday:{年}`（毎年 1 回）
 *   first_visit_after  … `first_visit`（1 人 1 回）
 *   visits_reached     … `visits:{回数}`（回数ごとに 1 回）
 *   tag_added          … `tag:{タグ}`（タグごとに 1 回）
 *
 * ルールを ON にした日に過去の該当者へ一斉に送ってしまわないよう、日数で決まるきっかけは
 * 「到達してから AUTOMATION_WINDOW_DAYS 日以内」の人だけを対象にする（cron が数日止まっても拾える幅）。
 * タグは付いた日が分からないため、ON にした時点でタグが付いている人にも送る。
 */
import type { AudienceCustomer, AutomationTrigger } from '@/types/broadcast';
import { daysBetween, jstDateOf, toJstDate } from '@/lib/broadcast-audience';

export const AUTOMATION_WINDOW_DAYS = 14;

export const AUTOMATION_TEMPLATES: Array<{ id: AutomationTrigger['type']; label: string; description: string; trigger: AutomationTrigger; resend_after_days: number | null }> = [
  { id: 'dormant', label: '休眠のお客様へ', description: '最終来店から 90 日たったお客様に再来店の案内を送る', trigger: { type: 'dormant', days: 90 }, resend_after_days: 180 },
  { id: 'birthday', label: 'お誕生日月', description: '誕生月の 1 日にバースデークーポンなどを送る', trigger: { type: 'birthday', day: 1 }, resend_after_days: null },
  { id: 'first_visit_after', label: '初回来店のお礼', description: '初めての来店から 7 日後にお礼と次回予約の案内を送る', trigger: { type: 'first_visit_after', days: 7 }, resend_after_days: null },
  { id: 'visits_reached', label: '来店 N 回目', description: '来店回数が 5 回・10 回に達した翌日に特別な案内を送る', trigger: { type: 'visits_reached', counts: [5, 10] }, resend_after_days: null },
  { id: 'tag_added', label: 'タグが付いたとき', description: '指定したタグが付いたお客様に、タグに合わせた案内を送る', trigger: { type: 'tag_added', tags: [] }, resend_after_days: null },
];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** 保存データをきっかけに整える。不正なら null */
export function normalizeAutomationTrigger(raw: unknown): AutomationTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case 'dormant':
      return { type: 'dormant', days: clampInt(o.days, 14, 730, 90) };
    case 'birthday':
      return { type: 'birthday', day: clampInt(o.day, 1, 28, 1) };
    case 'first_visit_after':
      return { type: 'first_visit_after', days: clampInt(o.days, 1, 365, 7) };
    case 'visits_reached': {
      const counts = Array.isArray(o.counts) ? [...new Set(o.counts.map((c) => clampInt(c, 0, 1000, 0)).filter((c) => c >= 1))].sort((a, b) => a - b).slice(0, 10) : [];
      return counts.length > 0 ? { type: 'visits_reached', counts } : null;
    }
    case 'tag_added': {
      const tags = Array.isArray(o.tags) ? [...new Set(o.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()))].slice(0, 20) : [];
      return tags.length > 0 ? { type: 'tag_added', tags } : null;
    }
    default:
      return null;
  }
}

export function normalizeResendAfterDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = clampInt(raw, 0, 3650, 0);
  return n >= 1 ? n : null;
}

/** 今日この顧客がきっかけに該当するなら marker、しないなら null */
export function evaluateAutomationTrigger(trigger: AutomationTrigger, c: AudienceCustomer, now: Date): string | null {
  const today = jstDateOf(now);
  const inWindow = (fromDate: string | null, days: number): boolean => {
    if (!fromDate) return false;
    const ago = daysBetween(fromDate, today);
    return ago >= days && ago < days + AUTOMATION_WINDOW_DAYS;
  };
  switch (trigger.type) {
    case 'dormant': {
      const last = toJstDate(c.last_visit_date);
      return inWindow(last, trigger.days) ? `dormant:${last}` : null;
    }
    case 'birthday': {
      if (!c.birthday || !/^\d{4}-\d{2}-\d{2}/.test(c.birthday)) return null;
      const month = Number(c.birthday.slice(5, 7));
      if (month !== Number(today.slice(5, 7))) return null;
      if (Number(today.slice(8, 10)) < trigger.day) return null;
      return `birthday:${today.slice(0, 4)}`;
    }
    case 'first_visit_after':
      return inWindow(toJstDate(c.first_visit_date), trigger.days) ? 'first_visit' : null;
    case 'visits_reached': {
      const n = c.total_visits ?? 0;
      if (!trigger.counts.includes(n)) return null;
      // 到達した来店の翌日以降（来店当日には送らない）、かつ直近のものだけ
      return inWindow(toJstDate(c.last_visit_date), 1) ? `visits:${n}` : null;
    }
    case 'tag_added': {
      const tags = c.tags ?? [];
      const hit = trigger.tags.find((t) => tags.includes(t));
      return hit ? `tag:${hit}` : null;
    }
    default:
      return null;
  }
}

/**
 * 送ってよいか。sends = このルールがこの顧客に送った記録。
 * 同じ marker は送らない。resend_after_days があれば、最後に送ってからその日数は（marker が違っても）送らない
 */
export function isAutomationSendAllowed(marker: string, sends: Array<{ marker: string; sent_at: string }>, resendAfterDays: number | null, now: Date): boolean {
  if (sends.some((s) => s.marker === marker)) return false;
  if (resendAfterDays && sends.length > 0) {
    const last = sends.reduce((m, s) => Math.max(m, Date.parse(s.sent_at) || 0), 0);
    if (last > 0 && now.getTime() - last < resendAfterDays * 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

/** 店舗の実行時刻（HH:00。JST）を過ぎたか。毎時の実行で「その時刻以降 + 今日まだ実行していない」を判定するのに使う */
export function isAutomationTimeReached(time: string, now: Date): boolean {
  const hour = /^([01]\d|2[0-3]):/.test(time) ? Number(time.slice(0, 2)) : 10;
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours() >= hour;
}

/** ルール一覧に出す説明（例: 最終来店から 90 日） */
export function describeAutomationTrigger(t: AutomationTrigger): string {
  switch (t.type) {
    case 'dormant':
      return `最終来店から ${t.days} 日`;
    case 'birthday':
      return `誕生月の ${t.day} 日`;
    case 'first_visit_after':
      return `初回来店の ${t.days} 日後`;
    case 'visits_reached':
      return `来店 ${t.counts.join('・')} 回目の翌日`;
    case 'tag_added':
      return `タグ ${t.tags.map((x) => `「${x}」`).join('・')} が付いたとき`;
    default:
      return '';
  }
}
