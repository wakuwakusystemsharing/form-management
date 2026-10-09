'use client';

/**
 * 寄せ書きウォールのボード表示（お客様画面と管理画面のプレビューで共通）
 *
 * - 見た目は theme を CSS 変数 + クラス名（形 / 留め方 / 紙）に展開するだけ（店舗ごとにコードは分岐しない）
 * - 付箋の色・傾き・ずれは投稿 ID から決まる（wall-layout.ts）
 * - 演出は CSS のみ（落下・傾き・タップで浮く）。transform / opacity だけをアニメーションする
 */
import React from 'react';
import { noteStyleFor } from '@/lib/wall-layout';
import { wallThemeVars } from '@/lib/wall-themes';
import type { WallPublicPost, WallTheme } from '@/types/wall';

export const WALL_CSS = `
.wall-root { min-height: 100dvh; background: var(--wall-bg); color: var(--wall-text); font-family: var(--wall-font); -webkit-tap-highlight-color: transparent; position: relative; }
.wall-root::after { /* 額縁 */
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 5;
  border: var(--wall-frame-w) solid transparent; border-image: var(--wall-frame) 1;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.25), inset 0 0 24px rgba(0,0,0,.18);
}
.wall-root.is-preview::after { position: absolute; }
.wall-root[data-frame="0"]::after { display: none; }
.wall-header { padding: 22px 16px 8px; text-align: center; }
.wall-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: .04em; text-shadow: 0 1px 0 rgba(255,255,255,.15), 0 2px 6px rgba(0,0,0,.12); }
.wall-subtitle { margin: 6px 0 0; font-size: 13px; opacity: .85; }
.wall-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 14px; padding: 16px 18px 120px; max-width: 760px; margin: 0 auto; }
@media (min-width: 480px) { .wall-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.wall-note {
  position: relative; display: flex; flex-direction: column; aspect-ratio: var(--note-aspect, 1 / 1); width: 100%; padding: 18px 12px 10px;
  border: 0; border-radius: var(--note-radius, 3px); background: var(--note-tex, none), var(--note-bg); background-color: var(--note-bg); color: var(--note-text); text-align: left; font: inherit;
  box-shadow: var(--wall-shadow); cursor: pointer; touch-action: manipulation;
  transform: translate(var(--dx), var(--dy)) rotate(var(--rot));
  transition: transform .18s ease-out, box-shadow .18s ease-out;
}
.wall-note::after { /* 紙の光沢 */
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(160deg, rgba(255,255,255,.28), rgba(255,255,255,0) 45%, rgba(0,0,0,.04) 100%);
}
/* 形 */
.wall-note.shape-rounded { --note-radius: 14px; }
.wall-note.shape-landscape { --note-aspect: 4 / 3; }
/* 紙 */
.wall-note.tex-lined { --note-tex: repeating-linear-gradient(180deg, transparent 0 21px, rgba(0,0,0,.09) 21px 22px); background-position: 0 6px; }
.wall-note.tex-grid { --note-tex: linear-gradient(90deg, rgba(0,0,0,.06) 1px, transparent 1px), linear-gradient(180deg, rgba(0,0,0,.06) 1px, transparent 1px); background-size: 14px 14px, 14px 14px, auto; }
/* 留め方 */
.wall-note::before { /* 押しピン */
  content: ''; position: absolute; top: 6px; left: 50%; width: 13px; height: 13px; margin-left: -6px; border-radius: 50%; z-index: 1;
  background: radial-gradient(circle at 35% 35%, #ff9a9a, #d32f2f 55%, #8e1b1b 100%); box-shadow: 0 2px 3px rgba(0,0,0,.35), inset 0 -1px 1px rgba(0,0,0,.2);
}
.wall-note.pin-tape::before {
  top: -7px; width: 58px; height: 18px; margin-left: -29px; border-radius: 2px; transform: rotate(-3deg);
  background: repeating-linear-gradient(90deg, rgba(255,255,255,.62) 0 6px, rgba(255,255,255,.48) 6px 12px); box-shadow: 0 1px 2px rgba(0,0,0,.18);
  -webkit-mask: linear-gradient(90deg, transparent 0, #000 3px, #000 calc(100% - 3px), transparent 100%); mask: linear-gradient(90deg, transparent 0, #000 3px, #000 calc(100% - 3px), transparent 100%);
}
.wall-note.pin-magnet::before {
  top: 7px; width: 16px; height: 16px; margin-left: -8px;
  background: radial-gradient(circle at 35% 30%, #ffffff, #c9ced6 45%, #7a828d 100%); box-shadow: 0 2px 3px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.35);
}
.wall-note.pin-none::before { display: none; }
.wall-note.pin-none { padding-top: 12px; }
.wall-note.is-lifted { transform: translate(var(--dx), calc(var(--dy) - 4px)) rotate(var(--rot)) scale(1.03); box-shadow: 0 14px 22px rgba(0,0,0,.28); z-index: 2; }
.wall-note.is-dropping { animation: wall-drop .55s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes wall-drop {
  0% { opacity: 0; transform: translate(var(--dx), -140px) rotate(calc(var(--rot) - 12deg)); }
  70% { opacity: 1; transform: translate(var(--dx), calc(var(--dy) + 4px)) rotate(var(--rot)); }
  100% { opacity: 1; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
}
@media (prefers-reduced-motion: reduce) {
  .wall-note, .wall-note.is-lifted { transition: none; }
  .wall-note.is-dropping { animation: none; }
}
.wall-note-body { position: relative; z-index: 1; flex: 1; margin: 0; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
.wall-note-body.is-long { font-size: 12px; line-height: 1.5; }
.wall-note-foot { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; font-size: 10.5px; opacity: .7; }
.wall-note-mine { font-weight: 700; opacity: .9; }
.wall-note-actions { position: relative; z-index: 1; display: flex; gap: 6px; margin-top: 8px; }
.wall-note-action { flex: 1; min-height: 32px; border: 1px solid rgba(0,0,0,.18); border-radius: 16px; background: rgba(255,255,255,.65); color: var(--note-text); font-size: 12px; font-weight: 700; font-family: inherit; }
.wall-note-action.is-danger { color: #b3261e; border-color: rgba(179,38,30,.35); }
.wall-empty { grid-column: 1 / -1; padding: 48px 16px; text-align: center; font-size: 14px; opacity: .85; }
`;

