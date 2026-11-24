'use client';

/**
 * リッチメニューの画像を選ぶ → メニューの形に切り抜く → LINE の決まりの大きさ（幅 2500px・1MB 以下の JPEG）にして保存する。
 * 画像の加工はブラウザで行う（サーバーに画像の加工の道具を足さないため）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchWithAuth } from '@/lib/client-auth';
import { RICH_MENU_LIMITS, RICH_MENU_SIZES, type RichMenuSize } from '@/lib/line-rich-menu';

interface CropPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 1MB ちょうどを狙わず、少し余裕を持たせる */
const TARGET_BYTES = RICH_MENU_LIMITS.imageMaxBytes - 40 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** 切り抜いた範囲を、メニューの大きさの JPEG にする（1MB 以下になるまで画質を下げる） */
async function renderMenuImage(src: string, crop: CropPixels, size: RichMenuSize): Promise<Blob> {
  const img = await loadImage(src);
  const { width, height } = RICH_MENU_SIZES[size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を加工できませんでした');
  // 透明な部分（PNG）は白にする
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  for (const quality of [0.9, 0.84, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38, 0.3]) {
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= TARGET_BYTES) return blob;
  }
  throw new Error('画像を 1MB 以下にできませんでした。写真の少ない、色数の少ない画像でお試しください');
}

export interface RichMenuImagePickerProps {
  storeId: string;
  size: RichMenuSize;
  hasImage: boolean;
  disabled?: boolean;
  onUploaded: (url: string) => void;
  onError: (message: string) => void;
}

export default function RichMenuImagePicker({ storeId, size, hasImage, disabled, onUploaded, onError }: RichMenuImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<CropPixels | null>(null);
  const [busy, setBusy] = useState(false);
  const dims = RICH_MENU_SIZES[size];

  // 選んだ画像の一時的な URL は、閉じたときに片付ける
  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);

  const onCropComplete = useCallback((_area: unknown, areaPixels: CropPixels) => setPixels(areaPixels), []);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('画像ファイルを選んでください');
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setPixels(null);
    setSource(URL.createObjectURL(file));
  };

  const close = () => {
    if (busy) return;
    setSource(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const confirm = async () => {
    if (!source || !pixels || busy) return;
    setBusy(true);
    try {
      const blob = await renderMenuImage(source, pixels, size);
      const form = new FormData();
      form.append('file', new File([blob], 'richmenu.jpg', { type: 'image/jpeg' }));
      form.append('storeId', storeId);
      form.append('menuId', `richmenu_${Date.now().toString(36)}`);
      const res = await fetchWithAuth('/api/upload/menu-image', { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) {
        onError(json?.error || '画像のアップロードに失敗しました');
        return;
      }
      onUploaded(json.url);
      setSource(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      onError(e instanceof Error ? e.message : '画像を加工できませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-slot="rich-menu-image-input" />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {hasImage ? '画像を選び直す' : '画像を選ぶ'}
      </Button>

      <Dialog open={!!source} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-2xl" data-slot="rich-menu-crop">
          <DialogHeader>
            <DialogTitle>メニューの形に切り抜く</DialogTitle>
            <DialogDescription>
              枠の中がメニューになります（{dims.label}: {dims.width}×{dims.height}）。画像を動かしたり、下のつまみで拡大したりして合わせてください。
            </DialogDescription>
          </DialogHeader>
          <div className="relative h-64 w-full overflow-hidden rounded-md bg-black sm:h-80">
            {source && <Cropper image={source} crop={crop} zoom={zoom} aspect={dims.width / dims.height} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} showGrid={false} />}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">拡大</span>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[rgb(244,144,49)]" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              やめる
            </Button>
            <Button type="button" onClick={() => void confirm()} disabled={busy || !pixels}>
              {busy ? '保存中…' : 'この形で使う'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
