'use client';

import React, { useState } from 'react';
import { Form } from '@/types/form';
import { getThemeClasses, ThemeType } from './FormEditorTheme';
import FormEditorTabs, { TabId } from './FormEditorTabs';
import BasicInfoEditor from './BasicInfoEditor';
import MenuStructureEditor from './MenuStructureEditor';
import BusinessRulesEditor from './BusinessRulesEditor';

interface FormEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: Form;
  storeId: string;
  onSave: (form: Form) => Promise<void>;
  theme?: ThemeType;
  userRole: 'service_admin' | 'store_admin';
}

const FormEditModal: React.FC<FormEditModalProps> = ({
  isOpen,
  onClose,
  form: initialForm,
  storeId,
  onSave,
  theme = 'dark',
  userRole
}) => {
  const [editingForm, setEditingForm] = useState<Form>(initialForm);
  const [activeTab, setActiveTab] = useState<TabId>(
    userRole === 'service_admin' ? 'basic' : 'menu'
  );
  const [isSaving, setIsSaving] = useState(false);
  
  const themeClasses = getThemeClasses(theme);

  // フォームが変更されたら状態を更新
  React.useEffect(() => {
    setEditingForm(initialForm);
  }, [initialForm]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(editingForm);
      alert('保存しました！');
    } catch (error) {
      console.error('Save error:', error);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndDeploy = async () => {
    try {
      setIsSaving(true);
      
      // まず保存
      await onSave(editingForm);
      
      // 静的HTMLを再デプロイ
      const deployResponse = await fetch(`/api/forms/${editingForm.id}/deploy`, {
        method: 'POST',
      });
      
      if (deployResponse.ok) {
        alert('更新しました！');
      } else {
        alert('デプロイに失敗しました');
      }
    } catch (error) {
      console.error('Deploy error:', error);
      alert('デプロイに失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = () => {
    const previewUrl = `/form/${editingForm.id}?preview=true`;
    window.open(previewUrl, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 ${themeClasses.modalOverlay} flex items-center justify-center z-50`}>
      <div className={`${themeClasses.modal} rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* モーダルヘッダー */}
        <div className={`p-6 ${themeClasses.cardHeader}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-2xl font-bold ${themeClasses.text.primary}`}>
                フォーム編集
              </h2>
              <p className={`text-sm ${themeClasses.text.secondary} mt-1`}>
                {editingForm.config?.basic_info?.form_name}
              </p>
            </div>
            <button
              onClick={onClose}
              className={`${themeClasses.text.secondary} hover:${themeClasses.text.primary} transition-colors`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* タブナビゲーション */}
        <FormEditorTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userRole={userRole}
          theme={theme}
        />

        {/* タブコンテンツ */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' && (
            <BasicInfoEditor
              form={editingForm}
              onUpdate={setEditingForm}
              theme={theme}
              userRole={userRole}
            />
          )}

          {activeTab === 'menu' && (
            <MenuStructureEditor
              form={editingForm}
              onUpdate={setEditingForm}
              theme={theme}
            />
          )}

          {activeTab === 'business' && (
            <BusinessRulesEditor
              form={editingForm}
              onUpdate={setEditingForm}
              theme={theme}
            />
          )}
        </div>

        {/* モーダルフッター */}
        <div className={`flex items-center justify-between p-6 border-t ${themeClasses.divider}`}>
          <button
            onClick={onClose}
            disabled={isSaving}
            className={`px-4 py-2 rounded-md ${themeClasses.button.secondary}`}
          >
            キャンセル
          </button>
          <div className="flex items-center space-x-3">
            <button
              onClick={handlePreview}
              disabled={isSaving}
              className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              プレビュー
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`px-4 py-2 rounded-md ${themeClasses.button.primary} disabled:opacity-50`}
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleSaveAndDeploy}
              disabled={isSaving}
              className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {isSaving ? '更新中...' : '更新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FormEditModal;
