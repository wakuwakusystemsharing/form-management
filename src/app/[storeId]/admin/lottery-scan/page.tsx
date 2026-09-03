'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { LotteryEntryView, LotteryPrize } from '@/types/lottery';
import { extractQrToken } from '@/lib/lottery-qr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { ArrowLeft, Camera, CheckCircle2, Loader2, XCircle } from 'lucide-react';

interface LookupResult {
  entry: LotteryEntryView;
  prize: LotteryPrize | null;
  form_title: string | null;
  can_redeem: boolean;
  reason: string | null;
}

/** BarcodeDetector（Chrome / Android / iOS 17+ の Safari）。無い端末は手入力にフォールバック */
type BarcodeDetectorLike = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())}`;
}

/**
 * /{storeId}/admin/lottery-scan - 店舗スタッフ用 当選 QR スキャン / 引換コード手入力
 * ?t={token} 付きで開くと即照会（/r/{token} からの遷移）
 */
export default function LotteryScanPage() {
  const params = useParams();
  const storeId = params.storeId as string;
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const rafRef = useRef<number | null>(null);
  const lookingUpRef = useRef(false);

  const [supportsCamera, setSupportsCamera] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const lookup = useCallback(async (raw: string) => {
    const token = extractQrToken(raw) || raw.trim().toUpperCase();
    if (!token) return;
    if (lookingUpRef.current) return;
    lookingUpRef.current = true;
    setBusy(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/lotteries/redeem/${encodeURIComponent(token)}`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push(`/${storeId}/admin?redirect=${encodeURIComponent(`/${storeId}/admin/lottery-scan?t=${token}`)}`);
        return;
      }
      if (!res.ok) {
        setResult(null);
        setLookupError(json.error || '当選情報が見つかりません');
        return;
      }
      setResult(json as LookupResult);
      stopCamera();
    } catch {
      setLookupError('通信に失敗しました');
    } finally {
      setBusy(false);
      lookingUpRef.current = false;
    }
  }, [storeId, router, stopCamera]);

  // ?t= 付きなら即照会
  useEffect(() => {
    const t = searchParams.get('t');
    if (t) lookup(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
    setSupportsCamera(!!w.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia);
    return () => stopCamera();
  }, [stopCamera]);

  const startCamera = async () => {
    const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
    if (!w.BarcodeDetector) return;
    try {
      detectorRef.current = new w.BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      setResult(null);
      setLookupError(null);
      const tick = async () => {
        if (!streamRef.current || !videoRef.current || !detectorRef.current) return;
        try {
          if (videoRef.current.readyState >= 2) {
            const codes = await detectorRef.current.detect(videoRef.current);
            const hit = codes.find((c) => c.rawValue);
            if (hit) {
              await lookup(hit.rawValue);
              if (!streamRef.current) return;
            }
          }
        } catch {
          /* 1 フレーム失敗しても継続 */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.error(e);
      toast({ title: 'カメラを起動できませんでした', description: 'ブラウザのカメラ権限を確認するか、引換コードを手入力してください', variant: 'destructive' });
      stopCamera();
    }
  };

  const redeem = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/lotteries/entries/${result.entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'redeem', note: note || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '引換に失敗しました', description: json.error, variant: 'destructive' });
        return;
      }
      toast({ title: '引換済みにしました', description: `${result.prize?.name ?? ''} ${result.entry.redeem_code ?? ''}` });
      setResult({ ...result, entry: json as LotteryEntryView, can_redeem: false, reason: 'すでに引換済みです' });
    } catch {
      toast({ title: '引換に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setLookupError(null);
    setManual('');
    setNote('');
  };

  return (
    <main className="min-h-dvh bg-muted/30 p-4 sm:p-6">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${storeId}/admin?tab=lotteries`}><ArrowLeft className="mr-1 h-4 w-4" />抽選管理へ</Link>
          </Button>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">当選 QR スキャン</CardTitle>
            <CardDescription>お客様の当選画面の QR コードを読み取るか、6 桁の引換コードを入力してください</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {supportsCamera === false && (
              <p className="text-xs text-muted-foreground rounded-md bg-muted px-3 py-2">この端末のブラウザは QR 読み取りに対応していません。引換コードを手入力してください（iPhone は Safari 17 以降、Android は Chrome で読み取れます）。</p>
            )}
            {supportsCamera && (
              <div className="space-y-2">
                <div className={`relative rounded-lg overflow-hidden bg-black aspect-square ${scanning ? '' : 'hidden'}`}>
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <div className="absolute inset-8 border-2 border-white/80 rounded-lg pointer-events-none" />
                </div>
                {scanning ? (
                  <Button variant="outline" className="w-full" onClick={stopCamera}>カメラを停止</Button>
                ) : (
                  <Button className="w-full" onClick={startCamera} disabled={busy}><Camera className="mr-2 h-4 w-4" />カメラで QR を読み取る</Button>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') lookup(manual); }}
                placeholder="引換コード（例：7X4K2P）"
                className="font-mono tracking-widest text-lg"
                autoCapitalize="characters"
                autoComplete="off"
              />
              <Button onClick={() => lookup(manual)} disabled={busy || !manual.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '照会'}
              </Button>
            </div>
            {lookupError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <XCircle className="h-4 w-4 shrink-0" />{lookupError}
              </div>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card className={`shadow-md border-2 ${result.can_redeem ? 'border-[rgb(55,114,58)]' : 'border-destructive/60'}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                {result.can_redeem ? <CheckCircle2 className="h-5 w-5 text-[rgb(55,114,58)]" /> : <XCircle className="h-5 w-5 text-destructive" />}
                <CardTitle className="text-base">{result.can_redeem ? '引換できます' : result.reason || '引換できません'}</CardTitle>
              </div>
              <CardDescription>{result.form_title || ''}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg border-l-4 pl-3 py-1" style={{ borderColor: result.prize?.rank_color || '#6b7280' }}>
                <div className="text-xl font-bold">{result.prize?.name || result.entry.prize_name || '—'}{result.entry.is_consolation && <span className="ml-2 text-xs text-muted-foreground">残念賞</span>}</div>
                {result.prize?.description && <div className="text-muted-foreground">{result.prize.description}</div>}
              </div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">LINE 名</span><span className="col-span-2">{result.entry.line_display_name || '（不明）'}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">引換コード</span><span className="col-span-2 font-mono text-lg tracking-widest">{result.entry.redeem_code || '—'}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">有効期限</span><span className="col-span-2">{formatDate(result.entry.expires_at) || '無期限'}</span></div>
              <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">状態</span><span className="col-span-2"><Badge variant="outline">{result.entry.effective_status}</Badge></span></div>
              {result.entry.redeemed_at && <div className="grid grid-cols-3 gap-2"><span className="text-muted-foreground">引換日時</span><span className="col-span-2">{formatDate(result.entry.redeemed_at)}</span></div>}
              {result.prize?.redeem_note && <p className="rounded-md bg-muted px-3 py-2 text-xs">{result.prize.redeem_note}</p>}
              {result.can_redeem && (
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="備考（担当者名など。任意）" />
              )}
              <div className="flex gap-2 pt-1">
                {result.can_redeem && (
                  <Button className="flex-1 h-12 text-base bg-[rgb(209,241,209)] text-[rgb(55,114,58)] hover:bg-[rgb(55,114,58)] hover:text-white" onClick={redeem} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '引換済みにする'}
                  </Button>
                )}
                <Button variant="outline" className="h-12" onClick={reset}>次を読み取る</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
