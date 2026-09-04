import { describe, expect, it } from 'vitest';
import {
  CONTACT_METHODS,
  TAGS_MAX_COUNT,
  buildVisitNotePatch,
  contactMethodLabel,
  isContactMethod,
  normalizeTags,
  pickPendingNextVisitNote,
  summarizeTags,
} from '../customer-chart';

describe('normalizeTags', () => {
  it('配列以外は空配列', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags('a')).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('空白を整え、空文字と重複を除く', () => {
    expect(normalizeTags(['  指名:田中 ', '指名:田中', '', '   ', '平日　　希望', 3])).toEqual([
      '指名:田中',
      '平日 希望',
    ]);
  });

  it('30 文字を超えるタグは捨てる', () => {
    expect(normalizeTags(['あ'.repeat(30), 'い'.repeat(31)])).toEqual(['あ'.repeat(30)]);
  });

  it('上限件数で打ち切る', () => {
    const many = Array.from({ length: TAGS_MAX_COUNT + 5 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(TAGS_MAX_COUNT);
  });
});

describe('contact method', () => {
  it('定義済みの値だけ許可', () => {
    for (const m of CONTACT_METHODS) expect(isContactMethod(m.value)).toBe(true);
    expect(isContactMethod('fax')).toBe(false);
    expect(isContactMethod(null)).toBe(false);
  });

  it('ラベル変換', () => {
    expect(contactMethodLabel('line')).toBe('LINE');
    expect(contactMethodLabel(null)).toBeNull();
    expect(contactMethodLabel('unknown-value')).toBe('unknown-value');
  });
});

describe('pickPendingNextVisitNote', () => {
  const base = { created_at: '2026-09-01T00:00:00Z' };
  it('空なら null', () => {
    expect(pickPendingNextVisitNote([])).toBeNull();
    expect(pickPendingNextVisitNote(undefined)).toBeNull();
  });

  it('申し送りが無い・確認済みは対象外', () => {
    expect(
      pickPendingNextVisitNote([
        { id: 'a', visit_date: '2026-09-01', next_visit_note: null, ...base },
        { id: 'b', visit_date: '2026-09-02', next_visit_note: '   ', ...base },
        {
          id: 'c',
          visit_date: '2026-09-03',
          next_visit_note: 'x',
          next_visit_note_acknowledged_at: '2026-09-04T00:00:00Z',
          ...base,
        },
      ])
    ).toBeNull();
  });

  it('最新の来店日を優先し、同日は created_at が新しい方', () => {
    const picked = pickPendingNextVisitNote([
      { id: 'old', visit_date: '2026-08-01', next_visit_note: 'old', created_at: '2026-08-01T10:00:00Z' },
      { id: 'same-early', visit_date: '2026-09-01', next_visit_note: 'e', created_at: '2026-09-01T09:00:00Z' },
      { id: 'same-late', visit_date: '2026-09-01', next_visit_note: 'l', created_at: '2026-09-01T11:00:00Z' },
      {
        id: 'acked',
        visit_date: '2026-09-02',
        next_visit_note: 'a',
        next_visit_note_acknowledged_at: '2026-09-02T12:00:00Z',
        created_at: '2026-09-02T00:00:00Z',
      },
    ]);
    expect(picked?.id).toBe('same-late');
  });
});

describe('buildVisitNotePatch', () => {
  it('本文を変えると未確認に戻る', () => {
    const r = buildVisitNotePatch({ next_visit_note: '  新しい申し送り  ' }, { next_visit_note: '古い' });
    expect('patch' in r && r.patch.next_visit_note).toBe('新しい申し送り');
    expect('patch' in r && r.patch.next_visit_note_acknowledged_at).toBeNull();
  });

  it('本文が同じなら確認状態は触らない', () => {
    const r = buildVisitNotePatch({ next_visit_note: '同じ', next_visit_note_by: '田中' }, { next_visit_note: '同じ' });
    expect('patch' in r && 'next_visit_note_acknowledged_at' in r.patch).toBe(false);
    expect('patch' in r && r.patch.next_visit_note_by).toBe('田中');
  });

  it('空文字は削除（null）', () => {
    const r = buildVisitNotePatch({ next_visit_note: '', next_visit_note_by: '' }, { next_visit_note: 'x' });
    expect('patch' in r && r.patch.next_visit_note).toBeNull();
    expect('patch' in r && r.patch.next_visit_note_by).toBeNull();
  });

  it('acknowledge で確認日時が入る', () => {
    const r = buildVisitNotePatch({ acknowledge: true }, { next_visit_note: 'x' });
    expect('patch' in r && typeof r.patch.next_visit_note_acknowledged_at).toBe('string');
  });

  it('不正な型・空更新・長すぎる本文はエラー', () => {
    expect(buildVisitNotePatch({ next_visit_note: 123 }, {})).toHaveProperty('error');
    expect(buildVisitNotePatch({}, {})).toHaveProperty('error');
    expect(buildVisitNotePatch({ next_visit_note: 'a'.repeat(1001) }, {})).toHaveProperty('error');
  });
});

describe('summarizeTags', () => {
  it('最大件数と残り件数', () => {
    expect(summarizeTags(['a', 'b', 'c'], 2)).toEqual({ shown: ['a', 'b'], rest: 1 });
    expect(summarizeTags(null)).toEqual({ shown: [], rest: 0 });
  });
});
