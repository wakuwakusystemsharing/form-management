import { describe, expect, it } from 'vitest';
import { flexText, toFlexTextParts } from '@/lib/flex-colored-text';

describe('flex-colored-text（通知メッセージの色タグ → Flex span）', () => {
  it('色タグが無ければ text だけ。改行はそのまま', () => {
    expect(toFlexTextParts('ご予約を\n承りました')).toEqual({ text: 'ご予約を\n承りました' });
  });

  it('色タグは span に分割し、タグ無し部分は色なし', () => {
    const p = toFlexTextParts('予約を[color=#dc2626]キャンセル[/color]しました\n[color=#2563eb]またお越しください[/color]');
    expect(p.text).toBe('予約をキャンセルしました\nまたお越しください');
    expect(p.contents).toEqual([
      { type: 'span', text: '予約を' },
      { type: 'span', text: 'キャンセル', color: '#dc2626' },
      { type: 'span', text: 'しました\n' },
      { type: 'span', text: 'またお越しください', color: '#2563eb' },
    ]);
  });

  it('3 桁の色は 6 桁に、8 桁は 6 桁に丸める。hex 以外はタグとして扱わない', () => {
    expect(toFlexTextParts('[color=#f00]赤[/color]').contents).toEqual([{ type: 'span', text: '赤', color: '#ff0000' }]);
    expect(toFlexTextParts('[color=#11223344]a[/color]').contents).toEqual([{ type: 'span', text: 'a', color: '#112233' }]);
    // hex 以外は色にならない（閉じタグだけは共通ヘルパーの仕様で取り除かれる）
    expect(toFlexTextParts('[color=red]a[/color]')).toEqual({ text: '[color=red]a' });
  });

  it('flexText は常に wrap: true で、指定した属性を保ちつつ contents を付ける', () => {
    expect(flexText('長い案内文', { size: 'sm', align: 'center' })).toEqual({ type: 'text', text: '長い案内文', wrap: true, size: 'sm', align: 'center' });
    const t = flexText('[color=#16a34a]OK[/color]', { weight: 'bold' });
    expect(t.contents).toEqual([{ type: 'span', text: 'OK', color: '#16a34a' }]);
    expect(t.weight).toBe('bold');
  });
});
