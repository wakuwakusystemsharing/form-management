'use client';

/**
 * Flex Message のプレビュー（iPhone の LINE トーク画面に寄せた HTML 近似）
 *
 * - 幅 390px（iPhone の CSS px。枠の内側）のスマホ画面に、LINE と同じ縮尺でトーク画面を再現し、欄の幅に合わせて自動で縮小する（CSS zoom）
 * - LINE の仕様値: バブル幅 nano 120 / micro 160 / deca 220 / hecto 241 / kilo 260 / mega 300 / giga 386 px。
 *   画面より広い指定（giga）は「画面幅 − 左右 8px」= 374px に収まる。角丸は mega 17 / giga 5 / それより小さいサイズ 10（実機計測）
 *   文字サイズ xxs 11 / xs 13 / sm 14 / md 16（既定）/ lg 19 / xl 22 / xxl 29 / 3xl 35 / 4xl 48 / 5xl 74 px
 *   余白 none 0 / xs 2 / sm 4 / md 8 / lg 12 / xl 16 / xxl 20 px、ブロック（header / body / footer）の既定 padding 20px
 *   画像 xxs 40 … 5xl 220 px / full（既定 md・1:1・fit）、ボタン高さ sm 40 / md 52 px・角丸 8px
 *   horizontal / baseline の子は flex 1、vertical の子は flex 0 が既定。カルーセルのバブルは最も高いものに揃う（body が伸びる）
 * - 行の高さは文字サイズ × 約 1.193（システムフォントの自然な行高。1/3 px 単位に切り上げ）
 * - フォントは iPhone の LINE に寄せる（src/lib/flex-preview-fonts.ts）: 英数字 = システムフォント（無い環境は Inter）、
 *   日本語 = ヒラギノ角ゴ（無い環境は Noto Sans JP の 350 / 600）を **92% の大きさ**で描く（実機では日本語だけ小さく描かれる）
 * - 実機との比較資料: docs/フレックスメッセージプレビュー/（mega カルーセル）、docs/フレックスメッセージプレビュー修正2回目/（giga）
 * 対応: bubble / carousel / box / text / span / image / button / separator / spacer / icon / filler / video（静止画）
 */
import React, { useEffect, useRef, useState } from 'react';
import type { FlexContainer } from '@/types/line-flex';
import type { PreviewMessage } from '@/lib/line-flex-items';
import { APPLE_JP_FONT_CSS, buildScaledJpFontCss, FLEX_PREVIEW_FONT_STACK, flexLineHeightPx, GOOGLE_JP_FONT_CSS_URL, GOOGLE_LATIN_FONT_CSS_URL } from '@/lib/flex-preview-fonts';

type Node = Record<string, any>;
type Layout = 'vertical' | 'horizontal' | 'baseline';

export const PHONE_WIDTH = 390; // スマホ画面（枠の内側）の幅。iPhone の CSS px
const PHONE_BORDER = 6; // 枠の太さ（画面の外側に足す）
const PHONE_OUTER_WIDTH = PHONE_WIDTH + PHONE_BORDER * 2;
const CHAT_SIDE_PADDING = 8; // トーク画面の左右の余白（実機計測: 画面幅 390 に対してバブル左右 8）
/** バブルが取れる最大幅。giga（386）のように画面より広い指定は、実機と同じく画面幅 − 左右の余白に収まる */
const BUBBLE_MAX_WIDTH = PHONE_WIDTH - CHAT_SIDE_PADDING * 2;
/** バブルの角丸（実機計測: mega = 17 / giga = 5。それより小さいサイズは 10） */
const BUBBLE_RADIUS: Record<string, number> = { nano: 10, micro: 10, deca: 10, hecto: 10, kilo: 10, mega: 17, giga: 5 };
const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT_SIZE: Record<string, number> = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const BUBBLE_WIDTH: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 386 };
const IMAGE_SIZE: Record<string, string> = { xxs: '40px', xs: '60px', sm: '80px', md: '100px', lg: '120px', xl: '140px', xxl: '160px', '3xl': '180px', '4xl': '200px', '5xl': '220px', full: '100%' };
const BORDER_WIDTH: Record<string, string> = { none: '0px', light: '0.5px', normal: '1px', medium: '2px', 'semi-bold': '3px', bold: '4px' };
const CORNER: Record<string, string> = { none: '0px', xs: '2px', sm: '4px', md: '8px', lg: '12px', xl: '16px', xxl: '20px' };
/**
 * フォント（src/lib/flex-preview-fonts.ts）。iPhone の LINE は 英数字 = San Francisco / 日本語 = ヒラギノ角ゴで、
 * 日本語は英数字の約 92% の大きさで描かれる。日本語の範囲だけを受け持つ FlexPreviewJP（92%）を先頭に置き、
 * 英数字は後ろのシステムフォント（Apple）/ Inter に任せる
 */
