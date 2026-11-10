'use client';

/**
 * LINE メッセージのプレビューで選んだパーツの設定欄（プレビューの下に出す）
 * - 「＋ 追加」: 文字 / 画像 / ボタン / 区切り線 / 横並びの箱 / カード
 * - 選択中のパーツ: 文字・画像・ボタンの中身、リンク、見た目（大きさ・色・余白など）
 * 操作はすべて onOp で親（LineFlexEditorDialog）に渡す。親がテンプレートの入力値に書き戻すか、自由編集に切り替える
 */
import React, { useState } from 'react';
import { ancestorPaths, describeFlexNode, getAt, isInlineEditableText, newFlexPart, parentInfo } from '@/lib/flex-tree';
import type { FlexContainer } from '@/types/line-flex';
import type { FlexEditOp } from '@/lib/flex-edit';

export type { FlexEditOp };

interface Props {
  contents: FlexContainer | null;
  selected: string | null;
  onSelect: (path: string | null) => void;
  onOp: (op: FlexEditOp) => void;
  /** テンプレートの入力項目と連動中か（false = 自由編集 / JSON 直接入力） */
  templateLinked: boolean;
  /** 予約フォームの URL（ボタンのリンク先の候補） */
  formUrls: Array<{ name: string; url: string }>;
  uploading: string | null;
  onUpload: (slot: string, file: File, apply: (url: string) => void) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  error: string | null;
}

const SIZES = ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl'];
const SIZE_LABELS: Record<string, string> = { xxs: '極小', xs: 'とても小さい', sm: '小さい', md: 'ふつう', lg: '大きい', xl: 'とても大きい', xxl: '特大', '3xl': '特大 2', '4xl': '特大 3', '5xl': '最大' };
const SPACES = ['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const SPACE_LABELS: Record<string, string> = { none: 'なし', xs: 'ごく狭い', sm: '狭い', md: 'ふつう', lg: '広い', xl: 'とても広い', xxl: '最も広い' };
const opt = (values: string[], labels: Record<string, string>) => values.map((v) => ({ value: v, label: labels[v] ?? v }));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isColor = (v: string) => v === '' || /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);
const isLink = (v: string) => /^(https?:\/\/.+|tel:.+|line:\/\/.+)/.test(v);

/**
 * 入力中の値を手元に持つ入力欄。条件を満たす値だけを確定する（途中の「#ff」や空欄で壊さないため）。
 * 外から値が変わったら（プレビューで直接書き換えた・元に戻した）手元の値も合わせる
 */
