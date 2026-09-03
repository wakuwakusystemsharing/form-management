'use client';

import React, { useState } from 'react';
import type { LotteryConfig, LotteryForm } from '@/types/lottery';
import type { SurveyQuestion } from '@/types/survey';
import SurveyQuestionEditor from '../Survey/SurveyQuestionEditor';
import LotteryPrizeEditor from './LotteryPrizeEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOTTERY_TEMPLATE_PLACEHOLDERS } from '@/lib/lottery-line-message';
import { validateLotteryConfigForSave } from '@/lib/lottery-validation';

interface LotteryFormEditorProps {
  form: LotteryForm;
  onUpdate: (form: LotteryForm) => void;
  userRole?: 'service_admin' | 'store_admin';
}

type TabId = 'basic' | 'prizes' | 'rules' | 'presentation' | 'messages';

/** ISO ⇔ datetime-local（JST）変換 */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}
function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const t = new Date(`${value}:00+09:00`);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

export default function LotteryFormEditor({ form, onUpdate, userRole = 'service_admin' }: LotteryFormEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const config = form.config;
  const isDeferred = config.lottery_type === 'deferred';
  const prizesLocked = isDeferred && form.deferred_draw_status !== 'accepting';
  const errors = validateLotteryConfigForSave(config);

  const setConfig = (patch: Partial<LotteryConfig>) => onUpdate({ ...form, config: { ...config, ...patch } });
  const setBasic = (patch: Partial<LotteryConfig['basic_info']>) => setConfig({ basic_info: { ...config.basic_info, ...patch } });
  const setRules = (patch: Partial<LotteryConfig['entry_rules']>) => setConfig({ entry_rules: { ...config.entry_rules, ...patch } });
  const setPres = (patch: Partial<LotteryConfig['presentation']>) => setConfig({ presentation: { ...config.presentation, ...patch } });
  const setMsgs = (patch: Partial<LotteryConfig['messages']>) => setConfig({ messages: { ...config.messages, ...patch } });
  const setPeriod = (patch: Partial<NonNullable<LotteryConfig['basic_info']['period']>>) =>
    setBasic({ period: { ...(config.basic_info.period || {}), ...patch } });

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="flex flex-col h-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="basic" className="text-xs sm:text-sm">基本情報</TabsTrigger>
          <TabsTrigger value="prizes" className="text-xs sm:text-sm">賞品と確率</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs sm:text-sm">参加条件</TabsTrigger>
          <TabsTrigger value="presentation" className="text-xs sm:text-sm">演出</TabsTrigger>
          <TabsTrigger value="messages" className="text-xs sm:text-sm">メッセージ</TabsTrigger>
        </TabsList>

        {errors.length > 0 && (
          <ul className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive list-disc pl-6">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}

        {/* 基本情報 */}
        <TabsContent value="basic" className="flex-1 overflow-y-auto mt-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>抽選方式</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { id: 'instant', title: '即時抽選', desc: 'その場で結果が出る。来店促進・友だち追加のフックに' },
                  { id: 'deferred', title: '後日抽選', desc: '応募を集めて締切後に当選者を決め、Bot から通知（店舗の LINE チャネルアクセストークンが必要）' },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setConfig({ lottery_type: t.id, entry_rules: t.id === 'deferred' ? { ...config.entry_rules, limit: 'once' } : config.entry_rules })}
                    className={`text-left rounded-lg border p-3 transition-colors ${config.lottery_type === t.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                  >
                    <div className="font-medium text-sm">{t.title}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">※ 抽選履歴がある状態では抽選方式を変更できません</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lottery_status">公開ステータス</Label>
              <Select value={form.status} onValueChange={(v) => onUpdate({ ...form, status: v as LotteryForm['status'] })}>
                <SelectTrigger id="lottery_status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">公開中</SelectItem>
                  <SelectItem value="inactive">非公開</SelectItem>
                  <SelectItem value="paused">一時停止</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.status === 'active'
                  ? 'お客様が抽選に参加できます'
                  : form.status === 'paused'
                    ? '一時停止中です（フォームは開けますが抽選できません）'
                    : '非公開です。「更新」（デプロイ）を押すと自動で公開中になります'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lottery_title">タイトル <span className="text-destructive">*</span></Label>
              <Input id="lottery_title" value={config.basic_info.title} onChange={(e) => setBasic({ title: e.target.value })} placeholder="例：夏の来店感謝くじ" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lottery_store_name">店舗名（メッセージに差し込み）</Label>
                <Input id="lottery_store_name" value={config.basic_info.store_name || ''} onChange={(e) => setBasic({ store_name: e.target.value || undefined })} />
              </div>
              {userRole === 'service_admin' && (
                <div className="space-y-2">
                  <Label htmlFor="lottery_liff_id">LIFF ID <span className="text-destructive">*</span></Label>
                  <Input id="lottery_liff_id" value={config.basic_info.liff_id} onChange={(e) => setBasic({ liff_id: e.target.value })} placeholder="例：1234567890-abcdefgh" />
                  <p className="text-xs text-muted-foreground">LINE Developers で作成した LIFF ID（デプロイに必須）</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="lottery_theme_color">テーマカラー</Label>
                <div className="flex items-center gap-3">
                  <Input id="lottery_theme_color" type="color" value={config.basic_info.theme_color} onChange={(e) => setBasic({ theme_color: e.target.value })} className="h-10 w-16 p-1" />
                  <Input value={config.basic_info.theme_color} onChange={(e) => setBasic({ theme_color: e.target.value })} className="font-mono" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lottery_logo">ロゴ画像 URL</Label>
                <Input id="lottery_logo" value={config.basic_info.logo_url || ''} onChange={(e) => setBasic({ logo_url: e.target.value || undefined })} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <Label>受付開始日時</Label>
                <Input type="datetime-local" value={isoToLocalInput(config.basic_info.period?.start_at)} onChange={(e) => setPeriod({ start_at: localInputToIso(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>{isDeferred ? '応募締切日時' : '受付終了日時'}{isDeferred && <span className="text-destructive"> *</span>}</Label>
                <Input type="datetime-local" value={isoToLocalInput(config.basic_info.period?.end_at)} onChange={(e) => setPeriod({ end_at: localInputToIso(e.target.value) })} />
              </div>
              {isDeferred && (
                <div className="space-y-2">
                  <Label>抽選予定日（お客様への表示用）</Label>
                  <Input type="datetime-local" value={isoToLocalInput(config.deferred?.draw_scheduled_at)} onChange={(e) => setConfig({ deferred: { entry_complete_text: config.deferred?.entry_complete_text || '', ...config.deferred, draw_scheduled_at: localInputToIso(e.target.value) } })} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>引換方式</Label>
              <Select value={config.redeem_method} onValueChange={(v) => setConfig({ redeem_method: v as LotteryConfig['redeem_method'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="code">6 桁コード（管理画面でコード検索して引換）</SelectItem>
                  <SelectItem value="qr">QR コード（スタッフがスキャンして引換。コードも併記）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lottery_notice">注意事項（任意。フォームの「ご注意」に追記）</Label>
              <Textarea id="lottery_notice" rows={3} value={config.basic_info.notice || ''} onChange={(e) => setBasic({ notice: e.target.value || undefined })} />
            </div>
          </div>
        </TabsContent>

        {/* 賞品と確率 */}
        <TabsContent value="prizes" className="flex-1 overflow-y-auto mt-6">
          <LotteryPrizeEditor
            lotteryType={config.lottery_type}
            prizes={config.prizes}
            consolationPrize={config.consolation_prize}
            onChange={(prizes) => setConfig({ prizes })}
            onConsolationChange={(prize) => {
              const next = { ...config };
              if (prize) next.consolation_prize = prize; else delete next.consolation_prize;
              onUpdate({ ...form, config: next });
            }}
            locked={prizesLocked}
          />
        </TabsContent>

        {/* 参加条件 */}
        <TabsContent value="rules" className="flex-1 overflow-y-auto mt-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>参加回数</Label>
                <Select value={isDeferred ? 'once' : config.entry_rules.limit} onValueChange={(v) => setRules({ limit: v as LotteryConfig['entry_rules']['limit'] })} disabled={isDeferred}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">1 人 1 回</SelectItem>
                    <SelectItem value="daily">1 日 1 回</SelectItem>
                    <SelectItem value="period_n">期間中 N 回</SelectItem>
                  </SelectContent>
                </Select>
                {isDeferred && <p className="text-xs text-muted-foreground">後日抽選は 1 人 1 口固定です</p>}
              </div>
              {config.entry_rules.limit === 'period_n' && !isDeferred && (
                <div className="space-y-2">
                  <Label>期間中の上限回数</Label>
                  <Input type="number" min={1} step={1} value={config.entry_rules.period_max ?? 1} onChange={(e) => setRules({ period_max: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                </div>
              )}
              {!isDeferred && (
                <div className="space-y-2">
                  <Label>全賞品が在庫切れのとき</Label>
                  <Select value={config.entry_rules.when_sold_out} onValueChange={(v) => setRules({ when_sold_out: v as 'lose' | 'close' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lose">はずれ扱いで受付を続ける</SelectItem>
                      <SelectItem value="close">受付を終了する</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="require_friend" checked={config.entry_rules.require_friend} onCheckedChange={(c) => setRules({ require_friend: c === true })} />
              <Label htmlFor="require_friend" className="cursor-pointer">公式 LINE の友だち追加を必須にする</Label>
            </div>

            <div className="space-y-2 border-t pt-5">
              <Label className="text-base">事前質問（任意・問数制限なし）</Label>
              <p className="text-xs text-muted-foreground">抽選の前にお客様に入力してもらう項目。回答は抽選履歴に保存されます。</p>
              <SurveyQuestionEditor
                questions={config.entry_rules.pre_questions}
                onChange={(questions: SurveyQuestion[]) => setRules({ pre_questions: questions })}
              />
            </div>
          </div>
        </TabsContent>

        {/* 演出・デザイン */}
        <TabsContent value="presentation" className="flex-1 overflow-y-auto mt-6">
          <div className="space-y-6">
            {!isDeferred && (
              <div className="space-y-2">
                <Label>演出</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { id: 'scratch', title: 'スクラッチ', desc: '指で削ると結果が見える' },
                    { id: 'gacha', title: 'ガチャ', desc: 'レバーを回してカプセルを開ける' },
                    { id: 'simple', title: 'シンプル', desc: 'ドラムロールのみ。軽量' },
                  ] as const).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setPres({ animation: a.id })}
                      className={`text-left rounded-lg border p-3 transition-colors ${config.presentation.animation === a.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                    >
                      <div className="font-medium text-sm">{a.title}</div>
                      <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!isDeferred && config.presentation.animation === 'scratch' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>スクラッチの板</Label>
                  <Select value={config.presentation.scratch_style} onValueChange={(v) => setPres({ scratch_style: v as LotteryConfig['presentation']['scratch_style'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="silver">銀</SelectItem>
                      <SelectItem value="gold">金</SelectItem>
                      <SelectItem value="image">画像</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {config.presentation.scratch_style === 'image' && (
                  <div className="space-y-2">
                    <Label>板の画像 URL</Label>
                    <Input value={config.presentation.scratch_image_url || ''} onChange={(e) => setPres({ scratch_image_url: e.target.value || undefined })} placeholder="https://..." />
                  </div>
                )}
              </div>
            )}
            <div className="space-y-3">
              {!isDeferred && (
                <div className="flex items-center gap-2">
                  <Checkbox id="show_probability" checked={config.presentation.show_probability} onCheckedChange={(c) => setPres({ show_probability: c === true })} />
                  <Label htmlFor="show_probability" className="cursor-pointer">賞品カードに当選確率を表示する</Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox id="show_stock" checked={config.presentation.show_stock} onCheckedChange={(c) => setPres({ show_stock: c === true })} />
                <Label htmlFor="show_stock" className="cursor-pointer">{isDeferred ? '賞品カードに当選数を表示する' : '賞品カードに残り在庫を表示する'}</Label>
              </div>
              {!isDeferred && (
                <div className="flex items-center gap-2">
                  <Checkbox id="confetti" checked={config.presentation.confetti} onCheckedChange={(c) => setPres({ confetti: c === true })} />
                  <Label htmlFor="confetti" className="cursor-pointer">当選時に紙吹雪を出す</Label>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>当選時の見出し</Label>
                <Input value={config.presentation.win_title} onChange={(e) => setPres({ win_title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>はずれ時の見出し</Label>
                <Input value={config.presentation.lose_title} onChange={(e) => setPres({ lose_title: e.target.value })} />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>はずれ時の一言</Label>
                <Textarea rows={2} value={config.presentation.lose_message || ''} onChange={(e) => setPres({ lose_message: e.target.value || undefined })} placeholder="例：次回のご来店をお待ちしております" />
              </div>
              {isDeferred && (
                <div className="md:col-span-2 space-y-2">
                  <Label>応募完了画面の文言</Label>
                  <Textarea rows={2} value={config.deferred?.entry_complete_text || ''} onChange={(e) => setConfig({ deferred: { ...config.deferred, entry_complete_text: e.target.value } })} />
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* メッセージ */}
        <TabsContent value="messages" className="flex-1 overflow-y-auto mt-6">
          <div className="space-y-6">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              使えるプレースホルダ: {LOTTERY_TEMPLATE_PLACEHOLDERS.map((p) => `${p.key}（${p.label}）`).join(' / ')}。値が無いプレースホルダだけの行は自動で省略されます。
            </div>
            {!isDeferred ? (
              <>
                <div className="space-y-2">
                  <Label>当選時に LINE トークへ送るテキスト</Label>
                  <Textarea rows={6} value={config.messages.win_text} onChange={(e) => setMsgs({ win_text: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>はずれ時に LINE トークへ送るテキスト</Label>
                  <Textarea rows={4} value={config.messages.lose_text} onChange={(e) => setMsgs({ lose_text: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>応募完了時に LINE トークへ送るテキスト</Label>
                <Textarea rows={4} value={config.messages.entry_text} onChange={(e) => setMsgs({ entry_text: e.target.value })} />
              </div>
            )}
            <div className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-2">
                <Checkbox id="second_message_enabled" checked={!!config.basic_info.second_message?.enabled} onCheckedChange={(c) => setBasic({ second_message: { enabled: c === true, text: config.basic_info.second_message?.text || '' } })} />
                <Label htmlFor="second_message_enabled" className="cursor-pointer">2 通目の固定テキストを送る（公式 LINE の完全一致応答用）</Label>
              </div>
              {config.basic_info.second_message?.enabled && (
                <Textarea rows={2} value={config.basic_info.second_message.text} onChange={(e) => setBasic({ second_message: { enabled: true, text: e.target.value } })} placeholder="例：クーポン" />
              )}
            </div>
            <div className="space-y-3 border-t pt-5">
              <div className="flex items-center gap-2">
                <Checkbox id="push_flex_enabled" checked={config.messages.push_flex_enabled} onCheckedChange={(c) => setMsgs({ push_flex_enabled: c === true })} />
                <Label htmlFor="push_flex_enabled" className="cursor-pointer">当選時に Bot から当選カード（Flex メッセージ）を push する</Label>
              </div>
              <p className="text-xs text-muted-foreground">店舗の LINE チャネルアクセストークンが設定されている場合のみ送信されます。後日抽選の当選通知はこの設定に関わらず push します。</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>カード下のボタン文言（任意）</Label>
                  <Input value={config.messages.flex_footer_button?.label || ''} onChange={(e) => setMsgs({ flex_footer_button: { label: e.target.value, url: config.messages.flex_footer_button?.url || '' } })} placeholder="例：店舗の地図を見る" />
                </div>
                <div className="space-y-2">
                  <Label>ボタンのリンク先（https://）</Label>
                  <Input value={config.messages.flex_footer_button?.url || ''} onChange={(e) => setMsgs({ flex_footer_button: { label: config.messages.flex_footer_button?.label || '', url: e.target.value } })} placeholder="https://maps.google.com/..." />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
