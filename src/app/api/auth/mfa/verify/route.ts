import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient } from '@/lib/supabase';
import { isLocal } from '@/lib/env';

/**
 * POST /api/auth/mfa/verify
 * MFA有効化時の検証コードを確認
 */
export async function POST(req: NextRequest) {
  try {
    if (isLocal()) {
      return NextResponse.json({ 
        error: 'ローカル環境ではMFA検証できません' 
      }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createAuthenticatedClient(token);
    
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase クライアント作成に失敗しました' }, { status: 500 });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json({ error: '無効なトークンです' }, { status: 401 });
    }

    const body = await req.json();
    const { factorId, code } = body;

    if (!factorId || !code) {
      return NextResponse.json({ error: 'factorIdとcodeが必要です' }, { status: 400 });
    }

    // チャレンジ作成（TOTPの場合）
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (challengeError || !challengeData) {
      return NextResponse.json({ 
        error: challengeError?.message || 'MFAチャレンジの作成に失敗しました' 
      }, { status: 500 });
    }

    // コード検証
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });

    if (verifyError) {
      return NextResponse.json({ 
        error: verifyError.message || '認証コードが正しくありません' 
      }, { status: 400 });
    }

    // セッションをリフレッシュ
    await supabase.auth.refreshSession();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('MFA検証エラー:', error);
    return NextResponse.json({ error: 'MFA検証に失敗しました' }, { status: 500 });
  }
}