export interface WallBoardViewProps {
  theme: WallTheme;
  posts: WallPublicPost[];
  /** 浮かせている付箋（タップで選択） */
  liftedId?: string | null;
  onToggleLift?: (id: string) => void;
  onReport?: (post: WallPublicPost) => void;
  onDelete?: (post: WallPublicPost) => void;
  droppingIds?: Set<string>;
  emptyText?: string;
  /** プレビューなど、操作ボタンを出さない */
  readOnly?: boolean;
  children?: React.ReactNode;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 3600000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

export function wallRootStyle(theme: WallTheme, accent?: string | null): React.CSSProperties {
  const v = wallThemeVars(theme);
  return {
    ['--wall-bg' as string]: v.background,
    ['--wall-text' as string]: v.textColor,
    ['--wall-font' as string]: v.fontFamily,
    ['--wall-shadow' as string]: v.shadow,
    ['--wall-frame' as string]: v.frame || 'linear-gradient(transparent, transparent)',
    ['--wall-frame-w' as string]: `${v.frameWidth}px`,
    ['--note-text' as string]: v.noteTextColor,
    ['--wall-accent' as string]: accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f49031',
  };
}

/** 額縁の有無を data 属性で渡す（wallRootStyle と一緒に使う） */
export function wallRootFrameAttr(theme: WallTheme): '0' | '1' {
  return wallThemeVars(theme).frameWidth > 0 ? '1' : '0';
}

export function noteClassName(theme: WallTheme): string {
  return `shape-${theme.note_shape} pin-${theme.note_pin} tex-${theme.note_texture}`;
}

export default function WallBoardView({
  theme,
  posts,
  liftedId = null,
  onToggleLift,
  onReport,
  onDelete,
  droppingIds,
  emptyText = '最初の付箋を貼ってみませんか？',
  readOnly = false,
  children,
}: WallBoardViewProps) {
  const designClass = noteClassName(theme);
  return (
    <div className="wall-grid" role="list" aria-label="寄せ書きの付箋">
      {posts.length === 0 && <p className="wall-empty">{emptyText}</p>}
      {posts.map((p) => {
        const s = noteStyleFor(p.id, theme.note_colors);
        const lifted = liftedId === p.id;
        const style = {
          ['--note-bg' as string]: s.color,
          ['--rot' as string]: `${s.rotate}deg`,
          ['--dx' as string]: `${s.offsetX}px`,
          ['--dy' as string]: `${s.offsetY}px`,
        } as React.CSSProperties;
        return (
          <div
            key={p.id}
            role="listitem"
            className={`wall-note ${designClass}${lifted ? ' is-lifted' : ''}${droppingIds?.has(p.id) ? ' is-dropping' : ''}`}
            style={style}
            tabIndex={0}
            aria-expanded={readOnly ? undefined : lifted}
            onClick={() => onToggleLift?.(p.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleLift?.(p.id); } }}
          >
            <p className={`wall-note-body${[...p.body].length > 80 ? ' is-long' : ''}`}>{p.body}</p>
            <div className="wall-note-foot">
              <span>{formatDate(p.created_at)}</span>
              {p.is_mine && <span className="wall-note-mine">あなたの付箋</span>}
            </div>
            {!readOnly && lifted && (
              <div className="wall-note-actions" onClick={(e) => e.stopPropagation()}>
                {p.is_mine ? (
                  <button type="button" className="wall-note-action is-danger" onClick={() => onDelete?.(p)}>削除する</button>
                ) : (
                  <button type="button" className="wall-note-action" onClick={() => onReport?.(p)}>通報する</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}
