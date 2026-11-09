'use client';

/**
 * Flex Message の見た目を HTML で近似表示する（編集画面のプレビュー用）
 * LINE の描画とは細部が異なる。対応: bubble / carousel / box / text / span / image / button / separator / spacer / icon / filler
 */
import React from 'react';
import type { FlexContainer } from '@/types/line-flex';

type Node = Record<string, any>;

const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT_SIZE: Record<string, number> = { xxs: 11, xs: 12, sm: 13, md: 14, lg: 16, xl: 18, xxl: 20, '3xl': 24, '4xl': 28, '5xl': 32 };
const BUBBLE_WIDTH: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 340 };
const IMAGE_WIDTH: Record<string, string> = { xxs: '40px', xs: '60px', sm: '80px', md: '100px', lg: '120px', xl: '140px', xxl: '160px', '3xl': '180px', '4xl': '200px', '5xl': '220px', full: '100%' };

function px(v: unknown): string | undefined {
  if (typeof v === 'number') return `${v}px`;
  if (typeof v !== 'string') return undefined;
  if (v in SPACING) return `${SPACING[v]}px`;
  return v; // "20px" / "5%"
}
function aspect(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return m ? `${m[1]} / ${m[2]}` : undefined;
}

function Box({ node, isBlock }: { node: Node; isBlock?: boolean }) {
  const layout = node.layout === 'horizontal' || node.layout === 'baseline' ? 'row' : 'column';
  const gap = px(node.spacing) ?? '0px';
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout,
    alignItems: node.layout === 'baseline' ? 'baseline' : node.alignItems === 'center' ? 'center' : node.alignItems === 'flex-end' ? 'flex-end' : 'stretch',
    justifyContent: node.justifyContent ?? 'flex-start',
    gap,
    backgroundColor: node.backgroundColor,
    borderRadius: px(node.cornerRadius),
    borderWidth: node.borderWidth ? px(node.borderWidth) : undefined,
    borderStyle: node.borderWidth ? 'solid' : undefined,
    borderColor: node.borderColor,
    padding: px(node.paddingAll) ?? (isBlock ? '20px' : undefined),
    paddingTop: px(node.paddingTop),
    paddingBottom: px(node.paddingBottom),
    paddingLeft: px(node.paddingStart),
    paddingRight: px(node.paddingEnd),
    marginTop: px(node.margin),
    flex: typeof node.flex === 'number' ? node.flex : undefined,
    width: px(node.width),
    height: px(node.height),
    minWidth: 0,
  };
  const items: Node[] = Array.isArray(node.contents) ? node.contents : [];
  return (
    <div style={style}>
      {items.map((c, i) => (
        <Component key={i} node={c} />
      ))}
    </div>
  );
}

function Text({ node }: { node: Node }) {
  const size = TEXT_SIZE[node.size as string] ?? 14;
  const style: React.CSSProperties = {
    fontSize: size,
    lineHeight: 1.4,
    fontWeight: node.weight === 'bold' ? 700 : 400,
    color: node.color ?? '#111111',
    textAlign: node.align ?? 'start',
    whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap',
    overflow: node.wrap ? undefined : 'hidden',
    textOverflow: node.wrap ? undefined : 'ellipsis',
    marginTop: px(node.margin),
    flex: typeof node.flex === 'number' ? node.flex : undefined,
    minWidth: 0,
    wordBreak: 'break-word',
    textDecoration: node.decoration,
    fontStyle: node.style === 'italic' ? 'italic' : undefined,
  };
  if (Array.isArray(node.contents) && node.contents.length > 0) {
    return (
      <div style={style}>
        {node.contents.map((s: Node, i: number) => (
          <span key={i} style={{ color: s.color, fontWeight: s.weight === 'bold' ? 700 : undefined, fontSize: TEXT_SIZE[s.size as string], textDecoration: s.decoration }}>
            {s.text}
          </span>
        ))}
      </div>
    );
  }
  return <div style={style}>{typeof node.text === 'string' ? node.text : ''}</div>;
}

function Image({ node }: { node: Node }) {
  const width = IMAGE_WIDTH[node.size as string] ?? (typeof node.size === 'string' && /px|%/.test(node.size) ? node.size : '100%');
  const style: React.CSSProperties = {
    width,
    aspectRatio: aspect(node.aspectRatio) ?? '1 / 1',
    objectFit: node.aspectMode === 'cover' ? 'cover' : 'contain',
    display: 'block',
    marginTop: px(node.margin),
    alignSelf: node.align === 'start' ? 'flex-start' : node.align === 'end' ? 'flex-end' : 'center',
    backgroundColor: node.backgroundColor ?? '#f3f4f6',
    borderRadius: px(node.cornerRadius),
    flex: typeof node.flex === 'number' ? node.flex : undefined,
  };
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={style} />;
}