const FONT = FLEX_PREVIEW_FONT_STACK;
const WEIGHT_REGULAR = 400;
const WEIGHT_BOLD = 700;
const LINK_COLOR = '#42659a';
const DEFAULT_TEXT = '#000000';
const CHAT_BG = '#7e9ccb';
const FONT_STYLE_ID = 'flex-preview-fonts';

function len(v: unknown, table?: Record<string, string | number>): string | undefined {
  if (typeof v === 'number') return `${v}px`;
  if (typeof v !== 'string') return undefined;
  if (table && v in table) {
    const t = table[v];
    return typeof t === 'number' ? `${t}px` : t;
  }
  if (v in SPACING) return `${SPACING[v]}px`;
  return v; // "20px" / "5%"
}
function aspect(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return m ? `${m[1]} / ${m[2]}` : undefined;
}
function gradient(bg: Node | undefined): string | undefined {
  if (!bg || bg.type !== 'linearGradient') return undefined;
  const angle = typeof bg.angle === 'string' ? bg.angle : '0deg';
  const stops = [bg.startColor, bg.centerColor ? `${bg.centerColor} ${bg.centerPosition ?? '50%'}` : null, bg.endColor].filter(Boolean);
  return `linear-gradient(${angle}, ${stops.join(', ')})`;
}
/** paddingAll + 各辺（shorthand と longhand を混ぜない） */
function paddings(node: Node, fallbackAll?: string): React.CSSProperties {
  const all = len(node.paddingAll) ?? fallbackAll;
  return {
    paddingTop: len(node.paddingTop) ?? all,
    paddingBottom: len(node.paddingBottom) ?? all,
    paddingLeft: len(node.paddingStart) ?? all,
    paddingRight: len(node.paddingEnd) ?? all,
  };
}

/** 親の layout から子の既定 flex と gravity / offset / position を CSS に */
function childStyle(node: Node, parentLayout: Layout): React.CSSProperties {
  const style: React.CSSProperties = {};
  const horizontal = parentLayout !== 'vertical';
  const hasFixedWidth = node.type === 'box' && typeof node.width === 'string';
  const defaultFlex = horizontal && !hasFixedWidth ? 1 : 0;
  const flex = typeof node.flex === 'number' ? node.flex : defaultFlex;
  style.flex = flex === 0 ? '0 0 auto' : `${flex} ${flex} 0%`;
  if (node.gravity === 'center') style.alignSelf = 'center';
  else if (node.gravity === 'bottom') style.alignSelf = 'flex-end';
  else if (node.gravity === 'top') style.alignSelf = 'flex-start';
  const hasOffset = node.offsetTop !== undefined || node.offsetBottom !== undefined || node.offsetStart !== undefined || node.offsetEnd !== undefined;
  if (node.position === 'absolute') {
    style.position = 'absolute';
    style.alignSelf = undefined;
  } else if (hasOffset) {
    style.position = 'relative';
  }
  if (hasOffset) {
    style.top = len(node.offsetTop);
    style.bottom = len(node.offsetBottom);
    style.left = len(node.offsetStart);
    style.right = len(node.offsetEnd);
  }
  if (parentLayout === 'vertical') style.marginTop = len(node.margin);
  else style.marginLeft = len(node.margin);
  return style;
}

