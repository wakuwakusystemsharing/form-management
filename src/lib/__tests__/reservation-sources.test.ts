import { describe, it, expect } from 'vitest';
import {
  SOURCE_CODE_PATTERN,
  appendSourceParam,
  buildSourceEntryUrl,
  generateSourceCode,
  isBotUserAgent,
  normalizeSourceName,
  pickSourceCode,
  resolveFormBaseUrl,
  resolveSourceRedirect,
  sourceFormStatus,
  validateSourceInput,
  type SourceForm,
} from '../reservation-sources';
import { RESERVATION_FORM_FEATURES } from '../form-deploy-features';
import type { FormConfig, StaticDeploy } from '@/types/form';

const ORIGIN = 'https://app.example';
const deployed = (features: string[] | undefined, url = '/api/public-form/reservations/st1/f1/index.html'): StaticDeploy => ({ deployed_at: '2026-11-20T00:00:00Z', deploy_url: url, status: 'deployed', features });
const lineForm = (liffId: string, features?: string[]): SourceForm => ({ config: { basic_info: { liff_id: liffId } } as unknown as FormConfig, staticDeploy: deployed(features) });
const webForm = (url: string, features?: string[]): SourceForm => ({ config: { form_type: 'web', basic_info: {} } as unknown as FormConfig, staticDeploy: deployed(features, url) });
const ALL = [...RESERVATION_FORM_FEATURES];

describe('経路の合言葉', () => {
  it('英小文字と数字 8 文字で、紛らわしい文字（0 o 1 l i）を使わない', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSourceCode();
      expect(code).toMatch(SOURCE_CODE_PATTERN);
      expect(code).not.toMatch(/[0o1li]/);
    }
    // 乱数が 1 ちょうどを返しても範囲を外れない
    expect(generateSourceCode(() => 0.999999999)).toMatch(SOURCE_CODE_PATTERN);
  });

  it('形の合わない値（書き換えられた URL）は通さない', () => {
    expect(pickSourceCode('abcd2345')).toBe('abcd2345');
    expect(pickSourceCode('ABCD2345')).toBeNull();
    expect(pickSourceCode('abcd234')).toBeNull();
    expect(pickSourceCode('abcd23456')).toBeNull();
    expect(pickSourceCode("abcd'--x")).toBeNull();
    expect(pickSourceCode('<script>')).toBeNull();
    expect(pickSourceCode(12345678)).toBeNull();
    expect(pickSourceCode(null)).toBeNull();
  });
});

describe('経路の名前', () => {
  it('前後の空白を除き、改行を空白にして 40 文字までにする', () => {
    expect(normalizeSourceName('  店頭ポップ  ')).toBe('店頭ポップ');
    expect(normalizeSourceName('チラシ\n（11月）')).toBe('チラシ （11月）');
    expect(normalizeSourceName('あ'.repeat(60))).toHaveLength(40);
    expect(normalizeSourceName('   ')).toBeNull();
    expect(normalizeSourceName(undefined)).toBeNull();
  });

  it('作成は名前とフォームが必須、更新は指定したものだけ確かめる', () => {
    expect(validateSourceInput({ name: '店頭ポップ', form_id: 'abcdefghijkl' }, { requireAll: true })).toEqual({ ok: true, name: '店頭ポップ', form_id: 'abcdefghijkl' });
    expect(validateSourceInput({ name: '', form_id: 'abcdefghijkl' }, { requireAll: true })).toMatchObject({ ok: false });
    expect(validateSourceInput({ name: '店頭ポップ' }, { requireAll: true })).toMatchObject({ ok: false });
    expect(validateSourceInput({ name: '店頭ポップ', form_id: '../x' }, { requireAll: true })).toMatchObject({ ok: false });
    expect(validateSourceInput({ name: 'チラシ' }, { requireAll: false })).toEqual({ ok: true, name: 'チラシ' });
    expect(validateSourceInput({}, { requireAll: false })).toEqual({ ok: true });
  });
});

