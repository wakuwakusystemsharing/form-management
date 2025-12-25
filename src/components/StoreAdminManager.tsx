'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Search, UserPlus } from 'lucide-react';

interface StoreAdmin {
  id: string;
  user_id: string;
  store_id: string;
  role: 'admin' | 'staff';
  email: string | null;
  created_at: string;
  updated_at: string;
}

interface StoreAdminManagerProps {
  storeId: string;
}

export default function StoreAdminManager({ storeId }: StoreAdminManagerProps) {
  const [admins, setAdmins] = useState<StoreAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'admin' | 'staff'>('admin');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/stores/${storeId}/admins`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setAdmins(data);
      } else {
        toast({
          title: 'エラー',
          description: '店舗管理者の取得に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to fetch admins:', error);
      toast({
        title: 'エラー',
        description: '店舗管理者の取得に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim()) {
      toast({
        title: 'エラー',
        description: 'メールアドレスを入力してください',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsAdding(true);
      const response = await fetch(`/api/stores/${storeId}/admins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: newAdminEmail.trim(),
          role: newAdminRole,
        }),
      });

      if (response.ok) {
        const newAdmin = await response.json();
        setAdmins([...admins, newAdmin]);
        setNewAdminEmail('');
        setNewAdminRole('admin');
        setShowAddDialog(false);
        toast({
          title: '追加しました',
          description: '店舗管理者を追加しました',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '店舗管理者の追加に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to add admin:', error);
      toast({
        title: 'エラー',
        description: '店舗管理者の追加に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteAdmin = async (userId: string) => {
    if (!confirm('この店舗管理者を削除しますか？')) {
      return;
    }

    try {
      setDeletingId(userId);
      const response = await fetch(`/api/stores/${storeId}/admins/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setAdmins(admins.filter(a => a.user_id !== userId));
        toast({
          title: '削除しました',
          description: '店舗管理者を削除しました',
        });
      } else {
        const error = await response.json();
        toast({
          title: 'エラー',
          description: error.error || '店舗管理者の削除に失敗しました',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to delete admin:', error);
      toast({
        title: 'エラー',
        description: '店舗管理者の削除に失敗しました',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>店舗管理者管理</CardTitle>
            <CardDescription>この店舗にアクセスできるユーザーを管理します</CardDescription>
          </div>
          <Button onClick={() => setShowAddDialog(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            ユーザー追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            読み込み中...
          </div>
        ) : admins.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-4">まだ店舗管理者が登録されていません</p>
            <Button onClick={() => setShowAddDialog(true)} variant="outline">
              <UserPlus className="mr-2 h-4 w-4" />
              最初のユーザーを追加
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>メールアドレス</TableHead>
                  <TableHead>権限</TableHead>
                  <TableHead>登録日</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">
                      {admin.email || 'メールアドレス不明'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={admin.role === 'admin' ? 'default' : 'secondary'}>
                        {admin.role === 'admin' ? '管理者' : 'スタッフ'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(admin.created_at).toLocaleDateString('ja-JP')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAdmin(admin.user_id)}
                        disabled={deletingId === admin.user_id}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* ユーザー追加ダイアログ */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>店舗管理者を追加</DialogTitle>
            <DialogDescription>
              メールアドレスでユーザーを検索して追加します。ユーザーは先にSupabase Authで作成されている必要があります。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">権限</Label>
              <Select value={newAdminRole} onValueChange={(v) => setNewAdminRole(v as 'admin' | 'staff')}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理者</SelectItem>
                  <SelectItem value="staff">スタッフ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              キャンセル
            </Button>
            <Button onClick={handleAddAdmin} disabled={isAdding}>
              {isAdding ? '追加中...' : '追加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

