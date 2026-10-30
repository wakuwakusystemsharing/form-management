'use client';

// 外部予約メール連携の「連携の進め方」ガイド
// 設定画面の先頭に出す。現在の状態から進み具合を表示し、店舗へ送る案内文もコピーできる

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Check, ChevronDown, ChevronUp, Copy, HelpCircle, Info } from 'lucide-react';
import {
  buildMailGuideSteps,
  buildStoreGuideText,
  MAIL_GUIDE_FORWARD_OPTIONS,
  MAIL_GUIDE_INTRO,
  MAIL_GUIDE_NOTES,
  type MailGuideStepInput,
} from '@/lib/external-mail-guide';

interface Props extends MailGuideStepInput {
  storeName: string;
  inboundAddress: string | null;
}

const STATUS_LABEL = { done: '完了', current: 'いまここ', todo: '未着手' } as const;

export default function ExternalMailIntegrationGuide(props: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [showText, setShowText] = useState(false);
  const steps = useMemo(() => buildMailGuideSteps(props), [props]);
  const guideText = useMemo(() => buildStoreGuideText(props.storeName, props.inboundAddress), [props.storeName, props.inboundAddress]);
  const current = steps.find((s) => s.status === 'current');

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(guideText);
      toast({ title: '店舗への案内文をコピーしました' });
    } catch {
      toast({ title: 'コピーに失敗しました', variant: 'destructive' });
    }
  };

  return (
    <section
      data-slot="guide"
      aria-label="連携の進め方"
      className="rounded-lg border border-[rgb(244,144,49)]/40 bg-orange-50/70"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <HelpCircle className="h-4 w-4 text-[rgb(200,100,10)] shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-[rgb(200,100,10)]">連携の進め方（完了までの流れ）</span>
          {!open && current && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">次: {current.title}</span>
          )}
        </span>
        <span className="flex items-center gap-1 text-xs text-[rgb(200,100,10)] shrink-0">
          {open ? '閉じる' : '開く'}
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-sm text-gray-800">{MAIL_GUIDE_INTRO}</p>

          {/* 流れ図 */}
          <div className="text-xs text-gray-700 bg-white/70 border border-[rgb(244,144,49)]/30 rounded-md px-3 py-2 leading-relaxed">
            お客様が媒体で予約 → 媒体から店舗へ予約通知メール → <span className="font-medium">店舗が受信用アドレスへ転送</span> → 本システムがメールを読み取り → <span className="font-medium">店舗の Google カレンダーに予定を自動作成</span>（予約フォームの〇✕にも反映）
          </div>

          {/* 手順 */}
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li
                key={step.key}
                className={`flex gap-3 rounded-md border px-3 py-2 ${
                  step.status === 'current'
                    ? 'border-[rgb(244,144,49)] bg-white'
                    : step.status === 'done'
                      ? 'border-green-200 bg-green-50/60'
                      : 'border-transparent bg-white/50'
                }`}
              >
                <span
                  className={`mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                    step.status === 'done'
                      ? 'bg-green-500 text-white'
                      : step.status === 'current'
                        ? 'bg-[rgb(244,144,49)] text-white'
                        : 'bg-gray-200 text-gray-600'
                  }`}
                  aria-hidden="true"
                >
                  {step.status === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-gray-900">{step.title}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{step.who}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded ${
                        step.status === 'done'
                          ? 'bg-green-100 text-green-700'
                          : step.status === 'current'
                            ? 'bg-orange-100 text-[rgb(200,100,10)]'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {STATUS_LABEL[step.status]}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {step.lines.map((line) => (
                      <li key={line} className="text-xs text-gray-700 leading-relaxed">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>

          {/* 転送の方法 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MAIL_GUIDE_FORWARD_OPTIONS.map((opt) => (
              <div key={opt.title} className="rounded-md bg-white/70 border border-[rgb(244,144,49)]/30 px-3 py-2">
                <div className="text-sm font-medium text-gray-900">{opt.title}</div>
                <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                  {opt.lines.map((line) => (
                    <li key={line} className="text-xs text-gray-700 leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          {/* 店舗への案内文 */}
          <div className="rounded-md bg-white/70 border border-[rgb(244,144,49)]/30 px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-gray-900">店舗への案内文</div>
                <p className="text-xs text-gray-700">受信用アドレスと Gmail の転送手順が入った文面です。そのまま LINE やメールで店舗へ送れます。</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setShowText((v) => !v)}>
                  {showText ? '閉じる' : '文面を見る'}
                </Button>
                <Button size="sm" onClick={copyText}>
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  コピー
                </Button>
              </div>
            </div>
            {showText && (
              <pre className="p-2 bg-muted border rounded text-xs whitespace-pre-wrap break-all max-h-72 overflow-y-auto">{guideText}</pre>
            )}
          </div>

          {/* 注意点 */}
          <ul className="text-xs text-gray-700 space-y-1 border-t border-[rgb(244,144,49)]/30 pt-2">
            {MAIL_GUIDE_NOTES.map((note) => (
              <li key={note} className="flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[rgb(200,100,10)]" aria-hidden="true" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
