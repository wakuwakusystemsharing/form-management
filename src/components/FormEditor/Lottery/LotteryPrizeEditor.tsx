'use client';

import React from 'react';
import type { LotteryConfig, LotteryPrize, LotteryPrizeStockStatus, LotteryType } from '@/types/lottery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { computeEffectiveOdds, generateLotteryId, getLoseProbability, validatePrizes } from '@/lib/lottery-engine';

interface LotteryPrizeEditorProps {
  lotteryType: LotteryType;
  prizes: LotteryPrize[];
  consolationPrize?: LotteryPrize;
  onChange: (prizes: LotteryPrize[]) => void;
  onConsolationChange: (prize: LotteryPrize | undefined) => void;
  /** 後日抽選で抽選実行後は賞品を変更できない */
  locked?: boolean;
  /** 賞品 ID → 現在の在庫状況（GET /api/lotteries/[id]/stock）。未取得なら表示しない */
  stockStatus?: Record<string, LotteryPrizeStockStatus>;
  /** 詳細設定（はずれ 0% / 在庫切れ時の確率変動）。onAdvancedChange が無ければ表示しない */
  advanced?: LotteryConfig['advanced'];
  onAdvancedChange?: (advanced: NonNullable<LotteryConfig['advanced']>) => void;
}

const RANK_PRESETS = [
  { label: '金', color: '#d4af37' },
  { label: '銀', color: '#a8a9ad' },
  { label: '銅', color: '#cd7f32' },
  { label: '赤', color: '#e11d48' },
  { label: '青', color: '#2563eb' },
  { label: '緑', color: '#16a34a' },
];

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 賞品と確率の編集
 * - 即時抽選: 当選確率（%）と在庫。確率合計 ≤ 100、残りは「はずれ」
 * - 後日抽選: 当選数（= 在庫）のみ
 */
