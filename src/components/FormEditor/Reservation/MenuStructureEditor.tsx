'use client';

import React, { useState } from 'react';
import { Form, MenuCategory, MenuItem, MenuOption, SubMenuItem } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import ImageCropperModal from './ImageCropperModal';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface MenuStructureEditorProps {
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: ThemeType;
}

interface MenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (menuItem: MenuItem) => void;
  menuItem?: MenuItem;
  categoryId: string;
  genderEnabled: boolean;  // 性別機能が有効かどうか
  theme?: 'light' | 'dark';
  form: Form; // Form object for store_id
}

interface MenuOptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (option: MenuOption) => void;
  option?: MenuOption;
  theme?: 'light' | 'dark';
}

interface SubMenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (subMenuItem: SubMenuItem) => void;
  subMenuItem?: SubMenuItem;
  theme?: 'light' | 'dark';
  form: Form; // Form object for store_id
}

// 金額フォーマット用のヘルパー関数
const formatPrice = (value: string): string => {
  // カンマを除去して数値のみ取得
  const numericValue = value.replace(/,/g, '');
  if (!numericValue) return '';
  // 数値に変換
  const num = parseInt(numericValue, 10);
  if (isNaN(num)) return '';
  
  // カンマ区切りでフォーマット（環境に依存しない実装）
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const parsePrice = (value: string): string => {
  // カンマを除去して数値のみ返す
  return value.replace(/,/g, '');
};

const SubMenuItemModal: React.FC<SubMenuItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  subMenuItem,
  theme = 'dark',
  form
}) => {
  const themeClasses = getThemeClasses(theme);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [hidePrice, setHidePrice] = useState(false);
  const [hideDuration, setHideDuration] = useState(false);

  React.useEffect(() => {
    if (subMenuItem) {
      setName(subMenuItem.name);
      setPrice(formatPrice(subMenuItem.price.toString()));
      setDuration(subMenuItem.duration.toString());
      setDescription(subMenuItem.description || '');
      setImage(subMenuItem.image || '');
      setHidePrice(subMenuItem.hide_price || false);
      setHideDuration(subMenuItem.hide_duration || false);
    } else {
      setName('');
      setPrice('');
      setDuration('');
      setDescription('');
      setImage('');
      setHidePrice(false);
      setHideDuration(false);
    }
  }, [subMenuItem]);

  const handleSave = () => {
    const newSubMenuItem: SubMenuItem = {
      id: subMenuItem?.id || `submenu_${Date.now()}`,
      name,
      price: parseInt(parsePrice(price)) || 0,
      duration: parseInt(duration) || 0,
      description: description || undefined,
      image: image || undefined,
      hide_price: hidePrice || undefined,
      hide_duration: hideDuration || undefined
    };
    onSave(newSubMenuItem);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {subMenuItem ? 'サブメニュー編集' : '新規サブメニュー追加'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="submenu-name">
              サブメニュー名 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="submenu-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: カット（ショート）"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="submenu-price">料金（円）</Label>
              <Input
                id="submenu-price"
                type="text"
                value={price}
                onChange={(e) => {
                  const rawValue = parsePrice(e.target.value);
                  if (rawValue === '' || /^\d+$/.test(rawValue)) {
                    setPrice(rawValue === '' ? '' : formatPrice(rawValue));
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value) {
                    setPrice(formatPrice(e.target.value));
                  }
                }}
                placeholder="例: 5,000"
              />
              <p className="text-xs text-muted-foreground">
                カンマは自動で追加されます
              </p>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="submenu-hide-price"
                  checked={!!hidePrice}
                  onChange={(e) => setHidePrice(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <label htmlFor="submenu-hide-price" className="text-xs text-muted-foreground">料金を非表示</label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="submenu-duration">所要時間（分）</Label>
              <Input
                id="submenu-duration"
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min="0"
              />
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="submenu-hide-duration"
                  checked={!!hideDuration}
                  onChange={(e) => setHideDuration(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <label htmlFor="submenu-hide-duration" className="text-xs text-muted-foreground">所要時間を非表示</label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="submenu-description">説明（オプション）</Label>
            <Textarea
              id="submenu-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="サブメニューの詳細説明を入力してください"
            />
            <p className="text-xs text-muted-foreground">
              お客様に表示される説明文です
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="submenu-image">画像（オプション）</Label>
            <div className="space-y-3">
              {/* 画像URL入力 */}
              <div className="flex space-x-2">
                <Input
                  id="submenu-image"
                  type="url"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="flex-1"
                />
                <div className="relative">
                  <input
                    type="file"
                    ref={(el) => {
                      if (el && !el.dataset.submenuInitialized) {
                        el.dataset.submenuInitialized = 'true';
                        el.accept = 'image/*';
                        el.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            setSelectedFile(file);
                            setCropperOpen(true);
                          }
                        };
                      }
                    }}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      const input = (e.currentTarget.parentNode as HTMLElement).querySelector('input[type="file"]') as HTMLInputElement;
                      input?.click();
                    }}
                    disabled={uploading}
                  >
                    {uploading ? 'アップロード中...' : 'ファイル選択'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                画像URLを直接入力するか、ファイルをアップロードしてください（最大5MB、JPEG/PNG/GIF/WebP対応）
              </p>
            </div>
            {image && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">プレビュー:</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setImage('')}
                  >
                    削除
                  </Button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={image} 
                  alt="プレビュー" 
                  className="w-40 h-40 object-cover rounded-md border"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>

      </DialogContent>

      <ImageCropperModal
        isOpen={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropConfirm={async (blob: Blob) => {
          setUploading(true);
          try {
            const formData = new FormData();
            formData.append('file', blob, 'cropped-image.jpg');
            formData.append('storeId', form.store_id);
            formData.append('submenuId', subMenuItem?.id || `submenu_${Date.now()}`);
            // 古い画像URLがあれば送信（削除処理用）
            if (image) {
              formData.append('oldImageUrl', image);
            }
            
            const response = await fetch('/api/upload/menu-image', {
              method: 'POST',
              body: formData,
            });
            
            if (response.ok) {
              const { url } = await response.json();
              setImage(url);
            } else {
              const error = await response.json();
              alert(`アップロードに失敗しました: ${error.error}`);
            }
          } catch (error) {
            console.error('Upload error:', error);
            alert('アップロードに失敗しました');
          } finally {
            setUploading(false);
          }
        }}
        imageFile={selectedFile!}
        theme={theme}
      />
    </Dialog>
  );
};

const MenuOptionModal: React.FC<MenuOptionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  option,
  theme = 'dark'
}) => {
  const themeClasses = getThemeClasses(theme);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [hidePrice, setHidePrice] = useState(false);
  const [hideDuration, setHideDuration] = useState(false);

  React.useEffect(() => {
    if (option) {
      setName(option.name);
      setPrice(formatPrice(option.price.toString()));
      setDuration(option.duration.toString());
      setDescription(option.description || '');
      setIsDefault(option.is_default || false);
      setHidePrice(option.hide_price || false);
      setHideDuration(option.hide_duration || false);
    } else {
      setName('');
      setPrice('');
      setDuration('');
      setDescription('');
      setIsDefault(false);
      setHidePrice(false);
      setHideDuration(false);
    }
  }, [option]);

  const handleSave = () => {
    const newOption: MenuOption = {
      id: option?.id || `option_${Date.now()}`,
      name,
      price: parseInt(parsePrice(price)) || 0,
      duration: parseInt(duration) || 0,
      description: description || undefined,
      is_default: isDefault,
      hide_price: hidePrice || undefined,
      hide_duration: hideDuration || undefined
    };
    onSave(newOption);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${themeClasses.modalOverlay}`}>
      <div className={`rounded-lg shadow-xl max-w-md w-full mx-4 ${themeClasses.modal}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg font-semibold ${themeClasses.text.primary}`}>
              {option ? 'オプション編集' : '新規オプション追加'}
            </h3>
            <button
              onClick={onClose}
              className={themeClasses.text.tertiary}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className={`block text-sm ${themeClasses.label} mb-1`}>
                オプション名
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`block text-sm ${themeClasses.label} mb-1`}>
                  追加料金（円）
                </label>
                <input
                  type="text"
                  value={price}
                  onChange={(e) => {
                    const rawValue = parsePrice(e.target.value);
                    if (rawValue === '' || /^\d+$/.test(rawValue)) {
                      setPrice(rawValue === '' ? '' : formatPrice(rawValue));
                    }
                  }}
                  onBlur={(e) => {
                    if (e.target.value) {
                      setPrice(formatPrice(e.target.value));
                    }
                  }}
                  placeholder="例: 1,000"
                  className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                />
                <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
                  カンマは自動で追加されます
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="option-hide-price"
                    checked={!!hidePrice}
                    onChange={(e) => setHidePrice(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <label htmlFor="option-hide-price" className={`text-xs ${themeClasses.text.tertiary}`}>料金を非表示</label>
                </div>
              </div>
              <div>
                <label className={`block text-sm ${themeClasses.label} mb-1`}>
                  追加時間（分）
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  min="0"
                  className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                />
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="option-hide-duration"
                    checked={!!hideDuration}
                    onChange={(e) => setHideDuration(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <label htmlFor="option-hide-duration" className={`text-xs ${themeClasses.text.tertiary}`}>所要時間を非表示</label>
                </div>
              </div>
            </div>

            <div>
              <label className={`block text-sm ${themeClasses.label} mb-1`}>
                説明（オプション）
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`w-full px-3 py-2 rounded-md ${themeClasses.textarea}`}
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_default"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 text-cyan-600 focus:ring-cyan-500 rounded"
              />
              <label htmlFor="is_default" className={`ml-2 block text-sm ${themeClasses.label}`}>
                デフォルトで選択する
              </label>
            </div>
          </div>

          <div className={`flex justify-end space-x-3 mt-6 pt-4 border-t ${themeClasses.divider}`}>
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-md ${themeClasses.button.secondary}`}
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className={`px-4 py-2 rounded-md ${themeClasses.button.primary}`}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MenuItemModal: React.FC<MenuItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  menuItem,
  categoryId,
  genderEnabled,
  theme = 'dark',
  form
}) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [genderFilter, setGenderFilter] = useState<'male' | 'female' | 'both'>('both');
  const [options, setOptions] = useState<MenuOption[]>([]);
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<MenuOption | undefined>();
  const [hasSubmenu, setHasSubmenu] = useState(false);
  const [subMenuItems, setSubMenuItems] = useState<SubMenuItem[]>([]);
  const [subMenuModalOpen, setSubMenuModalOpen] = useState(false);
  const [selectedSubMenuItem, setSelectedSubMenuItem] = useState<SubMenuItem | undefined>();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [hidePrice, setHidePrice] = useState(false);
  const [hideDuration, setHideDuration] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      if (menuItem) {
        setName(menuItem.name || '');
        setPrice(menuItem.price ? formatPrice(menuItem.price.toString()) : '');
        setDuration(menuItem.duration?.toString() || '');
        setDescription(menuItem.description || '');
        setImage(menuItem.image || '');
        setGenderFilter(menuItem.gender_filter || 'both');
        setOptions(menuItem.options || []);
        setHasSubmenu(menuItem.has_submenu || false);
        setSubMenuItems(menuItem.sub_menu_items || []);
        setHidePrice(menuItem.hide_price || false);
        setHideDuration(menuItem.hide_duration || false);
      } else {
        setName('');
        setPrice('');
        setDuration('');
        setDescription('');
        setImage('');
        setGenderFilter('both');
        setOptions([]);
        setHasSubmenu(false);
        setSubMenuItems([]);
        setHidePrice(false);
        setHideDuration(false);
      }
    }
  }, [menuItem, isOpen]);

  const handleSave = () => {
    const newMenuItem: MenuItem = {
      id: menuItem?.id || `menu_${Date.now()}`,
      name,
      price: hasSubmenu ? undefined : (parseInt(parsePrice(price)) || 0),
      duration: hasSubmenu ? undefined : (parseInt(duration) || 0),
      description: description || undefined,
      image: image || undefined,
      category_id: categoryId,
      gender_filter: genderEnabled ? genderFilter : undefined,
      options: hasSubmenu ? undefined : (options.length > 0 ? options : undefined),
      has_submenu: hasSubmenu,
      sub_menu_items: hasSubmenu ? subMenuItems : undefined,
      hide_price: hidePrice || undefined,
      hide_duration: hideDuration || undefined
    };
    onSave(newMenuItem);
    onClose();
  };

  const handleAddSubMenuItem = () => {
    setSelectedSubMenuItem(undefined);
    setSubMenuModalOpen(true);
  };

  const handleEditSubMenuItem = (subMenuItem: SubMenuItem) => {
    setSelectedSubMenuItem(subMenuItem);
    setSubMenuModalOpen(true);
  };

  const handleSaveSubMenuItem = (subMenuItem: SubMenuItem) => {
    let updatedSubMenuItems: SubMenuItem[];
    if (selectedSubMenuItem?.id) {
      updatedSubMenuItems = subMenuItems.map(item => item.id === selectedSubMenuItem.id ? subMenuItem : item);
    } else {
      updatedSubMenuItems = [...subMenuItems, subMenuItem];
    }
    setSubMenuItems(updatedSubMenuItems);
    
    // 親MenuItemModalのプレビューをすぐに更新するために、onSaveを呼ぶ
    if (menuItem && hasSubmenu) {
      const updatedMenuItem: MenuItem = {
        ...menuItem,
        id: menuItem.id,
        name: menuItem.name,
        sub_menu_items: updatedSubMenuItems
      };
      onSave(updatedMenuItem);
    }
  };

  const handleDeleteSubMenuItem = (subMenuItemId: string) => {
    if (window.confirm('このサブメニューを削除しますか？')) {
      setSubMenuItems(prev => prev.filter(item => item.id !== subMenuItemId));
    }
  };

  const handleAddOption = () => {
    setSelectedOption(undefined);
    setOptionModalOpen(true);
  };

  const handleEditOption = (option: MenuOption) => {
    setSelectedOption(option);
    setOptionModalOpen(true);
  };

  const handleSaveOption = (option: MenuOption) => {
    if (selectedOption?.id) {
      setOptions(prev => prev.map(opt => opt.id === selectedOption.id ? option : opt));
    } else {
      setOptions(prev => [...prev, option]);
    }
  };

  const handleDeleteOption = (optionId: string) => {
    if (window.confirm('このオプションを削除しますか？')) {
      setOptions(prev => prev.filter(opt => opt.id !== optionId));
    }
  };

  if (!isOpen) return null;

  const themeClasses = getThemeClasses(theme);

  return (
    <>
      <div className={`fixed inset-0 flex items-center justify-center z-50 ${themeClasses.modalOverlay}`}>
        <div className={`${themeClasses.modal} rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto`}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${themeClasses.text.primary}`}>
                {menuItem ? 'メニュー編集' : '新規メニュー追加'}
              </h3>
              <button
                onClick={onClose}
                className={themeClasses.text.tertiary}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

                        <div className="space-y-6">
              {/* 基本情報 */}
              <div className="space-y-4">
                <h4 className={`text-md font-medium ${themeClasses.text.primary} border-b ${themeClasses.divider} pb-2`}>基本情報</h4>
                
                {/* サブメニューのOn/Offトグル */}
                <div className={`${themeClasses.card} p-4 rounded-md`}>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="has_submenu"
                      checked={hasSubmenu}
                      onChange={(e) => setHasSubmenu(e.target.checked)}
                      className="h-4 w-4 text-cyan-600 focus:ring-cyan-500 rounded"
                    />
                    <label htmlFor="has_submenu" className={`ml-2 block text-sm ${themeClasses.label}`}>
                      サブメニューを使用する
                    </label>
                  </div>
                  <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
                    有効にすると、このメニュー内に複数の選択肢を作成できます
                  </p>
                </div>
                
                <div>
                  <label className={`block text-sm ${themeClasses.label} mb-1`}>
                    メニュー名
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                  />
                </div>

                {!hasSubmenu && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`block text-sm ${themeClasses.label} mb-1`}>
                          料金（円）
                        </label>
                        <input
                          type="text"
                          value={price}
                          onChange={(e) => {
                            const rawValue = parsePrice(e.target.value);
                            if (rawValue === '' || /^\d+$/.test(rawValue)) {
                              setPrice(rawValue === '' ? '' : formatPrice(rawValue));
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value) {
                              setPrice(formatPrice(e.target.value));
                            }
                          }}
                          placeholder="例: 5,000"
                          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                        />
                        <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
                          カンマは自動で追加されます
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="checkbox"
                            id="hide-price"
                            checked={!!hidePrice}
                            onChange={(e) => setHidePrice(e.target.checked)}
                            className="h-4 w-4 rounded"
                          />
                          <label htmlFor="hide-price" className={`text-xs ${themeClasses.text.tertiary}`}>料金を非表示</label>
                        </div>
                      </div>
                      <div>
                        <label className={`block text-sm ${themeClasses.label} mb-1`}>
                          所要時間（分）
                        </label>
                        <input
                          type="number"
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          min="0"
                          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="checkbox"
                            id="hide-duration"
                            checked={!!hideDuration}
                            onChange={(e) => setHideDuration(e.target.checked)}
                            className="h-4 w-4 rounded"
                          />
                          <label htmlFor="hide-duration" className={`text-xs ${themeClasses.text.tertiary}`}>所要時間を非表示</label>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className={`block text-sm ${themeClasses.label} mb-1`}>
                    説明（オプション）
                  </label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={`w-full px-3 py-2 rounded-md ${themeClasses.textarea}`}
                  />
                </div>

                {/* 画像 */}
                <div>
                  <label className={`block text-sm ${themeClasses.label} mb-1`}>
                    画像（オプション）
                  </label>
                  <div className="space-y-3">
                    {/* 画像URL入力 */}
                    <div className="flex space-x-2">
                      <input
                        type="url"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder="https://example.com/image.jpg"
                        className={`flex-1 px-3 py-2 rounded-md ${themeClasses.input}`}
                      />
                      <div className="relative">
                        <input
                          type="file"
                          ref={(el) => {
                            if (el && !el.dataset.menuInitialized) {
                              el.dataset.menuInitialized = 'true';
                              el.accept = 'image/*';
                              el.onchange = async (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (file) {
                                  setSelectedFile(file);
                                  setCropperOpen(true);
                                }
                              };
                            }
                          }}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            const input = (e.currentTarget.parentNode as HTMLElement).querySelector('input[type="file"]') as HTMLInputElement;
                            input?.click();
                          }}
                          disabled={uploading}
                          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            uploading 
                              ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                              : `${themeClasses.button.secondary} hover:opacity-90`
                          }`}
                        >
                          {uploading ? 'アップロード中...' : 'ファイル選択'}
                        </button>
                      </div>
                    </div>
                    <p className={`text-xs ${themeClasses.text.tertiary}`}>
                      画像URLを直接入力するか、ファイルをアップロードしてください（最大5MB、JPEG/PNG/GIF/WebP対応）
                    </p>
                  </div>
                  {image && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className={`text-xs ${themeClasses.text.secondary}`}>プレビュー:</p>
                        <button
                          type="button"
                          onClick={() => setImage('')}
                          className={`text-xs ${themeClasses.button.delete} px-2 py-1 rounded`}
                        >
                          削除
                        </button>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={image} 
                        alt="プレビュー" 
                        className="w-32 h-32 object-cover rounded-md border"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 性別フィルター */}
                {genderEnabled && (
                  <div className={`p-3 rounded-md ${themeClasses.highlight}`}>
                    <label className={`block text-sm ${themeClasses.label} mb-2`}>
                      🧑‍🤝‍🧑 性別フィルター
                    </label>
                    <p className={`text-xs ${themeClasses.text.secondary} mb-3`}>
                      このメニューを表示する対象を選択してください
                    </p>
                    <select
                      value={genderFilter}
                      onChange={(e) => setGenderFilter(e.target.value as 'male' | 'female' | 'both')}
                      className={`w-full px-3 py-2 rounded-md ${themeClasses.select}`}
                    >
                      <option value="both">👫 全員に表示（デフォルト）</option>
                      <option value="male">👨 男性にのみ表示</option>
                      <option value="female">👩 女性にのみ表示</option>
                    </select>
                  </div>
                )}
              </div>

              {/* サブメニュー管理 */}
              {hasSubmenu && (
                <div className="space-y-4">
                  <h4 className={`text-md font-medium ${themeClasses.text.primary} border-b ${themeClasses.divider} pb-2`}>サブメニュー管理</h4>
                  
                  <div className="flex items-center justify-between">
                    <p className={`text-sm ${themeClasses.text.secondary}`}>
                      サブメニューを使用する場合、料金と時間はサブメニューで設定します
                    </p>
                    <button
                      onClick={handleAddSubMenuItem}
                      className={`px-3 py-1 text-sm rounded-md ${themeClasses.button.primary}`}
                    >
                      サブメニュー追加
                    </button>
                  </div>

                  {subMenuItems.length === 0 ? (
                    <p className={`text-sm py-4 text-center rounded-md ${themeClasses.emptyState}`}>
                      まだサブメニューがありません
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {subMenuItems.map((subMenuItem, index) => (
                        <div key={subMenuItem.id || `submenu-${index}`} className={`flex items-center justify-between p-3 rounded-md ${themeClasses.card}`}>
                          <div className="flex-1">
                            <h5 className={`font-medium ${themeClasses.text.primary}`}>{subMenuItem.name}</h5>
                            <p className={`text-sm ${themeClasses.text.secondary}`}>
                              ¥{subMenuItem.price.toLocaleString()} • {subMenuItem.duration}分
                            </p>
                            {subMenuItem.description && (
                              <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>{subMenuItem.description}</p>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEditSubMenuItem(subMenuItem)}
                              className={`p-1 rounded ${themeClasses.button.edit}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteSubMenuItem(subMenuItem.id)}
                              className={`p-1 rounded ${themeClasses.button.delete}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* オプション設定 */}
              {!hasSubmenu && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className={`text-md font-medium ${themeClasses.text.primary} border-b ${themeClasses.divider} pb-2 flex-1`}>
                    メニューオプション
                  </h4>
                  <button
                    onClick={handleAddOption}
                    className={`px-3 py-1 text-sm rounded-md ${themeClasses.button.primary}`}
                  >
                    オプション追加
                  </button>
                </div>

                {options.length === 0 ? (
                  <p className={`text-sm py-4 text-center rounded-md ${themeClasses.emptyState}`}>
                    まだオプションがありません
                  </p>
                ) : (
                  <div className="space-y-2">
                    {options.map((option) => (
                      <div key={option.id} className={`flex items-center justify-between p-3 rounded-md ${themeClasses.card}`}>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <h5 className={`font-medium ${themeClasses.text.primary}`}>{option.name}</h5>
                            {option.is_default && (
                              <span className={themeClasses.badge.cyan}>
                                デフォルト
                              </span>
                            )}
                          </div>
                          <p className={`text-sm ${themeClasses.text.secondary}`}>
                            +¥{option.price.toLocaleString()} • +{option.duration}分
                          </p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEditOption(option)}
                            className={`p-1 rounded ${themeClasses.button.edit}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteOption(option.id)}
                            className={`p-1 rounded ${themeClasses.button.delete}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>

            <div className={`flex justify-end space-x-3 mt-6 pt-4 border-t ${themeClasses.divider}`}>
              <button
                onClick={onClose}
                className={`px-4 py-2 rounded-md ${themeClasses.button.secondary}`}
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className={`px-4 py-2 rounded-md ${themeClasses.button.primary}`}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      <MenuOptionModal
        isOpen={optionModalOpen}
        onClose={() => setOptionModalOpen(false)}
        onSave={handleSaveOption}
        option={selectedOption}
        theme={theme}
      />

      <SubMenuItemModal
        isOpen={subMenuModalOpen}
        onClose={() => setSubMenuModalOpen(false)}
        onSave={handleSaveSubMenuItem}
        subMenuItem={selectedSubMenuItem}
        theme={theme}
        form={form}
      />

      <ImageCropperModal
        isOpen={cropperOpen}
        onClose={() => setCropperOpen(false)}
        onCropConfirm={async (blob: Blob) => {
          setUploading(true);
          try {
            const formData = new FormData();
            formData.append('file', blob, 'cropped-image.jpg');
            formData.append('storeId', form.store_id);
            formData.append('menuId', menuItem?.id || `menu_${Date.now()}`);
            // 古い画像URLがあれば送信（削除処理用）
            if (image) {
              formData.append('oldImageUrl', image);
            }
            
            const response = await fetch('/api/upload/menu-image', {
              method: 'POST',
              body: formData,
            });
            
            if (response.ok) {
              const { url } = await response.json();
              setImage(url);
            } else {
              const error = await response.json();
              alert(`アップロードに失敗しました: ${error.error}`);
            }
          } catch (error) {
            console.error('Upload error:', error);
            alert('アップロードに失敗しました');
          } finally {
            setUploading(false);
          }
        }}
        imageFile={selectedFile!}
        theme={theme}
      />
    </>
  );
};

const MenuStructureEditor: React.FC<MenuStructureEditorProps> = ({ form, onUpdate, theme = 'dark' }) => {
  const themeClasses = getThemeClasses(theme);

  // カテゴリー管理
  const [categories, setCategories] = useState<MenuCategory[]>(() => {
    const cats = form.config?.menu_structure?.categories;
    if (cats && Array.isArray(cats) && cats.length > 0) return cats;
    return [{ id: 'default', name: 'メニュー', display_name: 'メニュー', menus: [], options: [], selection_mode: 'single', gender_condition: 'all' }];
  });
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set([form.config?.menu_structure?.categories?.[0]?.id || 'default'])
  );

  // カテゴリーモーダル
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catDisplayName, setCatDisplayName] = useState('');

  // メニューモーダル
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState<MenuItem | undefined>();
  const [activeMenuCategoryId, setActiveMenuCategoryId] = useState<string>('');

  // カテゴリーオプションモーダル（MenuItemModalを流用）
  const [catOptModalOpen, setCatOptModalOpen] = useState(false);
  const [editingCatOpt, setEditingCatOpt] = useState<MenuItem | undefined>();
  const [activeCatOptCategoryId, setActiveCatOptCategoryId] = useState<string>('');

  const updateCategories = (updated: MenuCategory[]) => {
    setCategories(updated);
    onUpdate({
      ...form,
      config: {
        ...form.config,
        menu_structure: {
          ...form.config?.menu_structure,
          categories: updated,
          structure_type: 'category_based'
        }
      }
    });
  };

  const toggleCategory = (id: string) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // カテゴリーCRUD
  const handleOpenAddCategory = () => {
    setEditingCategory(null);
    setCatName('');
    setCatDisplayName('');
    setCategoryModalOpen(true);
  };
  const handleOpenEditCategory = (cat: MenuCategory) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatDisplayName(cat.display_name || cat.name);
    setCategoryModalOpen(true);
  };
  const handleSaveCategory = () => {
    const name = catName.trim() || 'カテゴリー';
    const displayName = catDisplayName.trim() || name;
    if (editingCategory) {
      updateCategories(categories.map(c => c.id === editingCategory.id ? { ...c, name, display_name: displayName } : c));
    } else {
      const newCat: MenuCategory = { id: `cat_${Date.now()}`, name, display_name: displayName, menus: [], options: [], selection_mode: 'single', gender_condition: 'all' };
      updateCategories([...categories, newCat]);
      setOpenCategories(prev => new Set([...prev, newCat.id]));
    }
    setCategoryModalOpen(false);
  };
  const handleDeleteCategory = (id: string) => {
    if (categories.length <= 1) { alert('カテゴリーは最低1つ必要です'); return; }
    if (window.confirm('このカテゴリーとその中のメニュー・オプションをすべて削除しますか？')) {
      updateCategories(categories.filter(c => c.id !== id));
    }
  };

  // メニューCRUD
  const handleAddMenuItem = (categoryId: string) => {
    setActiveMenuCategoryId(categoryId);
    setSelectedMenuItem(undefined);
    setMenuModalOpen(true);
  };
  const handleEditMenuItem = (categoryId: string, menu: MenuItem) => {
    setActiveMenuCategoryId(categoryId);
    setSelectedMenuItem(menu);
    setMenuModalOpen(true);
  };
  const handleSaveMenuItem = (menuItem: MenuItem) => {
    updateCategories(categories.map(c => {
      if (c.id !== activeMenuCategoryId) return c;
      const menus = selectedMenuItem?.id
        ? c.menus.map(m => m.id === selectedMenuItem.id ? menuItem : m)
        : [...c.menus, menuItem];
      return { ...c, menus };
    }));
  };
  const handleDeleteMenuItem = (categoryId: string, menuId: string) => {
    if (window.confirm('このメニューを削除しますか？')) {
      updateCategories(categories.map(c => c.id === categoryId ? { ...c, menus: c.menus.filter(m => m.id !== menuId) } : c));
    }
  };

  // カテゴリーオプションCRUD
  const handleAddCatOpt = (categoryId: string) => {
    setActiveCatOptCategoryId(categoryId);
    setEditingCatOpt(undefined);
    setCatOptModalOpen(true);
  };
  const handleEditCatOpt = (categoryId: string, opt: MenuItem) => {
    setActiveCatOptCategoryId(categoryId);
    setEditingCatOpt(opt);
    setCatOptModalOpen(true);
  };
  const handleSaveCatOpt = (opt: MenuItem) => {
    updateCategories(categories.map(c => {
      if (c.id !== activeCatOptCategoryId) return c;
      const options = editingCatOpt?.id
        ? (c.options || []).map(o => o.id === editingCatOpt.id ? opt : o)
        : [...(c.options || []), opt];
      return { ...c, options };
    }));
  };
  const handleDeleteCatOpt = (categoryId: string, optId: string) => {
    if (window.confirm('このオプションを削除しますか？')) {
      updateCategories(categories.map(c => c.id === categoryId ? { ...c, options: (c.options || []).filter(o => o.id !== optId) } : c));
    }
  };

  // トグルUI共通ヘルパー
  const renderToggle = (checked: boolean, onChange: (v: boolean) => void) => (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only" />
      <div className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-cyan-600' : 'bg-gray-600'}`}>
        <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`}></div>
      </div>
    </label>
  );

  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* ページヘッダー */}
      <div className="flex items-center space-x-2">
        <svg className={`w-5 h-5 ${themeClasses.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        <h2 className={`text-lg font-semibold ${themeClasses.text.primary}`}>メニュー管理</h2>
      </div>

      {/* 詳細設定（折りたたみ） */}
      <div className={`${themeClasses.card} rounded-lg overflow-hidden`}>
        <button
          type="button"
          onClick={() => setSettingsOpen(v => !v)}
          className={`w-full flex items-center justify-between p-4 cursor-pointer text-left ${theme === 'light' ? 'hover:bg-gray-50' : 'hover:bg-gray-700/50'} transition-colors`}
        >
          <div className="flex items-center space-x-2">
            <svg className={`w-4 h-4 ${themeClasses.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className={`text-sm font-medium ${themeClasses.text.primary}`}>詳細設定</span>
            <span className={`text-xs ${themeClasses.text.tertiary}`}>（表示オプション・性別・来店回数など）</span>
          </div>
          <svg
            className={`w-4 h-4 ${themeClasses.text.secondary} transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {settingsOpen && (
          <div className={`px-4 pb-4 border-t ${themeClasses.divider} space-y-4 pt-4`}>

      {/* カテゴリーまたいでの複数選択設定 */}
      <div className={`mb-6 p-4 ${themeClasses.card} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
              🔀 カテゴリーまたいでの複数選択
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              複数のカテゴリーからメニューを選択できるようにします
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.config?.menu_structure?.allow_cross_category_selection || false}
              onChange={(e) => {
                const updatedForm = {
                  ...form,
                  config: {
                    ...form.config,
                    menu_structure: {
                      ...form.config?.menu_structure,
                      allow_cross_category_selection: e.target.checked
                    }
                  }
                };
                onUpdate(updatedForm);
              }}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${
              form.config?.menu_structure?.allow_cross_category_selection 
                ? 'bg-cyan-600' 
                : 'bg-gray-600'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                form.config?.menu_structure?.allow_cross_category_selection 
                  ? 'translate-x-5' 
                  : 'translate-x-0'
              } mt-0.5 ml-0.5`}></div>
            </div>
          </label>
        </div>
      </div>

      {/* 注意書き */}
      <div className={`p-4 ${themeClasses.card} rounded-lg`}>
        <div className="mb-2">
          <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
            📢 注意書き
          </h3>
          <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
            フォーム上部にピンク背景で表示されます（任意）
          </p>
        </div>
        <textarea
          value={form.config?.basic_info?.notice || ''}
          onChange={(e) => {
            const updatedForm = {
              ...form,
              config: {
                ...form.config,
                basic_info: {
                  ...form.config?.basic_info,
                  notice: e.target.value
                }
              }
            };
            onUpdate(updatedForm);
          }}
          placeholder="例：〇〇のご予約はお電話にてお問い合わせください。"
          rows={3}
          className={`w-full text-sm rounded-md border px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
            theme === 'light'
              ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
              : 'bg-gray-700 border-gray-600 text-white placeholder-gray-500'
          }`}
        />
      </div>

      {/* 性別選択機能設定 */}
      <div className={`${themeClasses.card} rounded-lg p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-sm font-medium ${themeClasses.text.primary} flex items-center`}>
              🧑‍🤝‍🧑 性別選択機能
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              お客様に性別を選択してもらい、メニューを性別で絞り込む
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.config?.gender_selection?.enabled || false}
              onChange={(e) => {
                const updatedForm = {
                  ...form,
                  config: {
                    ...form.config,
                    gender_selection: {
                      enabled: e.target.checked,
                      required: form.config?.gender_selection?.required || false,
                      options: form.config?.gender_selection?.options || [
                        { value: 'male', label: '男性' },
                        { value: 'female', label: '女性' }
                      ]
                    }
                  }
                };
                onUpdate(updatedForm);
              }}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${
              form.config?.gender_selection?.enabled 
                ? 'bg-cyan-600' 
                : 'bg-gray-600'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                form.config?.gender_selection?.enabled 
                  ? 'translate-x-5' 
                  : 'translate-x-0'
              } mt-0.5 ml-0.5`}></div>
            </div>
          </label>
        </div>
        
        {form.config?.gender_selection?.enabled && (
          <div className={`mt-3 pt-3 border-t ${themeClasses.divider}`}>
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={form.config?.gender_selection?.required || false}
                onChange={(e) => {
                  const updatedForm = {
                    ...form,
                    config: {
                      ...form.config,
                      gender_selection: {
                        ...form.config?.gender_selection,
                        required: e.target.checked
                      }
                    }
                  };
                  onUpdate(updatedForm);
                }}
                className={`h-4 w-4 text-cyan-600 focus:ring-cyan-500 rounded mr-2 ${theme === 'dark' ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300'}`}
              />
              <span className={themeClasses.text.primary}>性別選択を必須にする</span>
            </label>
            <div className={`mt-2 p-2 rounded text-xs ${themeClasses.highlight}`}>
              ✅ メニュー編集時に「性別フィルター」設定が表示されます
            </div>
          </div>
        )}
      </div>

      {/* 前回と同じメニューで予約する設定 */}
      <div className={`mb-6 p-4 ${themeClasses.card} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
              🔁 前回と同じメニューで予約するボタン
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              フォーム上部に「前回と同じメニューで予約する」ボタンを表示
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.config?.ui_settings?.show_repeat_booking || false}
              onChange={(e) => {
                const updatedForm = {
                  ...form,
                  config: {
                    ...form.config,
                    ui_settings: {
                      ...form.config?.ui_settings,
                      show_repeat_booking: e.target.checked
                    }
                  }
                };
                onUpdate(updatedForm);
              }}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${
              form.config?.ui_settings?.show_repeat_booking 
                ? 'bg-cyan-600' 
                : 'bg-gray-600'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                form.config?.ui_settings?.show_repeat_booking 
                  ? 'translate-x-5' 
                  : 'translate-x-0'
              } mt-0.5 ml-0.5`}></div>
            </div>
          </label>
        </div>
        
        {form.config?.ui_settings?.show_repeat_booking && (
          <div className={`mt-3 pt-3 border-t ${themeClasses.divider}`}>
            <div className={`p-2 rounded text-xs ${themeClasses.highlight}`}>
              ✅ お客様が以前選択したメニューを自動で復元できます
            </div>
          </div>
        )}
      </div>

      {/* ご来店回数選択設定 */}
      <div className={`mb-6 p-4 ${themeClasses.card} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
              🔢 ご来店回数選択
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              お客様に来店回数を選択してもらう（初回、2回目以降など）
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.config?.visit_count_selection?.enabled || false}
              onChange={(e) => {
                const updatedForm = {
                  ...form,
                  config: {
                    ...form.config,
                    visit_count_selection: {
                      enabled: e.target.checked,
                      required: form.config?.visit_count_selection?.required || false,
                      options: form.config?.visit_count_selection?.options || [
                        { value: 'first', label: '初回' },
                        { value: 'second', label: '2回目' },
                        { value: 'third_or_more', label: '3回目以降' }
                      ]
                    }
                  }
                };
                onUpdate(updatedForm);
              }}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${
              form.config?.visit_count_selection?.enabled 
                ? 'bg-cyan-600' 
                : 'bg-gray-600'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                form.config?.visit_count_selection?.enabled 
                  ? 'translate-x-5' 
                  : 'translate-x-0'
              } mt-0.5 ml-0.5`}></div>
            </div>
          </label>
        </div>
        
        {form.config?.visit_count_selection?.enabled && (
          <div className={`mt-3 pt-3 border-t ${themeClasses.divider}`}>
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={form.config?.visit_count_selection?.required || false}
                onChange={(e) => {
                  const updatedForm = {
                    ...form,
                    config: {
                      ...form.config,
                      visit_count_selection: {
                        ...form.config?.visit_count_selection,
                        required: e.target.checked
                      }
                    }
                  };
                  onUpdate(updatedForm);
                }}
                className={`h-4 w-4 text-orange-600 focus:ring-orange-500 rounded mr-2 ${
                  theme === 'light' 
                    ? 'bg-gray-100 border-gray-300' 
                    : 'bg-gray-700 border-gray-600'
                }`}
              />
              <span className={themeClasses.text.secondary}>来店回数選択を必須にする</span>
            </label>
          </div>
        )}
      </div>

      {/* クーポン利用有無設定 */}
      <div className={`mb-6 p-4 ${themeClasses.card} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
              🎫 クーポン利用有無
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              お客様にクーポン利用の有無を確認する
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.config?.coupon_selection?.enabled || false}
              onChange={(e) => {
                const updatedForm = {
                  ...form,
                  config: {
                    ...form.config,
                    coupon_selection: {
                      enabled: e.target.checked,
                      coupon_name: form.config?.coupon_selection?.coupon_name,
                      options: form.config?.coupon_selection?.options || [
                        { value: 'use' as const, label: 'クーポン利用あり' },
                        { value: 'not_use' as const, label: 'クーポン利用なし' }
                      ]
                    }
                  }
                };
                onUpdate(updatedForm);
              }}
              className="sr-only"
            />
            <div className={`w-11 h-6 rounded-full transition-colors ${
              form.config?.coupon_selection?.enabled 
                ? 'bg-cyan-600' 
                : 'bg-gray-600'
            }`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                form.config?.coupon_selection?.enabled 
                  ? 'translate-x-5' 
                  : 'translate-x-0'
              } mt-0.5 ml-0.5`}></div>
            </div>
          </label>
        </div>
        
        {form.config?.coupon_selection?.enabled && (
          <div className={`mt-3 pt-3 border-t ${themeClasses.divider}`}>
            <div className="mb-3">
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                クーポン名（オプション）
              </label>
              <input
                type="text"
                value={form.config?.coupon_selection?.coupon_name || ''}
                onChange={(e) => {
                  const updatedForm = {
                    ...form,
                    config: {
                      ...form.config,
                      coupon_selection: {
                        ...form.config?.coupon_selection,
                        enabled: form.config?.coupon_selection?.enabled || false,
                        coupon_name: e.target.value,
                        options: form.config?.coupon_selection?.options || []
                      }
                    }
                  };
                  onUpdate(updatedForm);
                }}
                placeholder="例：2周年記念クーポン"
                className={themeClasses.input}
              />
            </div>
            <div className={`p-2 ${themeClasses.highlight} rounded text-xs ${theme === 'light' ? 'text-cyan-700' : 'text-cyan-300'}`}>
              ✅ 「クーポン利用あり」「クーポン利用なし」の選択肢を表示
            </div>
          </div>
        )}
      </div>

      {/* カスタムフィールド設定 */}
      <div className={`mb-6 p-4 ${themeClasses.card} rounded-lg`}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className={`text-sm font-medium ${themeClasses.text.primary}`}>
              📝 カスタムフィールド
            </h3>
            <p className={`text-xs ${themeClasses.text.secondary} mt-1`}>
              メニュー選択の後に表示される追加の質問項目を設定できます
            </p>
          </div>
          <button
            onClick={() => {
              const currentFields = form.config?.custom_fields || [];
              const newField = {
                id: Math.random().toString(36).substr(2, 9),
                type: 'text' as const,
                title: '新しい項目',
                required: false
              };
              const updatedForm = {
                ...form,
                config: {
                  ...form.config,
                  custom_fields: [...currentFields, newField]
                }
              };
              onUpdate(updatedForm);
            }}
            className={`px-3 py-1.5 rounded-md text-sm flex items-center space-x-1 ${themeClasses.button.primary}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>項目を追加</span>
          </button>
        </div>

        <div className="space-y-3">
          {(form.config?.custom_fields || []).map((field, index) => (
            <div key={field.id} className={`${themeClasses.card} border rounded-lg p-3`}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center space-x-2 flex-1">
                  <span className={`${themeClasses.badge} px-2 py-1 rounded text-xs`}>
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={field.title}
                    onChange={(e) => {
                      const currentFields = [...(form.config?.custom_fields || [])];
                      currentFields[index] = { ...currentFields[index], title: e.target.value };
                      const updatedForm = {
                        ...form,
                        config: {
                          ...form.config,
                          custom_fields: currentFields
                        }
                      };
                      onUpdate(updatedForm);
                    }}
                    className={`flex-1 ${themeClasses.input} text-sm`}
                    placeholder="項目名"
                  />
                </div>
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={() => {
                      if (index > 0) {
                        const currentFields = [...(form.config?.custom_fields || [])];
                        [currentFields[index - 1], currentFields[index]] = [currentFields[index], currentFields[index - 1]];
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            custom_fields: currentFields
                          }
                        };
                        onUpdate(updatedForm);
                      }
                    }}
                    disabled={index === 0}
                    className={`${themeClasses.text.secondary} hover:${themeClasses.text.primary} disabled:opacity-30`}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => {
                      if (index < (form.config?.custom_fields || []).length - 1) {
                        const currentFields = [...(form.config?.custom_fields || [])];
                        [currentFields[index], currentFields[index + 1]] = [currentFields[index + 1], currentFields[index]];
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            custom_fields: currentFields
                          }
                        };
                        onUpdate(updatedForm);
                      }
                    }}
                    disabled={index === (form.config?.custom_fields || []).length - 1}
                    className={`${themeClasses.text.secondary} hover:${themeClasses.text.primary} disabled:opacity-30`}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('この項目を削除してもよろしいですか？')) {
                        const currentFields = [...(form.config?.custom_fields || [])];
                        currentFields.splice(index, 1);
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            custom_fields: currentFields
                          }
                        };
                        onUpdate(updatedForm);
                      }
                    }}
                    className={`text-red-400 hover:text-red-300 ml-2`}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`block text-xs ${themeClasses.text.secondary} mb-1`}>回答タイプ</label>
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const currentFields = [...(form.config?.custom_fields || [])];
                      const newType = e.target.value as 'text' | 'textarea' | 'radio' | 'checkbox';
                      currentFields[index] = {
                        ...currentFields[index],
                        type: newType,
                        options: (newType === 'radio' || newType === 'checkbox') ? (currentFields[index].options || [{ label: '', value: '' }]) : undefined
                      };
                      const updatedForm = {
                        ...form,
                        config: {
                          ...form.config,
                          custom_fields: currentFields
                        }
                      };
                      onUpdate(updatedForm);
                    }}
                    className={`w-full ${themeClasses.input} text-sm`}
                  >
                    <option value="text">テキスト入力 (1行)</option>
                    <option value="textarea">テキスト入力 (複数行)</option>
                    <option value="radio">単一選択 (ボタン)</option>
                    <option value="checkbox">複数選択 (ボタン)</option>
                  </select>
                </div>
                <div className="flex items-center mt-6">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => {
                        const currentFields = [...(form.config?.custom_fields || [])];
                        currentFields[index] = { ...currentFields[index], required: e.target.checked };
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            custom_fields: currentFields
                          }
                        };
                        onUpdate(updatedForm);
                      }}
                      className={`h-4 w-4 text-blue-600 focus:ring-blue-500 rounded ${
                        theme === 'light' 
                          ? 'bg-gray-100 border-gray-300' 
                          : 'bg-gray-700 border-gray-600'
                      }`}
                    />
                    <span className={`text-sm ${themeClasses.text.secondary}`}>必須項目にする</span>
                  </label>
                </div>
              </div>

              {(field.type === 'text' || field.type === 'textarea') && (
                <div className="mb-3">
                  <label className={`block text-xs ${themeClasses.text.secondary} mb-1`}>プレースホルダー（任意）</label>
                  <input
                    type="text"
                    value={field.placeholder || ''}
                    onChange={(e) => {
                      const currentFields = [...(form.config?.custom_fields || [])];
                      currentFields[index] = { ...currentFields[index], placeholder: e.target.value };
                      const updatedForm = {
                        ...form,
                        config: {
                          ...form.config,
                          custom_fields: currentFields
                        }
                      };
                      onUpdate(updatedForm);
                    }}
                    className={`w-full ${themeClasses.input} text-sm`}
                    placeholder="例: ご希望の時間帯を入力してください"
                  />
                </div>
              )}

              {(field.type === 'radio' || field.type === 'checkbox') && (
                <div className={`${theme === 'light' ? 'bg-gray-50' : 'bg-gray-900/50'} p-3 rounded border ${theme === 'light' ? 'border-gray-200' : 'border-gray-700'}`}>
                  <label className={`block text-xs ${themeClasses.text.secondary} mb-2`}>選択肢</label>
                  <div className="space-y-2">
                    {(field.options || []).map((opt, optIndex) => (
                      <div key={optIndex} className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const currentFields = [...(form.config?.custom_fields || [])];
                            const newOptions = [...(currentFields[index].options || [])];
                            newOptions[optIndex] = { label: e.target.value, value: e.target.value };
                            currentFields[index] = { ...currentFields[index], options: newOptions };
                            const updatedForm = {
                              ...form,
                              config: {
                                ...form.config,
                                custom_fields: currentFields
                              }
                            };
                            onUpdate(updatedForm);
                          }}
                          className={`flex-1 ${themeClasses.input} text-sm`}
                          placeholder={`選択肢 ${optIndex + 1}`}
                        />
                        <button
                          onClick={() => {
                            const currentFields = [...(form.config?.custom_fields || [])];
                            const newOptions = [...(currentFields[index].options || [])];
                            newOptions.splice(optIndex, 1);
                            currentFields[index] = { ...currentFields[index], options: newOptions };
                            const updatedForm = {
                              ...form,
                              config: {
                                ...form.config,
                                custom_fields: currentFields
                              }
                            };
                            onUpdate(updatedForm);
                          }}
                          className={`text-red-400 hover:text-red-300`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const currentFields = [...(form.config?.custom_fields || [])];
                        const newOptions = [...(currentFields[index].options || [])];
                        newOptions.push({ label: '', value: '' });
                        currentFields[index] = { ...currentFields[index], options: newOptions };
                        const updatedForm = {
                          ...form,
                          config: {
                            ...form.config,
                            custom_fields: currentFields
                          }
                        };
                        onUpdate(updatedForm);
                      }}
                      className={`text-sm ${theme === 'light' ? 'text-cyan-600 hover:text-cyan-700' : 'text-cyan-400 hover:text-cyan-300'}`}
                    >
                      + 選択肢を追加
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {(!form.config?.custom_fields || form.config.custom_fields.length === 0) && (
            <p className={`text-sm ${themeClasses.text.tertiary} text-center py-4`}>
              カスタムフィールドがありません。「項目を追加」ボタンで追加してください。
            </p>
          )}
        </div>
      </div>
          </div>
        )}
      </div>

      {/* カテゴリー・メニューセクション */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg className={`w-4 h-4 ${themeClasses.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            <span className={`text-sm font-semibold ${themeClasses.text.primary}`}>カテゴリー・メニュー</span>
            <span className={`text-xs ${themeClasses.text.tertiary}`}>{categories.length}カテゴリー</span>
          </div>
          <button
            onClick={handleOpenAddCategory}
            className={`px-3 py-1.5 text-sm rounded-md flex items-center space-x-1 ${themeClasses.button.primary}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>カテゴリー追加</span>
          </button>
        </div>
      </div>

      {/* カテゴリーアコーディオン */}
      <div className="space-y-3">
        {categories.map((category) => {
          const isOpen = openCategories.has(category.id);
          return (
            <div key={category.id} className={`${themeClasses.card} rounded-lg overflow-hidden`}>
              {/* カテゴリーヘッダー */}
              <div
                className={`flex items-center justify-between p-4 cursor-pointer ${theme === 'light' ? 'hover:bg-gray-50' : 'hover:bg-gray-700/50'}`}
                onClick={() => toggleCategory(category.id)}
              >
                <div className="flex items-center space-x-2 flex-1 min-w-0">
                  <span className={`text-xs ${themeClasses.text.secondary}`}>{isOpen ? '▼' : '▶'}</span>
                  <h4 className={`font-medium ${themeClasses.text.primary} truncate`}>{category.name}</h4>
                  {category.display_name && category.display_name !== category.name && (
                    <span className={`text-xs ${themeClasses.text.secondary} truncate`}>（{category.display_name}）</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${themeClasses.badge.cyan} flex-shrink-0`}>
                    {category.menus.length}メニュー
                  </span>
                  {(category.options || []).length > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${themeClasses.badge.cyan} flex-shrink-0`}>
                      {category.options.length}オプション
                    </span>
                  )}
                </div>
                <div className="flex space-x-1 ml-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleOpenEditCategory(category)}
                    className={`p-1.5 rounded text-cyan-400 hover:text-cyan-300 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                    title="カテゴリー編集"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {categories.length > 1 && (
                    <button
                      onClick={() => handleDeleteCategory(category.id)}
                      className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'}`}
                      title="カテゴリー削除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* カテゴリーボディ */}
              {isOpen && (
                <div className={`p-4 border-t ${themeClasses.divider} space-y-4`}>
                  {/* メニュー一覧 */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h5 className={`text-sm font-medium ${themeClasses.text.primary}`}>メニュー</h5>
                      <button
                        onClick={() => handleAddMenuItem(category.id)}
                        className={`px-2 py-1 text-xs rounded-md flex items-center space-x-1 ${themeClasses.button.primary}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>メニュー追加</span>
                      </button>
                    </div>
                    {category.menus.length === 0 ? (
                      <p className={`text-xs text-center py-3 rounded ${themeClasses.emptyState}`}>まだメニューがありません</p>
                    ) : (
                      <div className="space-y-2">
                        {category.menus.map(menu => (
                          <div key={menu.id} className={`flex items-center justify-between p-3 rounded-md ${themeClasses.highlight}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 flex-wrap gap-1">
                                <span className={`font-medium text-sm ${themeClasses.text.primary}`}>{menu.name}</span>
                                {menu.has_submenu && <span className={`text-xs px-1 py-0.5 rounded ${themeClasses.badge.cyan}`}>サブメニュー</span>}
                                {menu.options && menu.options.length > 0 && <span className={`text-xs px-1 py-0.5 rounded ${themeClasses.badge.cyan}`}>{menu.options.length}オプション</span>}
                              </div>
                              <p className={`text-xs ${themeClasses.text.secondary} mt-0.5`}>
                                {menu.has_submenu && menu.sub_menu_items?.length
                                  ? `${menu.sub_menu_items.length}サブメニュー`
                                  : `${(menu.price || 0) > 0 ? `¥${(menu.price || 0).toLocaleString()}` : '価格未設定'} • ${menu.duration || 0}分`}
                              </p>
                            </div>
                            <div className="flex space-x-1 ml-2">
                              <button onClick={() => handleEditMenuItem(category.id, menu)} className={`p-1.5 rounded text-cyan-400 hover:text-cyan-300 ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                              <button onClick={() => handleDeleteMenuItem(category.id, menu.id)} className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* カテゴリー共通オプション */}
                  <div className={`pt-3 border-t ${themeClasses.divider}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h5 className={`text-sm font-medium ${themeClasses.text.primary}`}>カテゴリー共通オプション</h5>
                        <p className={`text-xs ${themeClasses.text.secondary}`}>このカテゴリー全体で選択できるオプション（眉カット、保湿パックなど）</p>
                      </div>
                      <button
                        onClick={() => handleAddCatOpt(category.id)}
                        className={`px-2 py-1 text-xs rounded-md flex items-center space-x-1 ${themeClasses.button.primary}`}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span>オプション追加</span>
                      </button>
                    </div>
                    {(category.options || []).length === 0 ? (
                      <p className={`text-xs text-center py-3 rounded ${themeClasses.emptyState}`}>カテゴリー共通オプションなし</p>
                    ) : (
                      <div className="space-y-2">
                        {(category.options || []).map(opt => (
                          <div key={opt.id} className={`flex items-center justify-between p-2 rounded-md ${themeClasses.highlight}`}>
                            <div>
                              <span className={`text-sm ${themeClasses.text.primary}`}>{opt.name}</span>
                              <p className={`text-xs ${themeClasses.text.secondary}`}>
                                {(opt.price || 0) > 0 ? `¥${(opt.price || 0).toLocaleString()}` : '無料'} • {(opt.duration || 0) > 0 ? `${opt.duration}分` : '-'}
                              </p>
                            </div>
                            <div className="flex space-x-1">
                              <button onClick={() => handleEditCatOpt(category.id, opt)} className={`p-1.5 rounded text-cyan-400 hover:text-cyan-300 ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                              <button onClick={() => handleDeleteCatOpt(category.id, opt.id)} className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* カテゴリー名入力モーダル */}
      {categoryModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`w-full max-w-md mx-4 p-6 rounded-lg shadow-xl ${theme === 'light' ? 'bg-white' : 'bg-gray-800'}`}>
            <h3 className={`text-lg font-semibold mb-4 ${themeClasses.text.primary}`}>
              {editingCategory ? 'カテゴリーを編集' : 'カテゴリーを追加'}
            </h3>
            <div className="space-y-3 mb-6">
              <div>
                <label className={`block text-sm ${themeClasses.label} mb-1`}>カテゴリー名 <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={catName}
                  onChange={e => setCatName(e.target.value)}
                  placeholder="例：ブライダルコース"
                  className={themeClasses.input}
                  autoFocus
                />
              </div>
              <div>
                <label className={`block text-sm ${themeClasses.label} mb-1`}>表示名（省略時はカテゴリー名と同じ）</label>
                <input
                  type="text"
                  value={catDisplayName}
                  onChange={e => setCatDisplayName(e.target.value)}
                  placeholder="例：◆ブライダルコース◆"
                  className={themeClasses.input}
                />
              </div>
            </div>
            <div className="flex space-x-3 justify-end">
              <button onClick={() => { setCategoryModalOpen(false); setEditingCategory(null); }} className={`px-4 py-2 rounded-md text-sm ${themeClasses.button.secondary}`}>
                キャンセル
              </button>
              <button onClick={handleSaveCategory} disabled={!catName.trim()} className={`px-4 py-2 rounded-md text-sm ${themeClasses.button.primary} disabled:opacity-50`}>
                {editingCategory ? '更新' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* メニューアイテムモーダル */}
      <MenuItemModal
        key={`menu-${activeMenuCategoryId}-${selectedMenuItem?.id || 'new'}`}
        isOpen={menuModalOpen}
        onClose={() => setMenuModalOpen(false)}
        onSave={handleSaveMenuItem}
        menuItem={selectedMenuItem}
        categoryId={activeMenuCategoryId}
        genderEnabled={form.config?.gender_selection?.enabled || false}
        theme={theme}
        form={form}
      />

      {/* カテゴリー共通オプションモーダル（MenuItemModalを流用） */}
      <MenuItemModal
        key={`catopt-${activeCatOptCategoryId}-${editingCatOpt?.id || 'new'}`}
        isOpen={catOptModalOpen}
        onClose={() => setCatOptModalOpen(false)}
        onSave={handleSaveCatOpt}
        menuItem={editingCatOpt}
        categoryId={activeCatOptCategoryId}
        genderEnabled={false}
        theme={theme}
        form={form}
      />
    </div>
  );
};

export default MenuStructureEditor;
