/**
 * 1 対 1 トーク: 返信で送る画像を、ブラウザの中で縮める（サーバーには画像を加工する部品を入れていない）
 *
 * LINE の決まり: 送る画像は JPEG / PNG。プレビュー用の画像は 1MB まで。
 * プレビューにも同じ画像を使うので、長いほうの辺を 1600px までにし、1MB 以下になるまで画質を下げた JPEG にする。
 */
import { CHAT_OUTBOUND_IMAGE_MAX_BYTES, CHAT_OUTBOUND_IMAGE_MAX_SIDE } from '@/lib/chat';

/** 縮めたあとの大きさ（縦横の比はそのまま。長いほうの辺が maxSide を超えるときだけ縮める） */
export function fitImageSize(width: number, height: number, maxSide: number = CHAT_OUTBOUND_IMAGE_MAX_SIDE): { width: number; height: number } {
  const longer = Math.max(width, height);
  if (!(longer > 0)) return { width: 0, height: 0 };
  const scale = longer > maxSide ? maxSide / longer : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];
/** 画質を下げても 1MB に収まらないときに、さらに縮める倍率 */
const SHRINKS = [1, 0.75, 0.5];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

/** 選んだ画像を、送れる大きさの JPEG にする。画像として読めないとき・縮めても収まらないときは例外（日本語の文） */
export async function compressChatImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('画像のファイルを選んでください');
  const img = await loadImage(file);
  const base = fitImageSize(img.naturalWidth, img.naturalHeight);
  if (base.width === 0) throw new Error('画像を読み込めませんでした');
  for (const shrink of SHRINKS) {
    const width = Math.max(1, Math.round(base.width * shrink));
    const height = Math.max(1, Math.round(base.height * shrink));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('この端末では、画像を縮められませんでした');
    // 透明な部分は白にする（JPEG は透明を持てない）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= CHAT_OUTBOUND_IMAGE_MAX_BYTES) return blob;
    }
  }
  throw new Error('画像を 1MB 以下に縮められませんでした。別の画像を選んでください');
}