function Box({ node, parentLayout, isBlock, blockStyle, grow }: { node: Node; parentLayout?: Layout; isBlock?: boolean; blockStyle?: Node; grow?: boolean }) {
  const layout: Layout = node.layout === 'horizontal' ? 'horizontal' : node.layout === 'baseline' ? 'baseline' : 'vertical';
  const bg = node.backgroundColor ?? blockStyle?.backgroundColor;
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'vertical' ? 'column' : 'row',
    alignItems: layout === 'baseline' ? 'baseline' : node.alignItems === 'center' ? 'center' : node.alignItems === 'flex-end' ? 'flex-end' : node.alignItems === 'flex-start' ? 'flex-start' : 'stretch',
    justifyContent: node.justifyContent ?? 'flex-start',
    gap: len(node.spacing) ?? '0px',
    backgroundColor: bg,
    backgroundImage: gradient(node.background),
    borderRadius: len(node.cornerRadius, CORNER),
    borderWidth: node.borderWidth ? len(node.borderWidth, BORDER_WIDTH) : undefined,
    borderStyle: node.borderWidth ? 'solid' : undefined,
    borderColor: node.borderColor,
    ...paddings(node, isBlock ? '20px' : undefined),
    width: isBlock ? undefined : len(node.width),
    height: len(node.height),
    maxWidth: len(node.maxWidth),
    maxHeight: len(node.maxHeight),
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box',
    position: 'relative',
    overflow: node.cornerRadius ? 'hidden' : undefined,
    ...(parentLayout ? childStyle(node, parentLayout) : {}),
    ...(grow ? { flex: '1 1 auto' } : {}),
  };
  if (node.position === 'absolute' && parentLayout) style.position = 'absolute';
  const items: Node[] = Array.isArray(node.contents) ? node.contents : [];
  return (
    <div style={style} title={typeof node.action?.uri === 'string' ? node.action.uri : undefined}>
      {items.map((c, i) => (
        <Component key={i} node={c} parentLayout={layout} />
      ))}
    </div>
  );
}

