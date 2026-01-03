'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Save, Loader2 } from 'lucide-react';
import type { SalonBoardCredentials, SalonBoardCredentialsInput } from '@/types/salon-board';

interface CredentialsFormProps {
  storeId: string;
  credentials: SalonBoardCredentials | null;
  onSave: (input: SalonBoardCredentialsInput) => Promise<void>;
  isLoading?: boolean;
}

export function CredentialsForm({
  storeId,
  credentials,
  onSave,
  isLoading = false,
}: CredentialsFormProps) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [hotpepperId, setHotpepperId] = useState(credentials?.hotpepper_salon_id || '');
  const [salonBoardId, setSalonBoardId] = useState(credentials?.salon_board_salon_id || '');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!loginId && !credentials) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        login_id: loginId || undefined as unknown as string,
        password: password || undefined as unknown as string,
        hotpepper_salon_id: hotpepperId || undefined,
        salon_board_salon_id: salonBoardId || undefined,
      });
      // 成功後、パスワードフィールドをクリア
      setLoginId('');
      setPassword('');
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = !!credentials;

  return (
    <Card>
      <CardHeader>
        <CardTitle>認証情報</CardTitle>
        <CardDescription>
          {isEditing
            ? 'サロンボードのログイン情報を更新できます。パスワードを変更する場合のみ入力してください。'
            : 'サロンボードのログイン情報を入力してください。'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="loginId">ログインID</Label>
              <Input
                id="loginId"
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder={isEditing ? '変更する場合のみ入力' : 'ログインIDを入力'}
                required={!isEditing}
                disabled={isLoading || isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEditing ? '変更する場合のみ入力' : 'パスワードを入力'}
                  required={!isEditing}
                  disabled={isLoading || isSaving}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading || isSaving}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="salonBoardId">サロンボードID（任意）</Label>
              <Input
                id="salonBoardId"
                type="text"
                value={salonBoardId}
                onChange={(e) => setSalonBoardId(e.target.value)}
                placeholder="サロンボード上のID"
                disabled={isLoading || isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hotpepperId">ホットペッパーID（任意）</Label>
              <Input
                id="hotpepperId"
                type="text"
                value={hotpepperId}
                onChange={(e) => setHotpepperId(e.target.value)}
                placeholder="H000000000 形式"
                disabled={isLoading || isSaving}
              />
              <p className="text-xs text-muted-foreground">
                ホットペッパー公開ページのURLに含まれるID
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {isEditing ? '更新' : '保存'}
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
