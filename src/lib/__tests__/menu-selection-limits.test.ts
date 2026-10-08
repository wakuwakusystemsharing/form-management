import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';

type BF = {
  state: { selectedMenus: Record<string, string[]>; visitCount: string };
  getMaxCrossSelections: () => number;
  isMenuHiddenUntilVisitSelected: () => boolean;
  applyVisitMenuVisibility: () => void;
};

function makeForm(extra: Record<string, unknown> = {}) {
  return normalizeForm({
    id: 'f1', store_id: 'st1', form_type: 'line',
    config: {
      basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        allow_cross_category_selection: true,
        categories: [
          { id: 'c1', name: 'A', menus: [{ id: 'm1', name: 'A1', price: 1000, duration: 30 }, { id: 'm2', name: 'A2', price: 1000, duration: 30 }] },
          { id: 'c2', name: 'B', menus: [{ id: 'm3', name: 'B1', price: 1000, duration: 30 }] },
        ],
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
      },
      ...extra,
    },
  });
}

async function loadDom(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 80));
  const w = dom.window as unknown as Window & { bookingForm: BF; alert: (m: string) => void };
  const alerts: string[] = [];
  w.alert = (m: string) => { alerts.push(m); };
  return { w, doc: dom.window.document, alerts };
}

const click = (doc: Document, el: Element) => el.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event('click', { bubbles: true, cancelable: true }));

describe('カテゴリーまたいでの複数選択の上限', { timeout: 20000 }, () => {
  it('normalizeForm: 未設定は 3、1 未満 / 不正は 3、小数は切り捨て', () => {
    expect(makeForm().config.menu_structure.max_cross_category_selections).toBe(3);
    expect(makeForm({ menu_structure: { ...makeForm().config.menu_structure, max_cross_category_selections: 0 } }).config.menu_structure.max_cross_category_selections).toBe(3);
    expect(makeForm({ menu_structure: { ...makeForm().config.menu_structure, max_cross_category_selections: 2.7 } }).config.menu_structure.max_cross_category_selections).toBe(2);
  });

  it('上限 2 のとき 3 つ目は選べず案内が出る。解除すればまた選べる', async () => {
    const form = makeForm({ menu_structure: { ...makeForm().config.menu_structure, max_cross_category_selections: 2 } });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const { w, doc, alerts } = await loadDom(html);
    expect(w.bookingForm.getMaxCrossSelections()).toBe(2);
    const btn = (id: string) => doc.querySelector(`.menu-item[data-menu-id="${id}"]`) as HTMLElement;
    click(doc, btn('m1'));
    click(doc, btn('m3'));
    expect(Object.values(w.bookingForm.state.selectedMenus).flat()).toEqual(['m1', 'm3']);
    click(doc, btn('m2'));
    expect(Object.values(w.bookingForm.state.selectedMenus).flat()).toEqual(['m1', 'm3']);
    expect(alerts[0]).toContain('メニューは 2 つまで選択できます');
    click(doc, btn('m1')); // 解除
    click(doc, btn('m2'));
    expect(Object.values(w.bookingForm.state.selectedMenus).flat().sort()).toEqual(['m2', 'm3']);
  });
});

describe('ご来店回数「選択するまでカテゴリーとメニューは非表示にする」', { timeout: 20000 }, () => {
  const visit = (hide?: boolean) => ({
    visit_count_selection: { enabled: true, required: true, hide_menu_until_selected: hide, options: [{ value: 'first', label: '初めて' }, { value: 'repeat', label: '2回目以降' }] },
  });

  it('normalizeForm: 未設定は true', () => {
    expect(makeForm(visit()).config.visit_count_selection.hide_menu_until_selected).toBe(true);
    expect(makeForm(visit(false)).config.visit_count_selection.hide_menu_until_selected).toBe(false);
  });

  it('既定 ON: 最初はメニュー欄が隠れ、来店回数をタップすると表示される', async () => {
    const form = makeForm(visit());
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('id="menu-field" style="display:none;"');
    const { w, doc } = await loadDom(html);
    const field = doc.getElementById('menu-field') as HTMLElement;
    expect(w.bookingForm.isMenuHiddenUntilVisitSelected()).toBe(true);
    expect(field.style.display).toBe('none');
    click(doc, doc.querySelector('.visit-count-button[data-value="first"]') as Element);
    expect(w.bookingForm.state.visitCount).toBe('first');
    expect(field.style.display).toBe('');
  });

  it('OFF にすると最初から表示。ご来店回数選択が無効なら影響しない', async () => {
    const off = makeForm(visit(false));
    const htmlOff = new StaticReservationGenerator().generateHTML(off.config, off.id, off.store_id, 'preview');
    expect(htmlOff).not.toContain('id="menu-field" style="display:none;"');
    const disabled = makeForm({ visit_count_selection: { enabled: false, required: false, options: [] } });
    const htmlDisabled = new StaticReservationGenerator().generateHTML(disabled.config, disabled.id, disabled.store_id, 'preview');
    expect(htmlDisabled).not.toContain('id="menu-field" style="display:none;"');
  });
});
