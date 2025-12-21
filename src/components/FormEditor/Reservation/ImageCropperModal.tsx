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

          // Output size: 720x405px (16:9, 2x for high quality)
          const width = 720;
          const height = 405;
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
            {/* Cropper container */}
            <div className="relative w-full" style={{ height: '400px' }}>
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={16 / 9}
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
                プレビュー (16:9 ワイド)
              </p>
              <div className={`p-4 rounded-lg text-center ${themeClasses.card}`}>
                <p className={`text-sm ${themeClasses.text.secondary}`}>
                  ✓ トリミングが完了したら「確定」ボタンを押してください
                </p>
                <p className={`text-xs ${themeClasses.text.tertiary} mt-2`}>
                  16:9 アスペクト比でフォームに表示されます（アップロードは720×405px）
                </p>
              </div>
            </div>

            {/* Info message */}
            <div className={`p-3 rounded-lg ${themeClasses.highlight}`}>
              <p className={`text-xs ${themeClasses.text.secondary}`}>
                💡 16:9（ワイド）のアスペクト比で固定されています。トリミング領域をドラッグして調整してください。
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
