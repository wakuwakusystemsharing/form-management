'use client';

/**
 * Flex Message のプレビュー（LINE アプリの描画にできるだけ寄せた HTML 近似）
 *
 * LINE の仕様値に合わせている:
 * - バブル幅 nano 120 / micro 160 / deca 220 / hecto 241 / kilo 260 / mega 300 / giga 386 px、角丸 17px
 * - 文字サイズ xxs 11 / xs 13 / sm 14 / md 16（既定）/ lg 19 / xl 22 / xxl 29 / 3xl 35 / 4xl 48 / 5xl 74 px
 * - 余白 none 0 / xs 2 / sm 4 / md 8 / lg 12 / xl 16 / xxl 20 px、ブロック（header / body / footer）の既定 padding 20px
 * - 画像サイズ xxs 40 … 5xl 220 px / full、既定 md 100px・1:1・fit
 * - ボタン高さ sm 40 / md 52 px、角丸 8px。primary = 塗り（既定 #17c950）、secondary = 薄いグレー、link = 文字のみ
 * - horizontal / baseline の子は flex 1 が既定、vertical の子は flex 0
 * 対応コンポーネント: bubble / carousel / box / text / span / image / button / separator / spacer / icon / filler / video(静止画)
 */
import React from 'react';
import type { FlexContainer } from '@/types/line-flex';

type Node = Record<string, any>;

const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT_SIZE: Record<string, number> = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const BUBBLE_WIDTH: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 386 };
const IMAGE_SIZE: Record<string, string> = { xxs: '40px', xs: '60px', sm: '80px', md: '100px', lg: '120px', xl: '140px', xxl: '160px', '3xl': '180px', '4xl': '200px', '5xl': '220px', full: '100%' };
const BORDER_WIDTH: Record<string, string> = { none: '0px', light: '0.5px', normal: '1px', medium: '2px', 'semi-bold': '3px', bold: '4px' };
const CORNER: Record<string, string> = { none: '0px', xs: '2px', sm: '4px', md: '8px', lg: '12px', xl: '16px', xxl: '20px' };
const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", Roboto, sans-serif';
const LINK_COLOR = '#42659a';
const DEFAULT_TEXT = '#000000';

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

/** 親の layout から子の既定 flex と、gravity / align を CSS に */
function childStyle(node: Node, parentLayout: 'vertical' | 'horizontal' | 'baseline'): React.CSSProperties {
  const style: React.CSSProperties = {};
  const horizontal = parentLayout !== 'vertical';
  const hasFixedWidth = typeof node.width === 'string' && node.type === 'box';
  const defaultFlex = horizontal && !hasFixedWidth ? 1 : 0;
  const flex = typeof node.flex === 'number' ? node.flex : defaultFlex;
  style.flex = flex === 0 ? '0 0 auto' : `${flex} ${flex} 0%`;
  if (node.gravity === 'center') style.alignSelf = 'center';
  else if (node.gravity === 'bottom') style.alignSelf = 'flex-end';
  else if (node.gravity === 'top') style.alignSelf = 'flex-start';
  if (node.position === 'absolute') {
    style.position = 'absolute';
    style.top = len(node.offsetTop);
    style.bottom = len(node.offsetBottom);
    style.left = len(node.offsetStart);
    style.right = len(node.offsetEnd);
  } else {
    if (node.offsetTop || node.offsetBottom || node.offsetStart || node.offsetEnd) style.position = 'relative';
    style.top = len(node.offsetTop);
    style.bottom = len(node.offsetBottom);
    style.left = len(node.offsetStart);
    style.right = len(node.offsetEnd);
  }
  style.marginTop = parentLayout === 'vertical' ? len(node.margin) : undefined;
  style.marginLeft = parentLayout !== 'vertical' ? len(node.margin) : undefined;
  return style;
}

function Box({ node, parentLayout, isBlock, blockStyle }: { node: Node; parentLayout?: 'vertical' | 'horizontal' | 'baseline'; isBlock?: boolean; blockStyle?: Node }) {
  const layout: 'vertical' | 'horizontal' | 'baseline' = node.layout === 'horizontal' ? 'horizontal' : node.layout === 'baseline' ? 'baseline' : 'vertical';
  const gap = len(node.spacing) ?? '0px';
  const bg = node.backgroundColor ?? blockStyle?.backgroundColor;
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'vertical' ? 'column' : 'row',
    alignItems: layout === 'baseline' ? 'baseline' : node.alignItems === 'center' ? 'center' : node.alignItems === 'flex-end' ? 'flex-end' : node.alignItems === 'flex-start' ? 'flex-start' : 'stretch',
    justifyContent: node.justifyContent ?? 'flex-start',
    gap,
    backgroundColor: bg,
    backgroundImage: gradient(node.background),
    borderRadius: len(node.cornerRadius, CORNER),
    borderWidth: node.borderWidth ? len(node.borderWidth, BORDER_WIDTH) : undefined,
    borderStyle: node.borderWidth ? 'solid' : undefined,
    borderColor: node.borderColor,
    padding: len(node.paddingAll) ?? (isBlock ? '20px' : undefined),
    paddingTop: len(node.paddingTop),
    paddingBottom: len(node.paddingBottom),
    paddingLeft: len(node.paddingStart),
    paddingRight: len(node.paddingEnd),
    width: isBlock ? undefined : len(node.width),
    height: len(node.height),
    maxWidth: len(node.maxWidth),
    maxHeight: len(node.maxHeight),
    minWidth: 0,
    position: 'relative',
    overflow: node.cornerRadius ? 'hidden' : undefined,
    ...(parentLayout ? childStyle(node, parentLayout) : {}),
  };
  if (node.position === 'absolute' && parentLayout) style.position = 'absolute';
  const items: Node[] = Array.isArray(node.contents) ? node.contents : [];
  const action = node.action;
  return (
    <div style={style} title={typeof action?.uri === 'string' ? action.uri : undefined}>
      {items.map((c, i) => (
        <Component key={i} node={c} parentLayout={layout} />
      ))}
    </div>
  );
}

