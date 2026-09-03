import { describe, expect, it } from 'vitest';
import { hasColorTags, renderColoredTextHtml, stripColorTags, wrapSelectionWithColor } from '@/lib/colored-text';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import type { SurveyConfig } from '@/types/survey';

describe('colored-text', () => {
  it('エスケープしてから hex 色だけを span に変換し、改行を <br> にする', () => {
    expect(renderColoredTextHtml('a<b>\n[color=#ff0000]赤[/color]')).toBe('a&lt;b&gt;<br><span style="color:#ff0000">赤</span>');
  });
  it('hex 以外の色指定は変換しない（CSS インジェクション防止）', () => {
    expect(renderColoredTextHtml('[color=red]x[/color]')).toBe('[color=red]x</span>');
    expect(renderColoredTextHtml('[color=#fff;background:url(x)]x[/color]')).not.toContain('<span');
  });
  it('選択範囲を色タグで囲む。空範囲・不正色は null', () => {
    expect(wrapSelectionWithColor('abcdef', 1, 3, '#ff0000')).toBe('a[color=#ff0000]bc[/color]def');
    expect(wrapSelectionWithColor('abcdef', 3, 1, '#ff0000')).toBe('a[color=#ff0000]bc[/color]def');
    expect(wrapSelectionWithColor('abcdef', 2, 2, '#ff0000')).toBeNull();
    expect(wrapSelectionWithColor('abcdef', 1, 3, 'red')).toBeNull();
  });
  it('色タグの検出と除去', () => {
    expect(hasColorTags('x[color=#abc]y[/color]')).toBe(true);
    expect(hasColorTags('x')).toBe(false);
    expect(stripColorTags('x[color=#abc]y[/color]z')).toBe('xyz');
  });
});

describe('StaticSurveyGenerator content blocks', () => {
  const gen = new StaticSurveyGenerator();
  const config: SurveyConfig = {
    basic_info: { title: 'T', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e' },
    questions: [
      { id: 'q1', type: 'text', title: 'Q1', required: false, description: '説明 <b>\n[color=#2563eb]青[/color]' },
      { id: 'q2', type: 'text', title: 'Q2', required: false },
    ],
    content_blocks: [
      { id: 'b1', type: 'text', text: '同意書\n[color=#dc2626]注意[/color]', anchor: 'q2', position: 'above' },
      { id: 'b2', type: 'image', image_url: 'https://img/x.png', anchor: 'q2', position: 'below' },
      { id: 'b3', type: 'text', text: '   ', anchor: 'q1', position: 'above' },
      { id: 'b4', type: 'image', image_url: 'javascript:alert(1)', anchor: 'q1', position: 'below' },
      { id: 'b5', type: 'text', text: '消えた質問のブロック', anchor: 'gone', position: 'above' },
    ],
    ui_settings: { submit_button_text: '送信', theme_color: '#1b2a4e' },
  };
  const html = gen.generateHTML(config, 'sv1', 'st1');

  it('Q1 と Q2 の間にテキストブロック、Q2 の下に画像ブロックを描画する', () => {
    const q1 = html.indexOf('id="q1"');
    const block = html.indexOf('content-block-text">同意書<br><span style="color:#dc2626">注意</span>');
    const q2 = html.indexOf('id="q2"');
    const img = html.indexOf('content-block-image"><img src="https://img/x.png"');
    expect(q1).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(q1);
    expect(q2).toBeGreaterThan(block);
    expect(img).toBeGreaterThan(q2);
  });
  it('空テキスト・不正な画像 URL・存在しない質問のブロックは描画しない', () => {
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('消えた質問のブロック');
    expect((html.match(/class="content-block /g) || []).length).toBe(2);
  });
  it('説明文はエスケープされ、文字色が反映される', () => {
    expect(html).toContain('<div class="field-description">説明 &lt;b&gt;<br><span style="color:#2563eb">青</span></div>');
  });
  it('content_blocks 未設定でも従来どおり描画できる', () => {
    const plain = gen.generateHTML({ ...config, content_blocks: undefined }, 'sv1', 'st1');
    expect(plain).not.toContain('class="content-block ');
    expect(plain).toContain('id="q2"');
  });
});
