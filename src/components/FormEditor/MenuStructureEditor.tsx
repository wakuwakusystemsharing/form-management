'use client';

import React, { useState } from 'react';
import { Form, MenuCategory, MenuItem, MenuOption, SubMenuItem } from '@/types/form';
import { getThemeClasses, ThemeType } from './FormEditorTheme';

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
}

const SubMenuItemModal: React.FC<SubMenuItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  subMenuItem,
  theme = 'dark'
}) => {
  const themeClasses = getThemeClasses(theme);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');

  React.useEffect(() => {
    if (subMenuItem) {
      setName(subMenuItem.name);
      setPrice(subMenuItem.price.toString());
      setDuration(subMenuItem.duration.toString());
      setDescription(subMenuItem.description || '');
      setImage(subMenuItem.image || '');
    } else {
      setName('');
      setPrice('');
      setDuration('');
      setDescription('');
      setImage('');
    }
  }, [subMenuItem]);

  const handleSave = () => {
    const newSubMenuItem: SubMenuItem = {
      id: subMenuItem?.id || `submenu_${Date.now()}`,
      name,
      price: parseInt(price) || 0,
      duration: parseInt(duration) || 0,
      description: description || undefined,
      image: image || undefined
    };
    onSave(newSubMenuItem);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 ${themeClasses.modalOverlay}`}>
      <div className={`rounded-lg shadow-xl max-w-md w-full mx-4 ${themeClasses.modal}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-lg font-semibold ${themeClasses.text.primary}`}>
              {subMenuItem ? 'サブメニュー編集' : '新規サブメニュー追加'}
            </h3>
            <button
              onClick={onClose}
              className={`${themeClasses.text.secondary} ${theme === 'light' ? 'hover:text-gray-900' : 'hover:text-gray-300'} transition-colors`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                サブメニュー名
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={themeClasses.input}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                  料金（円）
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={themeClasses.input}
                />
              </div>
              <div>
                <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                  所要時間（分）
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={themeClasses.input}
                />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                説明（オプション）
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={themeClasses.textarea}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium ${themeClasses.text.secondary} mb-1`}>
                画像URL（オプション）
              </label>
              <input
                type="url"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className={themeClasses.input}
              />
              <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
                サブメニューの詳細表示で使用される画像のURLを入力してください
              </p>
              {image && (
                <div className="mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={image} 
                    alt="プレビュー" 
                    className={`w-32 h-32 object-cover rounded-md ${
                      theme === 'light' ? 'border border-gray-300' : 'border border-gray-600'
                    }`}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
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

  React.useEffect(() => {
    if (option) {
      setName(option.name);
      setPrice(option.price.toString());
      setDuration(option.duration.toString());
      setDescription(option.description || '');
      setIsDefault(option.is_default || false);
    } else {
      setName('');
      setPrice('');
      setDuration('');
      setDescription('');
      setIsDefault(false);
    }
  }, [option]);

  const handleSave = () => {
    const newOption: MenuOption = {
      id: option?.id || `option_${Date.now()}`,
      name,
      price: parseInt(price) || 0,
      duration: parseInt(duration) || 0,
      description: description || undefined,
      is_default: isDefault
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
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                />
              </div>
              <div>
                <label className={`block text-sm ${themeClasses.label} mb-1`}>
                  追加時間（分）
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                />
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
  theme = 'dark'
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

  React.useEffect(() => {
    if (isOpen) {
      if (menuItem) {
        setName(menuItem.name || '');
        setPrice(menuItem.price?.toString() || '');
        setDuration(menuItem.duration?.toString() || '');
        setDescription(menuItem.description || '');
        setImage(menuItem.image || '');
        setGenderFilter(menuItem.gender_filter || 'both');
        setOptions(menuItem.options || []);
        setHasSubmenu(menuItem.has_submenu || false);
        setSubMenuItems(menuItem.sub_menu_items || []);
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
      }
    }
  }, [menuItem, isOpen]);

  const handleSave = () => {
    const newMenuItem: MenuItem = {
      id: menuItem?.id || `menu_${Date.now()}`,
      name,
      price: hasSubmenu ? undefined : (parseInt(price) || 0),
      duration: hasSubmenu ? undefined : (parseInt(duration) || 0),
      description: description || undefined,
      image: image || undefined,
      category_id: categoryId,
      gender_filter: genderEnabled ? genderFilter : undefined,
      options: hasSubmenu ? undefined : (options.length > 0 ? options : undefined),
      has_submenu: hasSubmenu,
      sub_menu_items: hasSubmenu ? subMenuItems : undefined
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
    if (selectedSubMenuItem?.id) {
      setSubMenuItems(prev => prev.map(item => item.id === selectedSubMenuItem.id ? subMenuItem : item));
    } else {
      setSubMenuItems(prev => [...prev, subMenuItem]);
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
                          type="number"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                        />
                      </div>
                      <div>
                        <label className={`block text-sm ${themeClasses.label} mb-1`}>
                          所要時間（分）
                        </label>
                        <input
                          type="number"
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                        />
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

                {/* 画像URL */}
                <div>
                  <label className={`block text-sm ${themeClasses.label} mb-1`}>
                    画像URL（オプション）
                  </label>
                  <input
                    type="url"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className={`w-full px-3 py-2 rounded-md ${themeClasses.input}`}
                  />
                  <p className={`text-xs ${themeClasses.text.tertiary} mt-1`}>
                    メニューの詳細表示で使用される画像のURLを入力してください
                  </p>
                  {image && (
                    <div className="mt-2">
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
      />
    </>
  );
};

const MenuStructureEditor: React.FC<MenuStructureEditorProps> = ({ form, onUpdate, theme = 'dark' }) => {
  const themeClasses = getThemeClasses(theme);
  
  // カテゴリーなしで直接メニューを管理
  const [menus, setMenus] = useState<MenuItem[]>(() => {
    const allMenus: MenuItem[] = [];
    const menuStructure = form.config?.menu_structure;
    
    if (menuStructure?.categories && Array.isArray(menuStructure.categories)) {
      menuStructure.categories.forEach((category: MenuCategory) => {
        if (category.menus && Array.isArray(category.menus)) {
          allMenus.push(...category.menus);
        }
      });
    }
    
    return allMenus;
  });
  
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState<MenuItem | undefined>();

  const handleAddMenuItem = () => {
    setSelectedMenuItem(undefined);
    setMenuModalOpen(true);
  };

  const handleEditMenuItem = (menuItem: MenuItem) => {
    setSelectedMenuItem(menuItem);
    setMenuModalOpen(true);
  };

  const handleSaveMenuItem = (menuItem: MenuItem) => {
    const updatedMenus = selectedMenuItem?.id
      ? menus.map(menu => menu.id === selectedMenuItem.id ? menuItem : menu)
      : [...menus, menuItem];
    
    setMenus(updatedMenus);
    updateForm(updatedMenus);
  };

  const handleDeleteMenuItem = (menuItemId: string) => {
    if (window.confirm('このメニューを削除しますか？')) {
      const updatedMenus = menus.filter(menu => menu.id !== menuItemId);
      setMenus(updatedMenus);
      updateForm(updatedMenus);
    }
  };

  const updateForm = (updatedMenus: MenuItem[]) => {
    const defaultCategory: MenuCategory = {
      id: 'default',
      name: 'メニュー',
      display_name: 'メニュー',
      menus: updatedMenus,
      options: [],
      selection_mode: 'single',
      gender_condition: 'all'
    };

    const updatedForm: Form = {
      ...form,
      config: {
        ...form.config,
        menu_structure: {
          ...form.config?.menu_structure,
          categories: [defaultCategory],
          structure_type: 'category_based'
        }
      }
    };
    
    onUpdate(updatedForm);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className={`w-6 h-6 ${themeClasses.text.secondary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <h2 className={`text-xl font-semibold ${themeClasses.text.primary}`}>メニュー管理</h2>
        </div>
        <button
          onClick={handleAddMenuItem}
          className={`px-4 py-2 rounded-md flex items-center space-x-2 ${themeClasses.button.primary}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>メニュー追加</span>
        </button>
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

      {menus.length === 0 ? (
        <div className={`text-center py-12 ${themeClasses.card} rounded-lg`}>
          <svg className={`w-12 h-12 ${theme === 'light' ? 'text-gray-400' : 'text-gray-500'} mx-auto mb-4`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          <h3 className={`text-lg font-medium ${themeClasses.text.primary} mb-2`}>まだメニューがありません</h3>
          <p className={`${themeClasses.text.secondary} mb-4`}>「メニュー追加」ボタンから最初のメニューを作成してください</p>
        </div>
      ) : (
        <div className="space-y-4">
          {menus.map((menu) => (
            <div key={menu.id} className={`flex items-center justify-between p-4 ${themeClasses.card} rounded-lg ${
              theme === 'light' ? 'hover:border-gray-300' : 'hover:border-gray-600'
            } transition-colors`}>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <h5 className={`text-lg font-medium ${themeClasses.text.primary}`}>{menu.name}</h5>
                  {menu.gender_filter && menu.gender_filter !== 'both' && (
                    <span className={`px-2 py-1 text-xs rounded border ${
                      menu.gender_filter === 'male' 
                        ? 'bg-blue-900/30 text-blue-300 border-blue-700' 
                        : 'bg-pink-900/30 text-pink-300 border-pink-700'
                    }`}>
                      {menu.gender_filter === 'male' ? '男性専用' : '女性専用'}
                    </span>
                  )}
                  {menu.sub_menu_items && menu.sub_menu_items.length > 0 && (
                    <span className={themeClasses.badge.cyan}>
                      {menu.sub_menu_items.length}サブメニュー
                    </span>
                  )}
                  {menu.options && menu.options.length > 0 && (
                    <span className={themeClasses.badge.cyan}>
                      {menu.options.length}オプション
                    </span>
                  )}
                </div>
                <p className={`text-sm ${themeClasses.text.secondary} mb-1`}>
                  {menu.has_submenu && menu.sub_menu_items && menu.sub_menu_items.length > 0 ? (
                    // サブメニューがある場合は価格範囲を表示
                    (() => {
                      const prices = menu.sub_menu_items.map(sub => sub.price).filter(p => p > 0);
                      const durations = menu.sub_menu_items.map(sub => sub.duration).filter(d => d > 0);
                      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
                      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
                      const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
                      const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
                      
                      let priceText = '';
                      if (minPrice > 0 && maxPrice > 0) {
                        priceText = minPrice === maxPrice ? `¥${minPrice.toLocaleString()}` : `¥${minPrice.toLocaleString()}～¥${maxPrice.toLocaleString()}`;
                      }
                      
                      let durationText = '';
                      if (minDuration > 0 && maxDuration > 0) {
                        durationText = minDuration === maxDuration ? `${minDuration}分` : `${minDuration}～${maxDuration}分`;
                      }
                      
                      return [priceText, durationText].filter(Boolean).join(' • ');
                    })()
                  ) : (
                    `${menu.price ? `¥${menu.price.toLocaleString()}` : '価格未設定'} • ${menu.duration || 0}分`
                  )}
                </p>
                {menu.description && (
                  <p className={`text-sm ${theme === 'light' ? 'text-gray-600' : 'text-gray-500'} mb-2`}>{menu.description}</p>
                )}
                {menu.sub_menu_items && menu.sub_menu_items.length > 0 && (
                  <div className={`text-xs ${theme === 'light' ? 'text-gray-600' : 'text-gray-500'} mb-1`}>
                    サブメニュー: {menu.sub_menu_items.map(sub => sub.name).join(', ')}
                  </div>
                )}
                {menu.options && menu.options.length > 0 && (
                  <div className={`text-xs ${theme === 'light' ? 'text-gray-600' : 'text-gray-500'}`}>
                    オプション: {menu.options.map(opt => opt.name).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex space-x-2 ml-4">
                <button
                  onClick={() => handleEditMenuItem(menu)}
                  className={`p-2 text-cyan-400 hover:text-cyan-300 rounded-md transition-colors ${
                    theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteMenuItem(menu.id)}
                  className={`p-2 text-red-400 hover:text-red-300 rounded-md transition-colors ${
                    theme === 'light' ? 'hover:bg-gray-100' : 'hover:bg-gray-700'
                  }`}
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

      <MenuItemModal
        key={selectedMenuItem?.id || 'new'}
        isOpen={menuModalOpen}
        onClose={() => setMenuModalOpen(false)}
        onSave={handleSaveMenuItem}
        menuItem={selectedMenuItem}
        categoryId="default"
        genderEnabled={form.config?.gender_selection?.enabled || false}
        theme={theme}
      />
    </div>
  );
};

export default MenuStructureEditor;
