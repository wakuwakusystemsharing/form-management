import { describe, expect, it } from 'vitest';
import { getReservationFormName } from '../form-display-name';
import { normalizeForm } from '../form-normalizer';

describe('getReservationFormName', () => {
  it('config.basic_info.form_name を最優先にする（旧フラット形式の最上位 form_name より優先）', () => {
    expect(getReservationFormName({ form_name: 'テスト予約フォーム（コピー）', config: { basic_info: { form_name: '新しい名前' } } })).toBe('新しい名前');
  });

  it('config に名前が無いときだけ最上位 form_name を使い、どちらも無ければ既定値', () => {
    expect(getReservationFormName({ form_name: '旧形式', config: { basic_info: { form_name: '  ' } } })).toBe('旧形式');
    expect(getReservationFormName({ config: { basic_info: {} } })).toBe('フォーム');
    expect(getReservationFormName(null)).toBe('フォーム');
    expect(getReservationFormName(undefined, '')).toBe('');
  });
});

describe('normalizeForm のフォーム名', () => {
  it('config の名前を優先し、旧フラット形式の最上位 form_name は config に名前が無いときだけ使う', () => {
    const base = { id: 'f1', store_id: 's1', status: 'active', draft_status: 'none', created_at: '', updated_at: '' };
    const renamed = normalizeForm({ ...base, form_name: 'テスト予約フォーム（コピー）', config: { basic_info: { form_name: '新しい名前', store_name: '', theme_color: '#000' } } } as any);
    expect(renamed.config.basic_info.form_name).toBe('新しい名前');

    const legacy = normalizeForm({ ...base, form_name: '旧形式のフォーム' } as any);
    expect(legacy.config.basic_info.form_name).toBe('旧形式のフォーム');
  });
});
