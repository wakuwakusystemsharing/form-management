'use client';

import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';

interface CroppedAreaPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCropConfirm: (blob: Blob) => Promise<void>;
  imageFile: File;
  theme?: ThemeType;
}

/** トリミングのアスペクト比。出力サイズは幅 720px を基準に高さを比率で決める（縦長は高さ基準） */
export const CROP_ASPECTS: Array<{ id: string; label: string; ratio: number; width: number; height: number }> = [
  { id: 'wide', label: '16:9 ワイド', ratio: 16 / 9, width: 720, height: 405 },
  { id: 'standard', label: '4:3', ratio: 4 / 3, width: 720, height: 540 },
  { id: 'square', label: '1:1 正方形', ratio: 1, width: 720, height: 720 },
  { id: 'portrait', label: '3:4 縦長', ratio: 3 / 4, width: 720, height: 960 },
  { id: 'tall', label: '9:16 縦長ワイド', ratio: 9 / 16, width: 720, height: 1280 },
];

/** 自由形（スライダーで比率を調整）: 横長は幅 720px、縦長は高さ 960px を基準に出力サイズを決める */
export const FREE_ASPECT_ID = 'free';
export const FREE_RATIO_MIN = 0.5;   // 1:2（縦長）
export const FREE_RATIO_MAX = 2.5;   // 5:2（横長）
export function freeOutputSize(ratio: number): { width: number; height: number } {
  const r = Math.min(FREE_RATIO_MAX, Math.max(FREE_RATIO_MIN, ratio));
  return r >= 1
    ? { width: 720, height: Math.round(720 / r) }
    : { width: Math.round(960 * r), height: 960 };
}
export function formatFreeRatio(ratio: number): string {
  return ratio >= 1 ? `${(Math.round(ratio * 100) / 100)}:1` : `1:${(Math.round((1 / ratio) * 100) / 100)}`;
}

