'use client';

import React from 'react';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';

export type TabId = 'basic' | 'menu' | 'business';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  visible: boolean;
}

interface FormEditorTabsProps {
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
  userRole: 'service_admin' | 'store_admin';
  theme?: ThemeType;
}

const FormEditorTabs: React.FC<FormEditorTabsProps> = ({
  activeTab,
  onTabChange,
  theme = 'dark'
}) => {
  const themeClasses = getThemeClasses(theme);

  const tabs: Tab[] = [
    {
      id: 'basic',
      label: '基本情報',
      icon: '📋',
      visible: true // 全員（ただし、一部フィールドはサービス管理者のみ）
    },
    {
      id: 'menu',
      label: 'メニュー構成',
      icon: '🍽️',
      visible: true // 全員
    },
    {
      id: 'business',
      label: '営業時間・ルール',
      icon: '🕒',
      visible: true // 全員
    }
  ];

  const visibleTabs = tabs.filter(tab => tab.visible);

  return (
    <div className={`flex border-b ${themeClasses.divider}`}>
      {visibleTabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex items-center space-x-2 px-6 py-3 text-sm font-medium transition-colors
            ${activeTab === tab.id
              ? theme === 'dark'
                ? 'border-b-2 border-cyan-500 text-cyan-400'
                : 'border-b-2 border-[rgb(244,144,49)] text-[rgb(244,144,49)]'
              : theme === 'dark'
                ? 'text-gray-400 hover:text-gray-300'
                : 'text-gray-600 hover:text-gray-900'
            }
          `}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
};

export default FormEditorTabs;