describe('URL', () => {
  it('配る URL は /s/{合言葉}', () => {
    expect(buildSourceEntryUrl(ORIGIN, 'abcd2345')).toBe('https://app.example/s/abcd2345');
    expect(buildSourceEntryUrl('https://app.example/', 'abcd2345')).toBe('https://app.example/s/abcd2345');
  });

  it('?src= は既存のクエリの後ろ・# の前に付ける', () => {
    expect(appendSourceParam('https://liff.line.me/1234567890-abcdefgh', 'abcd2345')).toBe('https://liff.line.me/1234567890-abcdefgh?src=abcd2345');
    expect(appendSourceParam('https://x.example/f?a=1', 'abcd2345')).toBe('https://x.example/f?a=1&src=abcd2345');
    expect(appendSourceParam('https://x.example/f#top', 'abcd2345')).toBe('https://x.example/f?src=abcd2345#top');
    expect(appendSourceParam('https://x.example/f', null)).toBe('https://x.example/f');
  });

  it('LINE フォームは LIFF の URL、Web フォームは公開 URL（相対パスならサイトの URL を付ける）', () => {
    expect(resolveFormBaseUrl(lineForm('1234567890-abcdefgh'), ORIGIN)).toBe('https://liff.line.me/1234567890-abcdefgh');
    expect(resolveFormBaseUrl(lineForm(''), ORIGIN)).toBeNull();
    expect(resolveFormBaseUrl(webForm('/api/public-form/reservations/st1/f1/index.html'), ORIGIN)).toBe('https://app.example/api/public-form/reservations/st1/f1/index.html');
    expect(resolveFormBaseUrl(webForm('https://cdn.example/f.html'), ORIGIN)).toBe('https://cdn.example/f.html');
    expect(resolveFormBaseUrl(webForm(''), ORIGIN)).toBeNull();
    expect(resolveFormBaseUrl(webForm('javascript:alert(1)'), ORIGIN)).toBeNull();
    expect(resolveFormBaseUrl(null, ORIGIN)).toBeNull();
  });

  it('有効な経路は ?src= 付き、停止中は付けない、開けないフォームは null', () => {
    const form = lineForm('1234567890-abcdefgh', ALL);
    expect(resolveSourceRedirect({ code: 'abcd2345', active: true }, form, ORIGIN)).toBe('https://liff.line.me/1234567890-abcdefgh?src=abcd2345');
    expect(resolveSourceRedirect({ code: 'abcd2345', active: false }, form, ORIGIN)).toBe('https://liff.line.me/1234567890-abcdefgh');
    expect(resolveSourceRedirect({ code: 'abcd2345', active: true }, lineForm(''), ORIGIN)).toBeNull();
    expect(resolveSourceRedirect({ code: 'abcd2345', active: true }, null, ORIGIN)).toBeNull();
  });
});

describe('フォームの状態', () => {
  it('対応済みの HTML をデプロイしたフォームだけ ok。古い HTML は「保存＆デプロイが必要」', () => {
    expect(RESERVATION_FORM_FEATURES).toContain('source_code');
    expect(sourceFormStatus(lineForm('1234567890-abcdefgh', ALL), ORIGIN)).toBe('ok');
    expect(sourceFormStatus(lineForm('1234567890-abcdefgh', ['menu_change']), ORIGIN)).toBe('needs_deploy');
    expect(sourceFormStatus(lineForm('1234567890-abcdefgh', undefined), ORIGIN)).toBe('needs_deploy');
    expect(sourceFormStatus(lineForm('', ALL), ORIGIN)).toBe('no_url');
    expect(sourceFormStatus(null, ORIGIN)).toBe('missing');
  });
});

describe('読まれた数に数えないアクセス', () => {
  it('検索ロボット・リンクの下見・User-Agent なしは数えない。ふつうのブラウザと LINE は数える', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/14.0.0')).toBe(false);
  });
});
