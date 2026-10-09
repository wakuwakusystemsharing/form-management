'use client';

/**
 * 寄せ書きウォールのボード表示（お客様画面と管理画面のプレビューで共通）
 *
 * - 見た目は theme を CSS 変数に展開するだけ（店舗ごとにコードは分岐しない）
 * - 付箋の色・傾き・ずれは投稿 ID から決まる（wall-layout.ts）
 * - 演出は CSS のみ（落下・傾き・タップで浮く）。transform / opacity だけをアニメーションする
 */
import React from 'react';
import { noteStyleFor } from '@/lib/wall-layout';
import { wallThemeVars } from '@/lib/wall-themes';
import type { WallPublicPost, WallTheme } from '@/types/wall';

export const WALL_CSS = `
.wall-root { min-height: 100dvh; background: var(--wall-bg); color: var(--wall-text); font-family: var(--wall-font); -webkit-tap-highlight-color: transparent; }
.wall-header { padding: 20px 16px 8px; text-align: center; }
.wall-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: .04em; text-shadow: 0 1px 0 rgba(255,255,255,.15); }
.wall-subtitle { margin: 6px 0 0; font-size: 13px; opacity: .85; }
.wall-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; padding: 14px 16px 120px; max-width: 760px; margin: 0 auto; }
@media (min-width: 480px) { .wall-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.wall-note {
  position: relative; display: flex; flex-direction: column; aspect-ratio: 1 / 1; width: 100%; padding: 18px 12px 10px;
  border: 0; border-radius: 3px; background: var(--note-bg); color: #3a3226; text-align: left; font: inherit;
  box-shadow: var(--wall-shadow); cursor: pointer; touch-action: manipulation;
  transform: translate(var(--dx), var(--dy)) rotate(var(--rot));
  transition: transform .18s ease-out, box-shadow .18s ease-out;
}
.wall-note::before { /* 押しピン */
  content: ''; position: absolute; top: 6px; left: 50%; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ff8a8a, #c62828 70%); box-shadow: 0 2px 2px rgba(0,0,0,.3);
}
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
.wall-note-body { flex: 1; margin: 0; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
.wall-note-body.is-long { font-size: 12px; line-height: 1.5; }
.wall-note-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; font-size: 10.5px; opacity: .7; }
.wall-note-mine { font-weight: 700; opacity: .9; }
.wall-note-actions { display: flex; gap: 6px; margin-top: 8px; }
.wall-note-action { flex: 1; min-height: 32px; border: 1px solid rgba(0,0,0,.18); border-radius: 16px; background: rgba(255,255,255,.65); color: #3a3226; font-size: 12px; font-weight: 700; font-family: inherit; }
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
    ['--wall-accent' as string]: accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#f49031',
  };
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
            className={`wall-note${lifted ? ' is-lifted' : ''}${droppingIds?.has(p.id) ? ' is-dropping' : ''}`}
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
