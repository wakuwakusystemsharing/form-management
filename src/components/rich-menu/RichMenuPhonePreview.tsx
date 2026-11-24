'use client';

/**
 * リッチメニューの「スマホでの見え方」。
 * iPhone の LINE のトーク画面（幅 390px）を模した枠の下に、メニューの画像とメニューバーを出す。
 * - メニューバーを押すと、メニューが開いたり閉じたりする
 * - ボタンを押すと、押したときの動きを吹き出しで知らせる（実際には何も送らない）
 * 近似の表示で、実機とは少し違う
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RICH_MENU_SIZES, type RichMenuAction, type RichMenuArea, type RichMenuSize } from '@/lib/line-rich-menu';

const PHONE_WIDTH = 390;
const CHAT_HEIGHT = 300;

export interface RichMenuPhonePreviewProps {
  size: RichMenuSize;
  imageUrl: string;
  areas: RichMenuArea[];
  chatBarText: string;
  openByDefault: boolean;
  /** ボタンの動きの説明（一覧と同じ文言） */
  describe: (action: RichMenuAction) => string;
  /** 「別のメニューに切り替える」を押したとき（プレビューを切り替え先に変える） */
  onSwitch?: (menuId: string) => void;
  storeName?: string;
  className?: string;
}

const pct = (n: number) => `${n * 100}%`;

export default function RichMenuPhonePreview({ size, imageUrl, areas, chatBarText, openByDefault, describe, onSwitch, storeName = '公式 LINE', className }: RichMenuPhonePreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [open, setOpen] = useState(openByDefault);
  const [tapped, setTapped] = useState<{ index: number; text: string } | null>(null);
  const dims = RICH_MENU_SIZES[size];
  const menuHeight = Math.round((PHONE_WIDTH * dims.height) / dims.width);

  // 欄の幅に合わせて縮める
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / PHONE_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 「最初から開く」の設定を変えたら、プレビューも合わせる
  useEffect(() => {
    setOpen(openByDefault);
  }, [openByDefault]);

  const tap = (area: RichMenuArea, index: number) => {
    if (area.action.type === 'switch' && area.action.menu_id && onSwitch) {
      setTapped(null);
      onSwitch(area.action.menu_id);
      return;
    }
    setTapped({ index, text: area.action.type === 'none' ? '何も起きません' : describe(area.action) });
  };

  const height = 44 + CHAT_HEIGHT + (open ? menuHeight : 0) + 44;

  return (
    <div ref={wrapRef} className={cn('w-full', className)} data-slot="rich-menu-phone">
      <div style={{ height: height * scale }}>
        <div className="origin-top-left overflow-hidden rounded-[28px] bg-[#8cabd9] shadow-md" style={{ width: PHONE_WIDTH, transform: `scale(${scale})`, boxSizing: 'content-box', border: '6px solid #1c1c1e', marginLeft: -6 * scale }}>
          {/* トーク画面の上のバー */}
          <div className="flex h-11 items-center bg-[#27384f] px-4 text-sm font-semibold text-white">
            <span className="mr-2 text-lg leading-none">‹</span>
            <span className="truncate">{storeName}</span>
          </div>

          {/* トーク */}
          <div className="flex flex-col justify-end gap-2 px-3 py-3" style={{ height: CHAT_HEIGHT }}>
            <div className="max-w-[78%] self-start rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-5 text-slate-800 shadow-sm">友だち追加ありがとうございます。下のメニューからご利用ください。</div>
            {tapped && (
              <div className="max-w-[86%] self-center rounded-full bg-black/55 px-3 py-1.5 text-center text-[12px] leading-4 text-white" role="status" data-slot="rich-menu-phone-result">
                ボタン {tapped.index + 1}: {tapped.text}
              </div>
            )}
          </div>

          {/* メニュー */}
          {open && (
            <div className="relative w-full bg-white" style={{ height: menuHeight }} data-slot="rich-menu-phone-menu">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-200 text-xs text-slate-500">画像はまだありません</div>
              )}
              {areas.map((area, i) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => tap(area, i)}
                  aria-label={`ボタン ${i + 1}: ${area.action.type === 'none' ? '何もしない' : describe(area.action)}`}
                  className={cn('absolute transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white', tapped?.index === i ? 'bg-white/40' : 'hover:bg-white/25 active:bg-white/40')}
                  style={{ left: pct(area.x), top: pct(area.y), width: pct(area.w), height: pct(area.h) }}
                />
              ))}
            </div>
          )}

          {/* メニューバー */}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-11 w-full items-center bg-white px-3 text-[13px] text-slate-700" data-slot="rich-menu-phone-bar">
            <Keyboard className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <span className="flex-1 truncate text-center font-medium">
              {chatBarText || 'メニュー'}
              {open ? <ChevronDown className="ml-1 inline h-4 w-4" aria-hidden="true" /> : <ChevronUp className="ml-1 inline h-4 w-4" aria-hidden="true" />}
            </span>
            <span className="w-5" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        ※ iPhone の LINE（幅 390px）に合わせた近似の表示です。ボタンを押すと、押したときの動きを確かめられます（実際には何も送られません）。
      </p>
    </div>
  );
}
