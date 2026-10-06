import { describe, expect, it } from 'vitest';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { buildAdminReservationRows, buildReservationDetailItems } from '@/lib/reservation-detail-items';
import { CROP_ASPECTS } from '@/components/FormEditor/Reservation/ImageCropperModal';

function makeForm(label?: string) {
  return normalizeForm({
    id: 'f1', store_id: 'st1', form_type: 'line',
    config: {
      basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' },
      visit_count_selection: { enabled: true, required: true, label, options: [{ value: 'first', label: '初めて' }, { value: 'repeat', label: '2回目以降' }] },
    },
  });
}

describe('ご来店回数選択の見出し（visit_count_selection.label）', () => {
  it('normalizeForm: 未設定は空文字（表示側で「ご来店回数」になる）、設定値はそのまま', () => {
    expect(makeForm().config.visit_count_selection.label).toBe('');
    expect(makeForm('ご利用回数').config.visit_count_selection.label).toBe('ご利用回数');
  });

  it('生成 HTML: 見出し・ご予約内容・LINE メッセージの《見出し》に反映。空なら既定', () => {
    const gen = new StaticReservationGenerator();
    const custom = gen.generateHTML(makeForm('来院回数').config, 'f1', 'st1', 'preview');
    expect(custom).toContain('<label class="field-label">来院回数 <span class="required">*</span></label>');
    expect(custom).toContain("'ご来店回数'"); // 既定値のフォールバックは JS 内に残る
    const plain = gen.generateHTML(makeForm('').config, 'f1', 'st1', 'preview');
    expect(plain).toContain('<label class="field-label">ご来店回数 <span class="required">*</span></label>');
    // LINE メッセージは設定の見出しを《》で囲む（固定文字列ではない）
    expect(custom).toContain("addMsgSegment('visit_count', '《' + visitMsgTitle + '》");
    expect(custom).not.toContain("'《ご来店回数》\\n'");
  });

  it('メール・管理画面の項目名にも見出しを使う', () => {
    const config = makeForm('ご利用回数').config;
    const reservation = { reservation_date: '2026-10-10', reservation_time: '10:00', customer_info: { visit_count: 'first', visit_count_label: '初めて' } };
    expect(buildReservationDetailItems(config, reservation).find((i) => i.value === '初めて')?.label).toBe('ご利用回数');
    expect(buildAdminReservationRows(config, reservation).find((i) => i.value === '初めて')?.label).toBe('ご利用回数');
    expect(buildAdminReservationRows(makeForm().config, reservation).find((i) => i.value === '初めて')?.label).toBe('ご来店回数');
  });
});

describe('画像トリミングのアスペクト比', () => {
  it('16:9 / 4:3 / 1:1 / 3:4 / 9:16 を選べ、出力サイズが比率と一致する', () => {
    expect(CROP_ASPECTS.map((a) => a.id)).toEqual(['wide', 'standard', 'square', 'portrait', 'tall']);
    for (const a of CROP_ASPECTS) {
      expect(Math.abs(a.width / a.height - a.ratio)).toBeLessThan(0.01);
      expect(a.width).toBe(720);
    }
    expect(CROP_ASPECTS.find((a) => a.id === 'square')).toMatchObject({ width: 720, height: 720 });
    expect(CROP_ASPECTS.find((a) => a.id === 'portrait')).toMatchObject({ width: 720, height: 960 });
  });
});