function Button({ node }: { node: Node }) {
  const primary = node.style === 'primary';
  const link = node.style === 'link';
  const accent = node.color ?? '#17c950';
  const style: React.CSSProperties = {
    height: node.height === 'sm' ? 40 : 52,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: primary ? accent : link ? 'transparent' : '#f1f3f4',
    color: primary ? '#ffffff' : link ? accent : '#111111',
    marginTop: px(node.margin),
    flex: typeof node.flex === 'number' ? node.flex : undefined,
    padding: '0 12px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  };
  const label = typeof node.action?.label === 'string' ? node.action.label : 'ボタン';
  const uri = typeof node.action?.uri === 'string' ? node.action.uri : typeof node.action?.text === 'string' ? `送信: ${node.action.text}` : '';
  return (
    <div style={style} title={uri}>
      {label}
    </div>
  );
}

function Component({ node }: { node: Node }) {
  if (!node || typeof node !== 'object') return null;
  switch (node.type) {
    case 'box':
      return <Box node={node} />;
    case 'text':
      return <Text node={node} />;
    case 'image':
      return <Image node={node} />;
    case 'button':
      return <Button node={node} />;
    case 'separator':
      return <div style={{ borderTop: `1px solid ${node.color ?? '#e5e7eb'}`, marginTop: px(node.margin), width: '100%' }} />;
    case 'spacer':
      return <div style={{ height: px(node.size) ?? '8px' }} />;
    case 'filler':
      return <div style={{ flex: typeof node.flex === 'number' ? node.flex : 1 }} />;
    case 'icon':
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={typeof node.url === 'string' ? node.url : ''} alt="" style={{ width: TEXT_SIZE[node.size as string] ?? 14, height: TEXT_SIZE[node.size as string] ?? 14, marginTop: px(node.margin) }} />;
    case 'span':
      return <span style={{ color: node.color, fontWeight: node.weight === 'bold' ? 700 : undefined }}>{node.text}</span>;
    default:
      return null;
  }
}

function Bubble({ node }: { node: Node }) {
  const width = BUBBLE_WIDTH[node.size as string] ?? BUBBLE_WIDTH.mega;
  const blockStyle = (block: Node | undefined) => (block?.backgroundColor ? { backgroundColor: block.backgroundColor } : undefined);
  const header = node.header as Node | undefined;
  const body = node.body as Node | undefined;
  const footer = node.footer as Node | undefined;
  return (
    <div
      style={{ width, flex: '0 0 auto', backgroundColor: '#ffffff', borderRadius: 17, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', ...(node.styles?.body?.backgroundColor ? { backgroundColor: node.styles.body.backgroundColor } : {}) }}
      data-slot="flex-bubble"
    >
      {header && <div style={blockStyle(node.styles?.header)}><Box node={header} isBlock /></div>}
      {node.hero && <Component node={node.hero} />}
      {body && <div style={blockStyle(node.styles?.body)}><Box node={body} isBlock /></div>}
      {footer && <div style={{ ...(blockStyle(node.styles?.footer) ?? {}), borderTop: node.styles?.footer?.separator ? '1px solid #e5e7eb' : undefined }}><Box node={footer} isBlock /></div>}
    </div>
  );
}

export default function FlexPreview({ contents, altText, className }: { contents: FlexContainer | null; altText?: string; className?: string }) {
  if (!contents) {
    return (
      <div className={`rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground ${className ?? ''}`}>
        見出しや本文を入力すると、ここにプレビューが表示されます
      </div>
    );
  }
  const node = contents as Node;
  return (
    <div className={className} data-slot="flex-preview">
      <div className="rounded-2xl bg-[#8cabd9] p-3">
        {altText ? <p className="mb-2 truncate text-[11px] text-white/80" title="通知・トーク一覧に出る文">通知: {altText}</p> : null}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ fontFamily: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif' }}>
          {node.type === 'carousel' && Array.isArray(node.contents)
            ? node.contents.map((b: Node, i: number) => <Bubble key={i} node={b} />)
            : <Bubble node={node} />}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">※ 実際の LINE 上の見た目とは細部が異なります。正確な確認は「テスト送信」でどうぞ</p>
    </div>
  );
}
