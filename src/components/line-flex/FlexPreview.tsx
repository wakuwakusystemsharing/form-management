'use client';

/**
 * Flex Message のプレビュー（iPhone の LINE トーク画面に寄せた HTML 近似）
 *
 * - 幅 390px（iPhone の CSS px）のスマホ画面の枠に、LINE と同じ縮尺でトーク画面を再現し、欄の幅に合わせて自動で縮小する（CSS zoom）
 * - LINE の仕様値: バブル幅 nano 120 / micro 160 / deca 220 / hecto 241 / kilo 260 / mega 300 / giga 386 px、角丸 17px
 *   文字サイズ xxs 11 / xs 13 / sm 14 / md 16（既定）/ lg 19 / xl 22 / xxl 29 / 3xl 35 / 4xl 48 / 5xl 74 px
 *   余白 none 0 / xs 2 / sm 4 / md 8 / lg 12 / xl 16 / xxl 20 px、ブロック（header / body / footer）の既定 padding 20px
 *   画像 xxs 40 … 5xl 220 px / full（既定 md・1:1・fit）、ボタン高さ sm 40 / md 52 px・角丸 8px
 *   horizontal / baseline の子は flex 1、vertical の子は flex 0 が既定。カルーセルのバブルは最も高いものに揃う（body が伸びる）
 * - フォントは iPhone の LINE（ヒラギノ角ゴ）に寄せる。無い環境では Noto Sans JP（Web フォント）
 * 対応: bubble / carousel / box / text / span / image / button / separator / spacer / icon / filler / video（静止画）
 */
import React, { useEffect, useRef, useState } from 'react';
import type { FlexContainer } from '@/types/line-flex';

type Node = Record<string, any>;
type Layout = 'vertical' | 'horizontal' | 'baseline';

export const PHONE_WIDTH = 390;
const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT_SIZE: Record<string, number> = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const BUBBLE_WIDTH: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 386 };
const IMAGE_SIZE: Record<string, string> = { xxs: '40px', xs: '60px', sm: '80px', md: '100px', lg: '120px', xl: '140px', xxl: '160px', '3xl': '180px', '4xl': '200px', '5xl': '220px', full: '100%' };
const BORDER_WIDTH: Record<string, string> = { none: '0px', light: '0.5px', normal: '1px', medium: '2px', 'semi-bold': '3px', bold: '4px' };
const CORNER: Record<string, string> = { none: '0px', xs: '2px', sm: '4px', md: '8px', lg: '12px', xl: '16px', xxl: '20px' };
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';
const LINK_COLOR = '#42659a';
const DEFAULT_TEXT = '#000000';
const CHAT_BG = '#7e9ccb';
const WEBFONT_ID = 'flex-preview-noto-sans-jp';

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
    lineHeight: node.lineSpacing ? `calc(1.4em + ${len(node.lineSpacing)})` : 1.4,
    fontWeight: node.weight === 'bold' ? 700 : 400,
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
              fontWeight: s.weight === 'bold' ? 700 : undefined,
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
      <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={imgStyle} />
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
    fontWeight: 400,
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
      return <span style={{ color: node.color, fontWeight: node.weight === 'bold' ? 700 : undefined }}>{node.text}</span>;
    default:
      return null;
  }
}

function Bubble({ node }: { node: Node }) {
  const width = BUBBLE_WIDTH[node.size as string] ?? BUBBLE_WIDTH.mega;
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
        borderRadius: 17,
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

/** Noto Sans JP（ヒラギノが無い Windows 用）を 1 回だけ読み込む */
function useWebFont() {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(WEBFONT_ID)) return;
    const link = document.createElement('link');
    link.id = WEBFONT_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap';
    document.head.appendChild(link);
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
      if (w > 0) setScale(Math.min(maxScale, w / PHONE_WIDTH));
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
  className,
  maxScale = 1,
}: {
  contents: FlexContainer | null;
  altText?: string;
  className?: string;
  /** 欄が広いときの最大倍率（1 = 実寸） */
  maxScale?: number;
}) {
  useWebFont();
  const { ref, scale } = useFitScale(maxScale);
  if (!contents) {
    return (
      <div className={`rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground ${className ?? ''}`}>
        見出しや本文を入力すると、ここにプレビューが表示されます
      </div>
    );
  }
  const node = contents as Node;
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const bubbles: Node[] = node.type === 'carousel' && Array.isArray(node.contents) ? node.contents : [node];
  return (
    <div className={className} data-slot="flex-preview" ref={ref}>
      <div style={{ zoom: scale, width: PHONE_WIDTH, fontFamily: FONT }} className="overflow-hidden rounded-[28px] border-[6px] border-[#1c1c1e] bg-black shadow-md">
        {/* ステータスバー */}
        <div className="flex items-center justify-between px-6 pt-2 pb-1 text-[13px] font-semibold text-white" style={{ backgroundColor: CHAT_BG }}>
          <span>{time}</span>
          <span className="flex items-center gap-1 text-[11px]">●●● <span className="inline-block h-[10px] w-[20px] rounded-[3px] border border-white/90 align-middle" /></span>
        </div>
        {/* トーク画面 */}
        <div style={{ backgroundColor: CHAT_BG, minHeight: 260 }} className="px-[10px] pb-4 pt-3">
          {altText ? (
            <div className="mb-2 flex justify-center">
              <span className="max-w-[80%] truncate rounded-full bg-black/20 px-3 py-0.5 text-[11px] text-white" title="通知・トーク一覧に出る文">通知: {altText}</span>
            </div>
          ) : null}
          <div className="mb-[6px] h-[32px] w-[32px] rounded-full border border-white/40" style={{ backgroundImage: 'linear-gradient(135deg, #f1f1f1, #c9d1dd)' }} aria-hidden="true" />
          <div className="flex items-end gap-[6px]">
            <div className="flex min-w-0 flex-1 items-stretch gap-[10px] overflow-x-auto pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {bubbles.map((b, i) => (
                <Bubble key={i} node={b} />
              ))}
            </div>
          </div>
          <div className="mt-[4px] text-right text-[11px] text-white/95" style={{ paddingRight: 2 }}>{time}</div>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        ※ iPhone の LINE（幅 390px）に合わせた近似表示です{scale < 1 ? `（${Math.round(scale * 100)}% に縮小）` : ''}。カルーセルは横にスクロールできます。最終確認は「テスト送信」でどうぞ
      </p>
    </div>
  );
}