const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isOpen,
  onClose,
  onCropConfirm,
  imageFile,
  theme = 'dark'
}) => {
  const themeClasses = getThemeClasses(theme);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CroppedAreaPixels | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  // アスペクト比（既定 16:9。正方形・縦長の画像は比率を変えて見切れないようにする）
  const [aspectId, setAspectId] = useState<string>('wide');
  // 自由形の比率（幅 ÷ 高さ）。1 = 正方形、> 1 横長、< 1 縦長
  const [freeRatio, setFreeRatio] = useState<number>(1);
  const isFree = aspectId === FREE_ASPECT_ID;
  const fixed = CROP_ASPECTS.find((a) => a.id === aspectId) || CROP_ASPECTS[0];
  const aspect = isFree
    ? { id: FREE_ASPECT_ID, label: `自由（${formatFreeRatio(freeRatio)}）`, ratio: freeRatio, ...freeOutputSize(freeRatio) }
    : fixed;
  const selectAspect = (id: string) => {
    setAspectId(id);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const onCropComplete = useCallback((croppedArea: CroppedAreaPixels, croppedAreaPixels: CroppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;

    setIsProcessing(true);
    try {
      // Create image URL from file
      const imageUrl = URL.createObjectURL(imageFile);
      const image = new Image();

      image.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            console.error('Failed to get canvas context');
            setIsProcessing(false);
            return;
          }

          // 出力サイズ: 選択したアスペクト比（幅 720px 基準。縦長は 720×960 / 720×1280）
          const width = aspect.width;
          const height = aspect.height;
          canvas.width = width;
          canvas.height = height;

          // Draw cropped image on canvas
          // croppedAreaPixels contains the coordinates in the original image's scale
          ctx.drawImage(
            image,
            croppedAreaPixels.x,
            croppedAreaPixels.y,
            croppedAreaPixels.width,
            croppedAreaPixels.height,
            0,
            0,
            width,
            height
          );

          // Convert canvas to blob
          canvas.toBlob(
            async (blob) => {
              try {
                if (blob) {
                  await onCropConfirm(blob);
                  onClose();
                } else {
                  console.error('Failed to create blob');
                }
              } catch (error) {
                console.error('Error during crop confirmation:', error);
              } finally {
                setIsProcessing(false);
              }
            },
            'image/jpeg',
            0.9
          );
        } catch (error) {
          console.error('Error in image.onload:', error);
          setIsProcessing(false);
        }
      };

      image.onerror = () => {
        console.error('Failed to load image');
        setIsProcessing(false);
      };

      image.src = imageUrl;
    } catch (error) {
      console.error('Cropping error:', error);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const imageUrl = URL.createObjectURL(imageFile);

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${themeClasses.modalOverlay}`}>
      <div className={`rounded-lg shadow-xl max-w-2xl w-full mx-4 ${themeClasses.modal}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg font-semibold ${themeClasses.text.primary}`}>
              画像をトリミング
            </h3>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className={`${themeClasses.text.secondary} ${
                isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:text-gray-300'
              } transition-colors`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* アスペクト比の選択 */}
            <div className="space-y-2">
              <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>画像の形（アスペクト比）</label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="アスペクト比">
                {[...CROP_ASPECTS, { id: FREE_ASPECT_ID, label: '自由形' }].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={aspectId === a.id}
                    onClick={() => selectAspect(a.id)}
                    disabled={isProcessing}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      aspectId === a.id
                        ? (theme === 'light' ? 'bg-[rgb(244,144,49)] border-[rgb(244,144,49)] text-white' : 'bg-cyan-600 border-cyan-600 text-white')
                        : (theme === 'light' ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700')
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {isFree && (
                <div className="space-y-1">
                  <label className={`block text-xs ${themeClasses.text.secondary}`}>
                    枠の形: {freeRatio >= 1 ? '横長' : '縦長'}（{formatFreeRatio(freeRatio)}）— 左へ動かすと縦長、右へ動かすと横長
                  </label>
                  <input
                    type="range"
                    min={FREE_RATIO_MIN}
                    max={FREE_RATIO_MAX}
                    step="0.01"
                    value={freeRatio}
                    onChange={(e) => { setFreeRatio(parseFloat(e.target.value)); setCrop({ x: 0, y: 0 }); }}
                    disabled={isProcessing}
                    aria-label="枠の縦横比"
                    className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${theme === 'light' ? 'bg-gray-300' : 'bg-gray-600'}`}
                  />
                  <div className="flex gap-2">
                    {[{ l: '縦長 1:2', v: 0.5 }, { l: '縦長 3:4', v: 0.75 }, { l: '正方形', v: 1 }, { l: '横長 4:3', v: 4 / 3 }, { l: '横長 2:1', v: 2 }].map((pr) => (
                      <button key={pr.l} type="button" onClick={() => { setFreeRatio(pr.v); setCrop({ x: 0, y: 0 }); }} className={`px-2 py-0.5 text-[11px] rounded border ${theme === 'light' ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}`}>
                        {pr.l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Cropper container */}
            <div className="relative w-full" style={{ height: '400px' }}>
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={aspect.ratio}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                cropShape="rect"
                showGrid={true}
              />
            </div>

            {/* Zoom slider */}
            <div className="space-y-2">
              <label className={`block text-sm font-medium ${themeClasses.text.secondary}`}>
                ズーム: {Math.round(zoom * 100)}%
              </label>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                disabled={isProcessing}
                className={`w-full h-2 rounded-lg appearance-none cursor-pointer ${
                  theme === 'light' ? 'bg-gray-300' : 'bg-gray-600'
                }`}
              />
            </div>

            {/* Preview section */}
            <div className="space-y-2">
              <p className={`text-sm font-medium ${themeClasses.text.secondary}`}>
                プレビュー（{aspect.label}）
              </p>
              <div className={`p-4 rounded-lg text-center ${themeClasses.card}`}>
                <p className={`text-sm ${themeClasses.text.secondary}`}>
                  ✓ トリミングが完了したら「確定」ボタンを押してください
                </p>
                <p className={`text-xs ${themeClasses.text.tertiary} mt-2`}>
                  {aspect.label} でアップロードされます（{aspect.width}×{aspect.height}px）。フォームでは画像の形のまま表示されます
                </p>
              </div>
            </div>

            {/* Info message */}
            <div className={`p-3 rounded-lg ${themeClasses.highlight}`}>
              <p className={`text-xs ${themeClasses.text.secondary}`}>
                💡 正方形や縦長の写真は上の「画像の形」を切り替えると見切れずに使えます。画像をドラッグ・ズームして位置を調整してください。
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className={`flex justify-end space-x-3 mt-6 pt-4 border-t ${themeClasses.divider}`}>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className={`px-4 py-2 rounded-md ${themeClasses.button.secondary} ${
                isProcessing ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              キャンセル
            </button>
            <button
              onClick={handleConfirm}
              disabled={isProcessing}
              className={`px-4 py-2 rounded-md ${themeClasses.button.primary} ${
                isProcessing ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isProcessing ? '処理中...' : '確定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageCropperModal;