function Text({ node, parentLayout }: { node: Node; parentLayout: Layout }) {
  const size = TEXT_SIZE[node.size as string] ?? (typeof node.size === 'string' && /px$/.test(node.size) ? parseInt(node.size, 10) : 16);
  const maxLines = typeof node.maxLines === 'number' && node.maxLines > 0 ? node.maxLines : undefined;
  const style: React.CSSProperties = {
    fontSize: size,
    lineHeight: node.lineSpacing ? `calc(${flexLineHeightPx(size)}px + ${len(node.lineSpacing)})` : `${flexLineHeightPx(size)}px`,
    fontWeight: node.weight === 'bold' ? WEIGHT_BOLD : WEIGHT_REGULAR,
    color: node.color ?? DEFAULT_TEXT,
    textAlign: node.align === 'center' ? 'center' : node.align === 'end' ? 'right' : 'left',
    whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap',
    overflow: 'hidden',
    textOverflow: node.wrap ? undefined : 'ellipsis',
    minWidth: 0,
    wordBreak: 'break-word',
    textDecoration: node.decoration === 'underline' ? 'underline' : node.decoration === 'line-through' ? 'line-through' : undefined,
    fontStyle: node.style === 'italic' ? 'italic' : undefined,
    ...(maxLines ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' as const, whiteSpace: 'pre-wrap' } : {}),
    ...childStyle(node, parentLayout),
  };
  const title = typeof node.action?.uri === 'string' ? node.action.uri : undefined;
  if (Array.isArray(node.contents) && node.contents.length > 0) {
    return (
      <div style={style} title={title}>
        {node.contents.map((s: Node, i: number) => (
          <span
            key={i}
            style={{
              color: s.color,
              fontWeight: s.weight === 'bold' ? WEIGHT_BOLD : s.weight === 'regular' ? WEIGHT_REGULAR : undefined,
              fontSize: TEXT_SIZE[s.size as string],
              textDecoration: s.decoration === 'underline' ? 'underline' : s.decoration === 'line-through' ? 'line-through' : undefined,
              fontStyle: s.style === 'italic' ? 'italic' : undefined,
            }}
          >
            {s.text}
          </span>
        ))}
      </div>
    );
  }
  return <div style={style} title={title}>{typeof node.text === 'string' ? node.text : ''}</div>;
}

function Image({ node, parentLayout }: { node: Node; parentLayout: Layout }) {
  const width = IMAGE_SIZE[node.size as string] ?? (typeof node.size === 'string' && /px|%/.test(node.size) ? node.size : '100px');
  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : 'center',
    minWidth: 0,
    ...childStyle(node, parentLayout),
  };
  const imgStyle: React.CSSProperties = {
    width,
    maxWidth: '100%',
    aspectRatio: aspect(node.aspectRatio) ?? '1 / 1',
    objectFit: node.aspectMode === 'cover' ? 'cover' : 'contain',
    display: 'block',
    backgroundColor: node.backgroundColor ?? (node.url ? undefined : '#e9e9e9'),
    borderRadius: len(node.cornerRadius, CORNER),
  };
  return (
    <div style={wrapStyle} title={typeof node.action?.uri === 'string' ? node.action.uri : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={imgStyle} draggable={false} />
    </div>
  );
}

function Button({ node, parentLayout }: { node: Node; parentLayout: Layout }) {
  const primary = node.style === 'primary';
  const secondary = node.style === 'secondary';
  const accent = node.color ?? (primary ? '#17c950' : secondary ? '#dcdfe5' : LINK_COLOR);
  const style: React.CSSProperties = {
    height: node.height === 'sm' ? 40 : 52,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: WEIGHT_REGULAR,
    backgroundColor: primary ? accent : secondary ? accent : 'transparent',
    color: primary ? '#ffffff' : secondary ? '#111111' : accent,
    paddingLeft: 12,
    paddingRight: 12,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    cursor: 'default',
    ...childStyle(node, parentLayout),
  };
  const label = typeof node.action?.label === 'string' ? node.action.label : 'ボタン';
  const uri = typeof node.action?.uri === 'string' ? node.action.uri : typeof node.action?.text === 'string' ? `送信: ${node.action.text}` : '';
  return (
    <div style={style} title={uri}>
      {label}
    </div>
  );
}

function Component({ node, parentLayout }: { node: Node; parentLayout: Layout }) {
  if (!node || typeof node !== 'object') return null;
  switch (node.type) {
    case 'box':
      return <Box node={node} parentLayout={parentLayout} />;
    case 'text':
      return <Text node={node} parentLayout={parentLayout} />;
    case 'image':
      return <Image node={node} parentLayout={parentLayout} />;
    case 'video':
      return <Image node={{ ...node, url: node.previewUrl, aspectRatio: node.aspectRatio ?? '16:9', size: 'full', aspectMode: 'cover' }} parentLayout={parentLayout} />;
    case 'button':
      return <Button node={node} parentLayout={parentLayout} />;
    case 'separator':
      return parentLayout === 'vertical'
        ? <div style={{ borderTop: `1px solid ${node.color ?? '#e6e6e6'}`, marginTop: len(node.margin), width: '100%', flex: '0 0 auto' }} />
        : <div style={{ borderLeft: `1px solid ${node.color ?? '#e6e6e6'}`, marginLeft: len(node.margin), alignSelf: 'stretch', flex: '0 0 auto' }} />;
    case 'spacer':
      return <div style={{ [parentLayout === 'vertical' ? 'height' : 'width']: len(node.size) ?? '8px', flex: '0 0 auto' }} />;
    case 'filler':
      return <div style={{ flex: typeof node.flex === 'number' ? `${node.flex} ${node.flex} 0%` : '1 1 0%' }} />;
    case 'icon': {
      const s = TEXT_SIZE[node.size as string] ?? 16;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={{ height: s, aspectRatio: aspect(node.aspectRatio) ?? '1 / 1', objectFit: 'contain', flex: '0 0 auto', marginLeft: parentLayout !== 'vertical' ? len(node.margin) : undefined, marginTop: parentLayout === 'vertical' ? len(node.margin) : undefined, alignSelf: 'baseline' }} />;
    }
    case 'span':
      return <span style={{ color: node.color, fontWeight: node.weight === 'bold' ? WEIGHT_BOLD : undefined }}>{node.text}</span>;
    default:
      return null;
  }
}

function Bubble({ node }: { node: Node }) {
  const sizeKey = typeof node.size === 'string' && node.size in BUBBLE_WIDTH ? node.size : 'mega';
  const width = Math.min(BUBBLE_WIDTH[sizeKey], BUBBLE_MAX_WIDTH);
  const styles = (node.styles ?? {}) as Node;
  const header = node.header as Node | undefined;
  const body = node.body as Node | undefined;
  const footer = node.footer as Node | undefined;
  const hero = node.hero as Node | undefined;
  const sep = (key: string): React.CSSProperties => (styles[key]?.separator ? { borderTop: `1px solid ${styles[key]?.separatorColor ?? '#e6e6e6'}` } : {});
  const blockBg = (key: string): React.CSSProperties => (styles[key]?.backgroundColor ? { backgroundColor: styles[key].backgroundColor } : {});
  return (
    <div
      style={{
        width,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ffffff',
        borderRadius: BUBBLE_RADIUS[sizeKey] ?? 17,
        overflow: 'hidden',
        fontFamily: FONT,
        direction: node.direction === 'rtl' ? 'rtl' : 'ltr',
        WebkitFontSmoothing: 'antialiased',
      }}
      data-slot="flex-bubble"
    >
      {header && <div style={{ ...sep('header'), ...blockBg('header'), flex: '0 0 auto' }}><Box node={header} isBlock blockStyle={styles.header} /></div>}
      {hero && (
        <div style={{ ...sep('hero'), flex: '0 0 auto' }}>
          {hero.type === 'box' ? <Box node={hero} blockStyle={styles.hero} /> : <Component node={{ ...hero, size: hero.size ?? 'full', aspectRatio: hero.aspectRatio ?? '20:13', aspectMode: hero.aspectMode ?? 'cover' }} parentLayout="vertical" />}
        </div>
      )}
      {/* body はバブルの高さが揃うときに伸びる（LINE と同じ）。背景色も一緒に伸びる */}
      {body && <div style={{ ...sep('body'), ...blockBg('body'), backgroundColor: body.backgroundColor ?? styles.body?.backgroundColor, flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}><Box node={body} isBlock blockStyle={styles.body} grow /></div>}
      {footer && <div style={{ ...sep('footer'), ...blockBg('footer'), flex: '0 0 auto' }}><Box node={footer} isBlock blockStyle={styles.footer} /></div>}
    </div>
  );
}

/**
 * カルーセルの横スクロール。マウスの左ボタンを押したまま左右に動かすとスワイプのようにスクロールできる
 * （スマホ画面は CSS zoom で縮小しているので、マウスの移動量は倍率で割って scrollLeft に足す）
 */
function DragScroll({ scale, enabled, children }: { scale: number; enabled: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = ref.current;
    if (!el) return;
    drag.current = { x: e.clientX, left: el.scrollLeft };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    el.scrollLeft = d.left - (e.clientX - d.x) / (scale || 1);
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      style={{ cursor: enabled ? (dragging ? 'grabbing' : 'grab') : undefined, userSelect: 'none', touchAction: 'pan-y' }}
      className="flex min-w-0 flex-1 items-stretch gap-[10px] overflow-x-auto pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      title={enabled ? 'ドラッグで横にスクロール' : undefined}
    >
      {children}
    </div>
  );
}

/** トーク画面の 1 通（Flex = バブル列 / テキスト / 画像 / 動画） */
function ChatMessage({ message, scale }: { message: PreviewMessage; scale: number }) {
  if (message.type === 'flex') {
    const node = message.contents as Node;
    const bubbles: Node[] = node.type === 'carousel' && Array.isArray(node.contents) ? node.contents : [node];
    return (
      <div className="flex items-end gap-[6px]">
        <DragScroll scale={scale} enabled={bubbles.length > 1}>
          {bubbles.map((b, i) => (
            <Bubble key={i} node={b} />
          ))}
        </DragScroll>
      </div>
    );
  }
  if (message.type === 'text') {
    return (
      <div style={{ maxWidth: 260, backgroundColor: '#ffffff', borderRadius: 17, padding: '9px 13px', fontSize: 16, lineHeight: `${flexLineHeightPx(16)}px`, fontWeight: WEIGHT_REGULAR, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: DEFAULT_TEXT, fontFamily: FONT, width: 'fit-content' }} data-slot="chat-text">
        {message.text}
      </div>
    );
  }
  if (message.type === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={message.url} alt="" draggable={false} style={{ width: 240, maxWidth: '100%', borderRadius: 17, display: 'block', backgroundColor: '#e9e9e9', minHeight: 60 }} data-slot="chat-image" />
    );
  }
  return (
    <div style={{ position: 'relative', width: 240, borderRadius: 17, overflow: 'hidden', backgroundColor: '#222' }} data-slot="chat-video" title={message.url}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={message.previewUrl} alt="" draggable={false} style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover', opacity: 0.9 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '15px solid #fff', marginLeft: 4 }} />
        </div>
      </div>
    </div>
  );
}

/** Apple のフォント（ヒラギノ角ゴ）が使える環境か */
function isApplePlatform(): boolean {
  try {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  } catch {
    return false;
  }
}

let fontsRequested = false;

/**
 * プレビュー用のフォントを 1 回だけ読み込む。
 * - Apple 環境: 端末のヒラギノ角ゴを 92% で使う @font-face を入れるだけ（通信なし）
 * - それ以外: 英数字用の Inter を <link> で、日本語用の Noto Sans JP は Google の CSS を取得して
 *   「92%・日本語の範囲だけ・350 / 600 を regular / bold に」書き換えてから <style> で入れる（buildScaledJpFontCss）。
 *   取得に失敗したら通常の Noto Sans JP を <link> で読み込む（大きさは合わないが表示はできる）
 */
function useWebFont() {
  useEffect(() => {
    if (typeof document === 'undefined' || fontsRequested || document.getElementById(FONT_STYLE_ID)) return;
    fontsRequested = true;
    const addStyle = (css: string) => {
      const style = document.createElement('style');
      style.id = FONT_STYLE_ID;
      style.textContent = css;
      document.head.appendChild(style);
    };
    const addLink = (href: string) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    if (isApplePlatform()) {
      addStyle(APPLE_JP_FONT_CSS);
      return;
    }
    addLink(GOOGLE_LATIN_FONT_CSS_URL);
    fetch(GOOGLE_JP_FONT_CSS_URL)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((css) => {
        const scaled = buildScaledJpFontCss(css);
        if (!scaled) throw new Error('empty');
        addStyle(scaled);
      })
      .catch(() => addLink('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap'));
  }, []);
}

/** 欄の幅に合わせてスマホ画面（390px）を縮小する倍率 */
function useFitScale(maxScale: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(maxScale, w / PHONE_OUTER_WIDTH));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxScale]);
  return { ref, scale };
}