function DraftInput({ value, onCommit, valid, multiline, placeholder, className }: { value: string; onCommit: (v: string) => void; valid: (v: string) => boolean; multiline?: boolean; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const change = (v: string) => {
    setDraft(v);
    if (valid(v) && v !== value) {
      setSeen(v);
      onCommit(v);
    }
  };
  const cls = `w-full rounded-md border bg-background px-2 py-1 text-xs ${valid(draft) ? '' : 'border-destructive'} ${className ?? ''}`;
  return multiline ? (
    <textarea value={draft} rows={3} placeholder={placeholder} className={cls} onChange={(e) => change(e.target.value)} />
  ) : (
    <input value={draft} placeholder={placeholder} className={`h-8 ${cls}`} onChange={(e) => change(e.target.value)} />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Sel({ value, options, onChange, empty = '指定なし' }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; empty?: string | null }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border bg-background px-1 text-xs">
      {empty !== null && <option value="">{empty}</option>}
      {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-1">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-8 w-9 shrink-0 cursor-pointer rounded border" />
        <DraftInput value={value} onCommit={onChange} valid={isColor} placeholder="#222222（空 = 既定）" />
      </div>
    </Row>
  );
}

function UploadButton({ slot, uploading, label, onFile }: { slot: string; uploading: string | null; label: string; onFile: (file: File) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs hover:bg-muted">
      {uploading === slot ? 'アップロード中…' : label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading !== null}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

export default function FlexPartInspector({ contents, selected, onSelect, onOp, templateLinked, formUrls, uploading, onUpload, canUndo, canRedo, onUndo, onRedo, error }: Props) {
  const node = contents && selected !== null ? getAt(contents, selected) : undefined;
  const path = selected ?? '';
  const info = contents && selected !== null ? parentInfo(contents, selected) : null;
  const patch = (p: Record<string, unknown>) => onOp({ type: 'patch', path, patch: p });
  const action = node && typeof node.action === 'object' && node.action ? (node.action as Record<string, unknown>) : null;
  const addBtn = 'rounded-md border px-2 py-1 text-xs hover:bg-muted';
  const defaultLink = formUrls[0]?.url;

  const linkPicker = (onPick: (url: string) => void) =>
    formUrls.length > 0 ? (
      <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} className="mt-1 h-7 w-full rounded-md border bg-background px-1 text-[11px]">
        <option value="">予約フォームの URL を入れる…</option>
        {formUrls.map((f) => (
          <option key={f.url} value={f.url}>{f.name}</option>
        ))}
      </select>
    ) : null;

  const marginRow = info ? (
    <Row label={info.axis === 'horizontal' ? '左の余白' : '上の余白'}>
      <Sel value={str(node?.margin)} options={opt(SPACES, SPACE_LABELS)} onChange={(v) => patch({ margin: v })} />
    </Row>
  ) : null;

  const tapLinkRow = (
    <Row label="タップ時のリンク">
      <DraftInput
        value={action?.type === 'uri' ? str(action.uri) : ''}
        valid={(v) => v === '' || isLink(v)}
        placeholder="https://…（空 = リンクなし）"
        onCommit={(v) => patch({ action: v ? { type: 'uri', label: str(action?.label) || '開く', uri: v } : undefined })}
      />
      {linkPicker((url) => patch({ action: { type: 'uri', label: str(action?.label) || '開く', uri: url } }))}
    </Row>
  );

  const renderFields = () => {
    if (!node) return null;
    switch (node.type) {
      case 'text':
        return (
          <>
            {isInlineEditableText(node) ? (
              <Row label="文字">
                <DraftInput multiline value={str(node.text)} valid={(v) => v.trim() !== ''} onCommit={(v) => onOp({ type: 'text', path, text: v })} />
                <p className="mt-0.5 text-[10px] text-muted-foreground">プレビューの文字を直接クリックしても書き換えられます。消すときは「削除」</p>
              </Row>
            ) : (
              <p className="text-[11px] text-muted-foreground">色分けされた文字のため、ここでは書き換えできません（「上級者向け: JSON を直接編集」で変更できます）。</p>
            )}
            <Row label="文字の大きさ"><Sel value={str(node.size)} options={opt(SIZES, SIZE_LABELS)} onChange={(v) => patch({ size: v })} /></Row>
            <Row label="太さ"><Sel value={str(node.weight)} empty={null} options={[{ value: '', label: 'ふつう' }, { value: 'bold', label: '太字' }]} onChange={(v) => patch({ weight: v })} /></Row>
            <ColorRow label="文字の色" value={str(node.color)} onChange={(v) => patch({ color: v })} />
            <Row label="そろえ"><Sel value={str(node.align)} empty={null} options={[{ value: '', label: '左' }, { value: 'center', label: '中央' }, { value: 'end', label: '右' }]} onChange={(v) => patch({ align: v })} /></Row>
            <Row label="折り返し"><Sel value={node.wrap === true ? 'on' : ''} empty={null} options={[{ value: 'on', label: '折り返す' }, { value: '', label: '1 行（長いと…で省略）' }]} onChange={(v) => patch({ wrap: v === 'on' ? true : undefined })} /></Row>
            {marginRow}
            {tapLinkRow}
          </>
        );
      case 'image':
        return (
          <>
            <Row label="画像">
              <div className="flex flex-wrap items-center gap-2">
                {str(node.url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={str(node.url)} alt="" className="h-10 w-14 rounded border object-cover" />
                )}
                <UploadButton slot="part_replace" uploading={uploading} label="画像を差し替える" onFile={(f) => onUpload('part_replace', f, (url) => onOp({ type: 'image', path, url }))} />
              </div>
              <DraftInput className="mt-1" value={str(node.url)} valid={(v) => /^https:\/\/.+/.test(v)} placeholder="https:// の画像 URL" onCommit={(v) => onOp({ type: 'image', path, url: v })} />
            </Row>
            <Row label="大きさ"><Sel value={str(node.size)} options={[...opt(SIZES, SIZE_LABELS), { value: 'full', label: '幅いっぱい' }]} onChange={(v) => patch({ size: v })} /></Row>
            <Row label="縦横の比率"><Sel value={str(node.aspectRatio)} empty="1:1（既定）" options={['20:13', '16:9', '4:3', '3:2', '2:1', '3:4', '9:16'].map((v) => ({ value: v, label: v }))} onChange={(v) => patch({ aspectRatio: v })} /></Row>
            <Row label="収め方"><Sel value={str(node.aspectMode)} empty={null} options={[{ value: '', label: '全体を見せる（余白あり）' }, { value: 'cover', label: '枠いっぱいに切り抜く' }]} onChange={(v) => patch({ aspectMode: v })} /></Row>
            {marginRow}
            {tapLinkRow}
          </>
        );
      case 'button':
        return (
          <>
            <Row label="ボタンの文言"><DraftInput value={str(action?.label)} valid={(v) => v.trim() !== '' && v.length <= 40} onCommit={(v) => onOp({ type: 'buttonLabel', path, label: v })} /></Row>
            {!action || action.type === 'uri' ? (
              <Row label="リンク先">
                <DraftInput value={str(action?.uri)} valid={isLink} placeholder="https://… または tel:0312345678" onCommit={(v) => onOp({ type: 'buttonUrl', path, url: v })} />
                {linkPicker((url) => onOp({ type: 'buttonUrl', path, url }))}
              </Row>
            ) : (
              <p className="text-[11px] text-muted-foreground">このボタンはリンク以外の動作（{str(action.type)}）です。動作の変更は JSON で行ってください。</p>
            )}
            <Row label="見た目"><Sel value={str(node.style)} empty={null} options={[{ value: 'primary', label: '塗りつぶし（目立つ）' }, { value: 'secondary', label: 'グレー' }, { value: '', label: '文字だけ' }, { value: 'link', label: '文字だけ（link）' }].filter((o) => o.value !== 'link' || node.style === 'link')} onChange={(v) => patch({ style: v })} /></Row>
            <ColorRow label="ボタンの色" value={str(node.color)} onChange={(v) => patch({ color: v })} />
            <Row label="高さ"><Sel value={str(node.height)} empty={null} options={[{ value: '', label: 'ふつう' }, { value: 'sm', label: '低め' }]} onChange={(v) => patch({ height: v })} /></Row>
            {marginRow}
          </>
        );
      case 'separator':
        return (
          <>
            <ColorRow label="線の色" value={str(node.color)} onChange={(v) => patch({ color: v })} />
            {marginRow}
          </>
        );
      case 'box':
        return (
          <>
            <Row label="並べ方"><Sel value={str(node.layout)} empty={null} options={[{ value: 'vertical', label: '縦に並べる' }, { value: 'horizontal', label: '横に並べる' }, { value: 'baseline', label: '横に並べる（文字の下端をそろえる）' }]} onChange={(v) => patch({ layout: v })} /></Row>
            <Row label="中の間隔"><Sel value={str(node.spacing)} options={opt(SPACES, SPACE_LABELS)} onChange={(v) => patch({ spacing: v })} /></Row>
            <Row label="内側の余白"><Sel value={str(node.paddingAll)} empty="既定" options={[{ value: '0px', label: 'なし' }, ...opt(SPACES.slice(1), SPACE_LABELS), { value: '20px', label: '20px（カードの標準）' }]} onChange={(v) => patch({ paddingAll: v })} /></Row>
            <ColorRow label="背景の色" value={str(node.backgroundColor)} onChange={(v) => patch({ backgroundColor: v })} />
            <Row label="角の丸み"><Sel value={str(node.cornerRadius)} empty="なし" options={opt(SPACES.slice(1), SPACE_LABELS)} onChange={(v) => patch({ cornerRadius: v })} /></Row>
            {marginRow}
            {tapLinkRow}
          </>
        );
      case 'bubble':
        return (
          <>
            <Row label="カードの大きさ">
              <Sel value={str(node.size)} empty="標準（mega）" options={[{ value: 'nano', label: '最小（nano）' }, { value: 'micro', label: 'とても小さい（micro）' }, { value: 'deca', label: '小さい（deca）' }, { value: 'hecto', label: 'やや小さい（hecto）' }, { value: 'kilo', label: '少し小さい（kilo）' }, { value: 'mega', label: '標準（mega）' }, { value: 'giga', label: '幅いっぱい（giga）' }]} onChange={(v) => patch({ size: v })} />
            </Row>
            <p className="text-[11px] text-muted-foreground">カードが複数あるときは、すべてのカードが同じ大きさになります。中の文字や画像をクリックすると、そのパーツを編集できます。</p>
          </>
        );
      case 'carousel':
        return <p className="text-[11px] text-muted-foreground">横に並んだカードの集まりです。カードをクリックして選ぶと、並び替え・複製・削除ができます。</p>;
      default:
        return <>{marginRow}</>;
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-3" data-slot="flex-inspector">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-medium">＋ 追加</span>
        <button type="button" className={addBtn} onClick={() => onOp({ type: 'add', node: newFlexPart('text') })}>文字</button>
        <UploadButton slot="part_new" uploading={uploading} label="画像" onFile={(f) => onUpload('part_new', f, (url) => onOp({ type: 'add', node: newFlexPart('image', { url }) }))} />
        <button type="button" className={addBtn} onClick={() => onOp({ type: 'add', node: newFlexPart('button', { linkUrl: defaultLink }) })}>ボタン</button>
        <button type="button" className={addBtn} onClick={() => onOp({ type: 'add', node: newFlexPart('separator') })}>区切り線</button>
        <button type="button" className={addBtn} onClick={() => onOp({ type: 'add', node: newFlexPart('box') })}>横並びの箱</button>
        <button type="button" className={addBtn} onClick={() => onOp({ type: 'addBubble' })}>カード</button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className={`${addBtn} disabled:opacity-40`} disabled={!canUndo} onClick={onUndo} title="1 つ前の状態に戻す">↶ 元に戻す</button>
          <button type="button" className={`${addBtn} disabled:opacity-40`} disabled={!canRedo} onClick={onRedo} title="戻した操作をやり直す">↷</button>
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">選んでいるパーツのすぐ後ろ（箱を選んでいるときはその中）に入ります。何も選んでいなければカードの本文のいちばん下に入ります。</p>
      {error && <p className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{error}</p>}

      {node && contents ? (
        <div className="space-y-2 border-t pt-2">
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {ancestorPaths(path).map((p, i, arr) => {
              const n = getAt(contents, p);
              const last = i === arr.length - 1;
              return (
                <React.Fragment key={p || 'root'}>
                  {i > 0 && <span className="text-muted-foreground">›</span>}
                  <button type="button" className={last ? 'rounded bg-blue-600 px-1.5 py-0.5 font-medium text-white' : 'rounded px-1 py-0.5 text-muted-foreground hover:bg-muted'} onClick={() => onSelect(p)}>
                    {describeFlexNode(n, p)}
                  </button>
                </React.Fragment>
              );
            })}
            <button type="button" className="ml-auto text-[11px] text-muted-foreground hover:underline" onClick={() => onSelect(null)}>選択を解除</button>
          </div>
          <div key={path} className="space-y-1.5">{renderFields()}</div>
          {templateLinked && (
            <p className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              文字・画像・ボタンの文言とリンク先、メニューなどの並び替え・複製・削除は、左の入力項目にも反映されます。色・大きさ・余白の変更や、パーツの追加をすると「自由編集」に切り替わります（「テンプレートに戻す」で戻せます）。
            </p>
          )}
        </div>
      ) : (
        <p className="border-t pt-2 text-[11px] text-muted-foreground">上のプレビューで、変えたい文字・画像・ボタンをクリックしてください。ここに設定が出ます。</p>
      )}
    </div>
  );
}
