'use client';

import React from 'react';
import { Form } from '@/types/form';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface BasicInfoEditorProps {
  form: Form;
  onUpdate: (form: Form) => void;
  theme?: 'light' | 'dark';
  userRole?: 'service_admin' | 'store_admin';
}

 

const BasicInfoEditor: React.FC<BasicInfoEditorProps> = ({ 
  form, 
  onUpdate, 
  theme = 'light',
  userRole = 'service_admin'
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-6">
        <h2 className="text-xl font-semibold">基本情報</h2>
      </div>

      <div className="space-y-2">
        <Label htmlFor="form_name">
          フォーム名 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="form_name"
          type="text"
          value={(form as any).form_name || form.config?.basic_info?.form_name || ''}
          onChange={(e) => {
            if ((form as any).form_name !== undefined) {
              // 新形式
              onUpdate({
                ...form,
                form_name: e.target.value
              } as any);
            } else {
              // 旧形式
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    form_name: e.target.value
                  }
                }
              });
            }
          }}
          placeholder="例：ヘアサロン予約フォーム"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="store_name">
          店舗名 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="store_name"
          type="text"
          value={(form as any).store_name || form.config?.basic_info?.store_name || ''}
          onChange={(e) => {
            if ((form as any).store_name !== undefined) {
              // 新形式
              onUpdate({
                ...form,
                store_name: e.target.value
              } as any);
            } else {
              // 旧形式
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    store_name: e.target.value
                  }
                }
              });
            }
          }}
          placeholder="例：サロン ド ビューティー"
          required
        />
      </div>

      {/* システム管理者のみ表示 */}
      {userRole === 'service_admin' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="liff_id">LINE LIFF ID</Label>
            <Input
              id="liff_id"
              type="text"
              value={(form as any).liff_id || form.config?.basic_info?.liff_id || ''}
              onChange={(e) => {
                if ((form as any).liff_id !== undefined) {
                  // 新形式
                  onUpdate({
                    ...form,
                    liff_id: e.target.value
                  } as any);
                } else {
                  // 旧形式
                  onUpdate({
                    ...form,
                    config: {
                      ...form.config,
                      basic_info: {
                        ...form.config?.basic_info,
                        liff_id: e.target.value
                      }
                    }
                  });
                }
              }}
              placeholder="例：1234567890-abcdefgh"
            />
            <p className="text-xs text-muted-foreground">LINE Developersで作成したLIFF ID</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gas_endpoint">Google App Script エンドポイント</Label>
            <Input
              id="gas_endpoint"
              type="url"
              value={form.config?.gas_endpoint || ''}
              onChange={(e) => {
                onUpdate({
                  ...form,
                  config: {
                    ...form.config,
                    gas_endpoint: e.target.value
                  }
                });
              }}
              placeholder="例：https://script.google.com/macros/s/xxx/exec"
            />
            <p className="text-xs text-muted-foreground">カレンダー空き取得用のGASエンドポイント</p>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="theme_color">テーマカラー</Label>
        <div className="flex items-center space-x-3">
          <Input
            id="theme_color"
            type="color"
            value={form.config?.basic_info?.theme_color || '#3B82F6'}
            onChange={(e) => {
              onUpdate({
                ...form,
                config: {
                  ...form.config,
                  basic_info: {
                    ...form.config?.basic_info,
                    theme_color: e.target.value
                  }
                }
              });
            }}
            className="w-20 h-10 rounded-md cursor-pointer border"
          />
          <span className="text-sm text-muted-foreground">フォームのメインカラー</span>
        </div>
      </div>

      {/* システム管理者のみ表示 */}
      {userRole === 'service_admin' && (
        <div className="space-y-2">
          <Label htmlFor="status">公開ステータス</Label>
          <Select
            value={form.status}
            onValueChange={(value) => onUpdate({
              ...form,
              status: value as 'active' | 'inactive'
            })}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inactive">非公開（下書き）</SelectItem>
              <SelectItem value="active">公開中</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {form.status === 'active' ? '顧客がフォームにアクセス可能です' : 'フォームは非公開です（管理者のみ確認可能）'}
          </p>
        </div>
      )}
    </div>
  );
};

export default BasicInfoEditor;