export default function FlexPreview({
  contents,
  altText,
  messages,
  className,
  maxScale = 1,
}: {
  /** Flex 1 通だけのとき */
  contents: FlexContainer | null;
  altText?: string;
  /** まとめて送る複数のメッセージ（指定があれば contents より優先。順番どおりにトーク画面に並べる） */
  messages?: PreviewMessage[];
  className?: string;
  /** 欄が広いときの最大倍率（1 = 実寸） */
  maxScale?: number;
}) {
  useWebFont();
  const { ref, scale } = useFitScale(maxScale);
  const list: PreviewMessage[] = messages ?? (contents ? [{ type: 'flex', contents, altText }] : []);
  if (list.length === 0) {
    return (
      <div className={`rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground ${className ?? ''}`}>
        見出しや本文を入力すると、ここにプレビューが表示されます
      </div>
    );
  }
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const firstFlex = list.find((m) => m.type === 'flex');
  const notice = altText ?? (firstFlex && firstFlex.type === 'flex' ? firstFlex.altText : undefined);
  const hasCarousel = list.some((m) => m.type === 'flex' && (m.contents as Node).type === 'carousel');
  return (
    <div className={className} data-slot="flex-preview" ref={ref}>
      <div
        style={{ zoom: scale, width: PHONE_OUTER_WIDTH, borderWidth: PHONE_BORDER, fontFamily: FONT }}
        className="overflow-hidden rounded-[28px] border-solid border-[#1c1c1e] bg-black shadow-md"
        data-slot="flex-phone"
      >
        {/* ステータスバー */}
        <div className="flex items-center justify-between px-6 pt-2 pb-1 text-[13px] font-semibold text-white" style={{ backgroundColor: CHAT_BG }}>
          <span>{time}</span>
          <span className="flex items-center gap-1 text-[11px]">●●● <span className="inline-block h-[10px] w-[20px] rounded-[3px] border border-white/90 align-middle" /></span>
        </div>
        {/* トーク画面 */}
        <div style={{ backgroundColor: CHAT_BG, minHeight: 260, paddingLeft: CHAT_SIDE_PADDING, paddingRight: CHAT_SIDE_PADDING }} className="pb-4 pt-3">
          {notice ? (
            <div className="mb-2 flex justify-center">
              <span className="max-w-[80%] truncate rounded-full bg-black/20 px-3 py-0.5 text-[11px] text-white" title="通知・トーク一覧に出る文">通知: {notice}</span>
            </div>
          ) : null}
          <div className="mb-[6px] h-[32px] w-[32px] rounded-full border border-white/40" style={{ backgroundImage: 'linear-gradient(135deg, #f1f1f1, #c9d1dd)' }} aria-hidden="true" />
          {list.map((m, i) => (
            <div key={i} className={i > 0 ? 'mt-[8px]' : undefined} data-slot="chat-message">
              <ChatMessage message={m} scale={scale} />
              <div className="mt-[4px] text-right text-[11px] text-white/95" style={{ paddingRight: 2 }}>{time}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        ※ iPhone の LINE（幅 390px）に合わせた近似表示です{scale < 1 ? `（${Math.round(scale * 100)}% に縮小）` : ''}。
        {hasCarousel ? 'カルーセルはマウスで左右にドラッグするとスクロールできます。' : ''}
        {list.length > 1 ? `${list.length} 通をこの順番で送ります。` : ''}
        最終確認は「テスト送信」でどうぞ
      </p>
    </div>
  );
}
