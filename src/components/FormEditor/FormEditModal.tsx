'use client';

import React, { useState } from 'react';
import { Form } from '@/types/form';
import { SurveyForm } from '@/types/survey';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import FormEditorTabs, { TabId } from './Reservation/FormEditorTabs';
import BasicInfoEditor from './Reservation/BasicInfoEditor';
import MenuStructureEditor from './Reservation/MenuStructureEditor';
import BusinessRulesEditor from './Reservation/BusinessRulesEditor';
import SurveyFormEditor from './Survey/SurveyFormEditor';
import { Eye, Save, Upload } from 'lucide-react';

interface FormEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: Form | SurveyForm;
  storeId: string;
  onSave: (form: Form | SurveyForm) => Promise<void>;
  theme?: 'light' | 'dark';
  userRole: 'service_admin' | 'store_admin';
}

const FormEditModal: React.FC<FormEditModalProps> = ({
  isOpen,
  onClose,
  form: initialForm,
  storeId,
  onSave,
  theme = 'light',
  userRole
}) => {
  const [editingForm, setEditingForm] = useState<Form | SurveyForm>(initialForm);
  const [activeTab, setActiveTab] = useState<TabId>(
    userRole === 'service_admin' ? 'basic' : 'menu'
  );
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // フォームが変更されたら状態を更新
  React.useEffect(() => {
    setEditingForm(initialForm);
  }, [initialForm]);

  const isSurvey = (form: Form | SurveyForm): form is SurveyForm => {
    return form.config && 'questions' in form.config;
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSave(editingForm);
      toast({
        title: '保存しました',
        description: 'フォームの変更を保存しました',
      });
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: '保存に失敗しました',
        description: error instanceof Error ? error.message : '不明なエラー',
        variant: 'destructive',
      });
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
      const endpoint = isSurvey(editingForm) 
        ? `/api/surveys/${editingForm.id}/deploy`
        : `/api/forms/${editingForm.id}/deploy`;

      const deployResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          storeId: storeId,
          formId: editingForm.id 
        }),
      });
      
      if (deployResponse.ok) {
        const result = await deployResponse.json();
        toast({
          title: '更新しました',
          description: `${result.environment === 'local' ? 'ローカル' : '本番環境'}にデプロイされました。`,
        });
      } else {
        const error = await deployResponse.json();
        toast({
          title: 'デプロイに失敗しました',
          description: error.error || '不明なエラー',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Deploy error:', error);
      toast({
        title: 'デプロイに失敗しました',
        description: 'エラーが発生しました',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreview = () => {
    const previewUrl = isSurvey(editingForm)
      ? `/preview/${storeId}/surveys/${editingForm.id}`
      : `/preview/${storeId}/forms/${editingForm.id}`;
    window.open(previewUrl, '_blank');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] p-0 flex flex-col sm:max-h-[90vh]">
        {/* モーダルヘッダー */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl">
                {isSurvey(editingForm) 
                  ? `${editingForm.config?.basic_info?.title || 'アンケートフォーム'} 編集`
                  : `${(editingForm as Form).config?.basic_info?.form_name || (editingForm as any).form_name || '予約フォーム'} 編集`}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={editingForm.status === 'active' ? 'default' : 'secondary'}>
                {editingForm.status === 'active' ? '公開中' : '非公開'}
              </Badge>
              {editingForm.draft_status === 'draft' && (
                <Badge variant="outline" className="text-orange-600 border-orange-600">
                  下書きあり
                </Badge>
              )}
            </div>
          </div>
          {/* プレビュー・更新ボタンをヘッダーの下に配置 */}
          <div className="flex items-center gap-2 mt-4">
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={isSaving}
              className="flex-1 sm:flex-initial"
            >
              <Eye className="mr-2 h-4 w-4" />
              プレビュー
            </Button>
            <Button
              onClick={handleSaveAndDeploy}
              disabled={isSaving}
              className="flex-1 sm:flex-initial bg-emerald-600 hover:bg-emerald-700"
            >
              <Upload className="mr-2 h-4 w-4" />
              {isSaving ? '更新中...' : '更新'}
            </Button>
          </div>
        </DialogHeader>

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {isSurvey(editingForm) ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <SurveyFormEditor
                form={editingForm}
                onUpdate={(updatedForm) => setEditingForm(updatedForm)}
              />
            </div>
          ) : (
            <>
              {/* 予約フォーム用タブ */}
              <div className="border-b px-4 sm:px-6">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="basic" className="text-xs sm:text-sm">基本情報</TabsTrigger>
                    <TabsTrigger value="menu" className="text-xs sm:text-sm">メニュー構成</TabsTrigger>
                    <TabsTrigger value="business" className="text-xs sm:text-sm">営業時間・ルール</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
                  <TabsContent value="basic" className="mt-0">
                    <BasicInfoEditor
                      form={editingForm as Form}
                      onUpdate={(updatedForm) => setEditingForm(updatedForm)}
                      theme={theme}
                      userRole={userRole}
                    />
                  </TabsContent>
                  <TabsContent value="menu" className="mt-0">
                    <MenuStructureEditor
                      form={editingForm as Form}
                      onUpdate={(updatedForm) => setEditingForm(updatedForm)}
                      theme={theme}
                    />
                  </TabsContent>
                  <TabsContent value="business" className="mt-0">
                    <BusinessRulesEditor
                      form={editingForm as Form}
                      onUpdate={(updatedForm) => setEditingForm(updatedForm)}
                      theme={theme}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </div>

        {/* モーダルフッター */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 p-4 sm:p-6 border-t">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full sm:w-auto"
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FormEditModal;
