import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { FREE_RATIO_MAX, FREE_RATIO_MIN, formatFreeRatio, freeOutputSize } from '@/components/FormEditor/Reservation/ImageCropperModal';

function makeForm(display: 'thumbnail' | 'hidden') {
  return normalizeForm({
    id: 'f1', store_id: 'st1', form_type: 'line',
    config: {
      basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [{ id: 'c1', name: 'ヘア', menus: [
          { id: 'm1', name: 'カット', price: 4000, duration: 60, image: 'https://img.example.com/cut_abc.jpg', description: '説明' },
        ] }],
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false, menu_image_display: display },
      },
    },
  });
}

async function loadDom(html: string) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 80));
  return dom.window as unknown as Window & { bookingForm: { state: { selectedMenu: unknown }; openImageLightbox: (s: string) => void; closeImageLightbox: () => void } };
}

describe('メニュー画像の拡大表示（ライトボックス）', { timeout: 20000 }, () => {
  it('サムネイルをタップすると拡大表示され、メニューは選択されない。閉じるで消える', async () => {
    const form = makeForm('thumbnail');
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('id="image-lightbox"');
    expect(html).toContain('class="image-lightbox-close"');
    const w = await loadDom(html);
    const doc = w.document;
    const thumb = doc.querySelector('.menu-item-thumb img') as HTMLImageElement;
    expect(thumb).not.toBeNull();
    thumb.dispatchEvent(new (w as unknown as { Event: typeof Event }).Event('click', { bubbles: true, cancelable: true }));
    const box = doc.getElementById('image-lightbox') as HTMLElement;
    const img = doc.getElementById('image-lightbox-img') as HTMLImageElement;
    expect(box.style.display).toBe('flex');
    expect(img.getAttribute('src')).toBe('https://img.example.com/cut_abc.jpg');
    expect(doc.body.classList.contains('lightbox-open')).toBe(true);
    // メニューは選択されていない（画像タップは選択を起こさない）
    expect(w.bookingForm.state.selectedMenu).toBeNull();
    (doc.querySelector('.image-lightbox-close') as HTMLButtonElement).click();
    expect(box.style.display).toBe('none');
    expect(doc.body.classList.contains('lightbox-open')).toBe(false);
  });

  it('詳細モーダルの画像にも拡大表示のクリックが付く', () => {
    const form = makeForm('hidden');
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    expect(html).toContain('onclick="window.bookingForm.openImageLightbox(this.src)"');
    expect(html).toContain('.menu-item-thumb img { cursor: zoom-in; }');
  });
});

describe('画像トリミングの自由形', () => {
  it('比率に応じて出力サイズを決める（横長は幅 720、縦長は高さ 960）。範囲外は丸める', () => {
    expect(freeOutputSize(1)).toEqual({ width: 720, height: 720 });
    expect(freeOutputSize(2)).toEqual({ width: 720, height: 360 });
    expect(freeOutputSize(0.75)).toEqual({ width: 720, height: 960 });
    expect(freeOutputSize(0.5)).toEqual({ width: 480, height: 960 });
    expect(freeOutputSize(10)).toEqual(freeOutputSize(FREE_RATIO_MAX));
    expect(freeOutputSize(0.1)).toEqual(freeOutputSize(FREE_RATIO_MIN));
    expect(formatFreeRatio(1.5)).toBe('1.5:1');
    expect(formatFreeRatio(0.5)).toBe('1:2');
  });
});