export default function LotteryPrizeEditor({
  lotteryType,
  prizes,
  consolationPrize,
  onChange,
  onConsolationChange,
  locked = false,
  stockStatus,
  advanced,
  onAdvancedChange,
}: LotteryPrizeEditorProps) {
  const isInstant = lotteryType === 'instant';
  const adv = { no_lose: advanced?.no_lose === true, redistribute_on_sold_out: advanced?.redistribute_on_sold_out === true };
  // 現在の当選確率（在庫状況が取れているときだけ。在庫切れの再配分 / はずれ 0% を反映）
  const odds = (() => {
    if (!isInstant || !stockStatus) return null;
    const counts: Record<string, number> = {};
    Object.values(stockStatus).forEach((st) => { counts[st.id] = st.issued; });
    return computeEffectiveOdds({ prizes, consolation_prize: consolationPrize, advanced: adv }, counts);
  })();
  const totalDraws = (() => {
    const stocks = [...prizes, ...(consolationPrize ? [consolationPrize] : [])].map((p) => p.stock);
    return stocks.every((v): v is number => typeof v === 'number' && Number.isFinite(v)) ? stocks.reduce((a, b) => a + b, 0) : null;
  })();
  const errors = validatePrizes({ lottery_type: lotteryType, prizes, consolation_prize: consolationPrize });
  const loseProbability = getLoseProbability(prizes);
  const totalProbability = Math.round(prizes.reduce((s, p) => s + (p.probability || 0), 0) * 100) / 100;

  const update = (index: number, patch: Partial<LotteryPrize>) => {
    onChange(prizes.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };
  const move = (index: number, dir: -1 | 1) => {
    const next = [...prizes];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = () => {
    onChange([
      ...prizes,
      {
        id: generateLotteryId(),
        name: `${String.fromCharCode(65 + Math.min(prizes.length, 25))}賞`,
        probability: isInstant ? 5 : 0,
        stock: isInstant ? null : 1,
        rank_color: RANK_PRESETS[Math.min(prizes.length, 2)].color,
        expires_in_days: 30,
      },
    ]);
  };
  const remove = (index: number) => {
    if (!confirm('この賞品を削除しますか？')) return;
    onChange(prizes.filter((_, i) => i !== index));
  };

  const renderPrizeFields = (prize: LotteryPrize, patch: (p: Partial<LotteryPrize>) => void, isConsolation: boolean) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>賞品名 <span className="text-destructive">*</span></Label>
        <Input value={prize.name} onChange={(e) => patch({ name: e.target.value })} placeholder="例：A賞" disabled={locked} />
      </div>
      <div className="space-y-1.5">
        <Label>内容（説明）</Label>
        <Input value={prize.description || ''} onChange={(e) => patch({ description: e.target.value || undefined })} placeholder="例：お会計 10% OFF" disabled={locked} />
      </div>
      {!isConsolation && isInstant && (
        <div className="space-y-1.5">
          <Label>当選確率（%） <span className="text-destructive">*</span></Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={Number.isFinite(prize.probability) ? prize.probability : ''}
            onChange={(e) => patch({ probability: numberOrNull(e.target.value) ?? 0 })}
            disabled={locked}
          />
          {odds && typeof odds.prizes[prize.id] === 'number' && (odds.changed || adv.no_lose || adv.redistribute_on_sold_out) && (
            <p className="text-xs text-muted-foreground" data-slot="prize-odds-now">
              現在の当選確率：
              <strong className={odds.prizes[prize.id] !== prize.probability ? 'text-[rgb(200,100,10)]' : 'text-foreground'}>{odds.prizes[prize.id]}%</strong>
              {odds.prizes[prize.id] !== prize.probability && '（在庫状況により変動中）'}
            </p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        <Label>
          {isInstant ? '在庫数（空 = 無制限）' : '当選数'}
          {!isInstant && !isConsolation && <span className="text-destructive"> *</span>}
        </Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={prize.stock ?? ''}
          onChange={(e) => patch({ stock: numberOrNull(e.target.value) })}
          placeholder={isInstant ? '無制限' : '例：3'}
          disabled={locked}
        />
        {isInstant && stockStatus && stockStatus[prize.id] && (() => {
          const st = stockStatus[prize.id];
          // 入力中の値で残りを計算（保存前でも「この在庫にすると残り N」が分かる）
          const stock = typeof prize.stock === 'number' && Number.isFinite(prize.stock) ? prize.stock : null;
          const remaining = stock === null ? null : Math.max(0, stock - st.issued);
          return (
            <p className="text-xs text-muted-foreground" data-slot="prize-stock-status">
              現在の残り：
              <strong className={remaining === 0 ? 'text-destructive' : 'text-foreground'}>
                {remaining === null ? '無制限' : `${remaining}`}
              </strong>
              {`（当選 ${st.issued} 件）`}
            </p>
          );
        })()}
      </div>
      <div className="space-y-1.5">
        <Label>有効期限（当選日から N 日。空 = 無期限）</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={prize.expires_in_days ?? ''}
          onChange={(e) => patch({ expires_in_days: numberOrNull(e.target.value) ?? undefined })}
          placeholder="例：30"
        />
      </div>
      <div className="space-y-1.5">
        <Label>有効期限（固定日付。日数より優先）</Label>
        <Input type="date" value={prize.expires_at || ''} onChange={(e) => patch({ expires_at: e.target.value || undefined })} />
      </div>
      <div className="space-y-1.5">
        <Label>画像 URL</Label>
        <Input value={prize.image_url || ''} onChange={(e) => patch({ image_url: e.target.value || undefined })} placeholder="https://..." />
      </div>
      <div className="space-y-1.5">
        <Label>ランク色</Label>
        <div className="flex items-center gap-2 flex-wrap">
          {RANK_PRESETS.map((r) => (
            <button
              key={r.color}
              type="button"
              title={r.label}
              onClick={() => patch({ rank_color: r.color })}
              className={`h-7 w-7 rounded-full border-2 ${prize.rank_color === r.color ? 'border-foreground' : 'border-transparent'}`}
              style={{ backgroundColor: r.color }}
            />
          ))}
          <Input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(prize.rank_color || '') ? prize.rank_color : '#6b7280'}
            onChange={(e) => patch({ rank_color: e.target.value })}
            className="h-8 w-12 p-1"
          />
        </div>
      </div>
      <div className="md:col-span-2 space-y-1.5">
        <Label>引換方法（結果画面・LINE メッセージに表示）</Label>
        <Textarea rows={2} value={prize.redeem_note || ''} onChange={(e) => patch({ redeem_note: e.target.value || undefined })} placeholder="例：店頭でこの画面をご提示ください" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {locked && (
        <p className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          抽選実行後のため、賞品名・内容・当選数は変更できません。
        </p>
      )}

      {isInstant && onAdvancedChange && (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-slot="lottery-advanced">
          <summary className="cursor-pointer select-none font-medium">
            詳細設定
            {(adv.no_lose || adv.redistribute_on_sold_out) && (
              <span className="ml-2 text-xs font-normal text-[rgb(200,100,10)]">
                {[adv.no_lose ? 'はずれ0%' : null, adv.redistribute_on_sold_out ? '確率変動' : null].filter(Boolean).join(' / ')} ON
              </span>
            )}
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="adv_no_lose"
                checked={adv.no_lose}
                onCheckedChange={(checked) => onAdvancedChange({ ...adv, no_lose: checked === true })}
              />
              <div className="space-y-1">
                <Label htmlFor="adv_no_lose" className="cursor-pointer">はずれ0%にする</Label>
                <p className="text-xs text-muted-foreground">
                  はずれ分の確率は残念賞へ、残念賞が無い（または在庫切れ）ときは残っている賞品へ繰り上げます。
                  賞品と残念賞の在庫数の合計がこの抽選フォームで抽選できる合計回数になり、全ユーザー合わせて在庫が尽きると
                  「賞品がなくなったので抽選は終了いたしました。」と表示して抽選できなくなります（フォームを開いた時点で表示）。
                </p>
                {adv.no_lose && (
                  <p className="text-xs">
                    抽選できる合計回数：
                    <strong>{totalDraws === null ? '上限なし（在庫が無制限の賞品があります）' : `${totalDraws} 回`}</strong>
                    {odds && totalDraws !== null && (
                      <span className="text-muted-foreground">
                        {'（残り '}
                        {Math.max(0, totalDraws - Object.values(stockStatus || {}).reduce((a, st) => a + st.issued, 0))}
                        {' 回）'}
                      </span>
                    )}
                    {odds?.all_sold_out && <span className="ml-1 text-destructive">在庫が尽きたため現在は抽選終了です</span>}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="adv_redistribute"
                checked={adv.redistribute_on_sold_out}
                onCheckedChange={(checked) => onAdvancedChange({ ...adv, redistribute_on_sold_out: checked === true })}
              />
              <div className="space-y-1">
                <Label htmlFor="adv_redistribute" className="cursor-pointer">賞品の在庫が0になったら他の賞品の当選確率を変動させる</Label>
                <p className="text-xs text-muted-foreground">
                  在庫切れになった賞品の確率を、残っている賞品へ設定した確率の比で上乗せします（例: A賞 10% が在庫切れ → B賞 20% / C賞 10% なら B賞 26.67% / C賞 13.33%）。
                  変動中は各賞品の下に「現在の当選確率」が表示され、フォームでも確率表示が ON なら「現在 X%」と出ます。
                </p>
              </div>
            </div>
          </div>
        </details>
      )}

      {isInstant && (
        <div className={`rounded-md border px-3 py-2 text-sm ${totalProbability > 100 ? 'border-destructive bg-destructive/10 text-destructive' : 'bg-muted/50'}`}>
          当選確率の合計 <strong>{totalProbability}%</strong> ／ はずれ <strong>{loseProbability}%</strong>
          {totalProbability > 100 && '（100% を超えています）'}
          {odds && odds.changed && (
            <span className="ml-2 text-xs text-[rgb(200,100,10)]">現在: はずれ {odds.lose}%{odds.consolation !== null ? `（残念賞 ${odds.consolation}%）` : ''}</span>
          )}
        </div>
      )}

      <div className="space-y-4">
        {prizes.map((prize, index) => (
          <Card key={prize.id} className="border-border/70">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: prize.rank_color || '#6b7280' }} />
                <span className="text-sm font-semibold">賞品 {index + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0 || locked} title="上へ"><ArrowUp className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(index, 1)} disabled={index === prizes.length - 1 || locked} title="下へ"><ArrowDown className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => remove(index)} disabled={locked} title="削除"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              {renderPrizeFields(prize, (p) => update(index, p), false)}
            </CardContent>
          </Card>
        ))}
        <Button type="button" variant="outline" onClick={add} disabled={locked}>
          <Plus className="mr-2 h-4 w-4" />
          賞品を追加
        </Button>
      </div>

      {isInstant && (
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="consolation_enabled"
                checked={!!consolationPrize}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onConsolationChange({ id: generateLotteryId(), name: '残念賞', probability: 0, stock: null, rank_color: '#6b7280', expires_in_days: 30 });
                  } else {
                    onConsolationChange(undefined);
                  }
                }}
              />
              <Label htmlFor="consolation_enabled" className="cursor-pointer">残念賞を設定する（はずれのときに必ず付与）</Label>
            </div>
            {consolationPrize && renderPrizeFields(consolationPrize, (p) => onConsolationChange({ ...consolationPrize, ...p }), true)}
          </CardContent>
        </Card>
      )}

      {errors.length > 0 && (
        <ul className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive list-disc pl-6">
          {errors.map((e, i) => <li key={i}>{e.message}</li>)}
        </ul>
      )}
    </div>
  );
}