function Text({ node, parentLayout }: { node: Node; parentLayout: 'vertical' | 'horizontal' | 'baseline' }) {
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
  if (Array.isArray(node.contents) && node.contents.length > 0) {
    return (
      <div style={style}>
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
  return <div style={style}>{typeof node.text === 'string' ? node.text : ''}</div>;
}

function Image({ node, parentLayout }: { node: Node; parentLayout: 'vertical' | 'horizontal' | 'baseline' }) {
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

function Button({ node, parentLayout }: { node: Node; parentLayout: 'vertical' | 'horizontal' | 'baseline' }) {
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
    padding: '0 12px',
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

function Component({ node, parentLayout }: { node: Node; parentLayout: 'vertical' | 'horizontal' | 'baseline' }) {
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
      const ratio = aspect(node.aspectRatio) ?? '1 / 1';
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={{ height: s, aspectRatio: ratio, objectFit: 'contain', flex: '0 0 auto', marginLeft: parentLayout !== 'vertical' ? len(node.margin) : undefined, marginTop: parentLayout === 'vertical' ? len(node.margin) : undefined, alignSelf: 'baseline' }} />;
    }
    case 'span':
      return <span style={{ color: node.color, fontWeight: node.weight === 'bold' ? 700 : undefined }}>{node.text}</span>;
    default:
      return null;
  }
}

function Bubble({ node, inCarousel }: { node: Node; inCarousel?: boolean }) {
  const width = BUBBLE_WIDTH[node.size as string] ?? BUBBLE_WIDTH.mega;
  const styles = (node.styles ?? {}) as Node;
  const header = node.header as Node | undefined;
  const body = node.body as Node | undefined;
  const footer = node.footer as Node | undefined;
  const hero = node.hero as Node | undefined;
  const sep = (key: string) => (styles[key]?.separator ? { borderTop: `1px solid ${styles[key]?.separatorColor ?? '#e6e6e6'}` } : {});
  return (
    <div
      style={{
        width,
        maxWidth: inCarousel ? undefined : '100%',
        flex: '0 0 auto',
        backgroundColor: '#ffffff',
        borderRadius: 17,
        overflow: 'hidden',
        fontFamily: FONT,
        direction: node.direction === 'rtl' ? 'rtl' : 'ltr',
      }}
      data-slot="flex-bubble"
    >
      {header && <div style={sep('header')}><Box node={header} isBlock blockStyle={styles.header} /></div>}
      {hero && (
        <div style={sep('hero')}>
          {hero.type === 'box' ? <Box node={hero} blockStyle={styles.hero} /> : <Component node={{ ...hero, size: hero.size ?? 'full', aspectRatio: hero.aspectRatio ?? '20:13', aspectMode: hero.aspectMode ?? 'cover' }} parentLayout="vertical" />}
        </div>
      )}
      {body && <div style={sep('body')}><Box node={body} isBlock blockStyle={styles.body} /></div>}
      {footer && <div style={sep('footer')}><Box node={footer} isBlock blockStyle={styles.footer} /></div>}
    </div>
  );
}

export default function FlexPreview({ contents, altText, className, accountName = '公式アカウント' }: { contents: FlexContainer | null; altText?: string; className?: string; accountName?: string }) {
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
  return (
    <div className={className} data-slot="flex-preview">
      <div className="rounded-2xl p-3 pb-4" style={{ backgroundColor: '#7494c0', fontFamily: FONT }}>
        {altText ? <p className="mb-2 truncate text-[11px] text-white/80" title="通知・トーク一覧に出る文">通知・トーク一覧: {altText}</p> : null}
        <div className="flex items-start gap-2">
          <div className="mt-5 h-8 w-8 shrink-0 rounded-full" style={{ backgroundColor: '#ffffff', backgroundImage: 'linear-gradient(135deg, #e6e6e6, #cfd6e0)' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="mb-1 truncate text-[12px] text-white">{accountName}</p>
            <div className="flex items-end gap-1.5">
              <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 pr-1 [scrollbar-width:thin]">
                {node.type === 'carousel' && Array.isArray(node.contents)
                  ? node.contents.map((b: Node, i: number) => <Bubble key={i} node={b} inCarousel />)
                  : <Bubble node={node} />}
              </div>
              <span className="shrink-0 pb-1 text-[10px] leading-none text-white/90">{time}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">※ LINE の仕様値（幅・文字サイズ・余白）に合わせた近似表示です。端末やフォントで細部は変わるため、最終確認は「テスト送信」でどうぞ</p>
    </div>
  );
}
