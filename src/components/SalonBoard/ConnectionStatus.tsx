'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { SalonBoardCredentials } from '@/types/salon-board';

interface ConnectionStatusProps {
  credentials: SalonBoardCredentials | null;
  onTestConnection: () => Promise<boolean>;
  isLoading?: boolean;
}

const statusConfig = {
  pending: {
    label: '未確認',
    variant: 'secondary' as const,
    icon: Clock,
  },
  connected: {
    label: '接続済み',
    variant: 'default' as const,
    icon: CheckCircle,
  },
  failed: {
    label: '接続失敗',
    variant: 'destructive' as const,
    icon: XCircle,
  },
  expired: {
    label: '期限切れ',
    variant: 'outline' as const,
    icon: AlertCircle,
  },
};

export function ConnectionStatus({
  credentials,
  onTestConnection,
  isLoading = false,
}: ConnectionStatusProps) {
  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      await onTestConnection();
    } finally {
      setIsTesting(false);
    }
  };

  if (!credentials) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>接続状態</CardTitle>
          <CardDescription>認証情報を登録すると接続テストが可能になります</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Badge variant="secondary">
              <Clock className="mr-1 h-3 w-3" />
              未設定
            </Badge>
            <Button disabled>
              <RefreshCw className="mr-2 h-4 w-4" />
              接続テスト
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const status = credentials.connection_status;
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <Card>
      <CardHeader>
        <CardTitle>接続状態</CardTitle>
        <CardDescription>
          サロンボードへの接続状態を確認できます
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant={config.variant}>
              <StatusIcon className="mr-1 h-3 w-3" />
              {config.label}
            </Badge>
            {credentials.last_connection_test_at && (
              <span className="text-sm text-muted-foreground">
                最終確認: {new Date(credentials.last_connection_test_at).toLocaleString('ja-JP')}
              </span>
            )}
          </div>
          <Button
            onClick={handleTestConnection}
            disabled={isLoading || isTesting}
            variant={status === 'failed' ? 'destructive' : 'outline'}
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                テスト中...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                接続テスト
              </>
            )}
          </Button>
        </div>

        {credentials.last_connection_error && status === 'failed' && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">エラー詳細:</p>
            <p>{credentials.last_connection_error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
