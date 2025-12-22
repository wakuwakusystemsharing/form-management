import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient } from '@/lib/supabase';
import { isLocal } from '@/lib/env';

/**
 * GET /api/auth/mfa
 * 現在のユーザーのMFA設定を取得
 */
export async function GET(req: NextRequest) {
  try {
    if (isLocal()) {
      return NextResponse.json({ 
        factors: { totp: [], phone: [] },
        hasMFA: false 
      });
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

    // MFA設定を取得
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
    
    if (factorsError) {
      return NextResponse.json({ error: 'MFA設定の取得に失敗しました' }, { status: 500 });
    }

    const hasMFA = factorsData?.totp && factorsData.totp.length > 0;

    return NextResponse.json({ 
      factors: { totp: factorsData?.totp || [], phone: [] },
      hasMFA 
    });
  } catch (error) {
    console.error('MFA取得エラー:', error);
    return NextResponse.json({ error: 'MFA設定の取得に失敗しました' }, { status: 500 });
  }
}

/**
 * POST /api/auth/mfa
 * MFAを有効化（TOTP: QRコード生成、Phone: SMS送信）
 */
export async function POST(req: NextRequest) {
  try {
    if (isLocal()) {
      return NextResponse.json({ 
        error: 'ローカル環境ではMFAを有効化できません' 
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
    const { friendlyName } = body;

    // TOTPのみをサポート
    const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: friendlyName || `${user.email} - Authenticator`,
    });

    if (enrollError || !enrollData) {
      return NextResponse.json({ 
        error: enrollError?.message || 'MFAの有効化に失敗しました' 
      }, { status: 500 });
    }

    // TOTPの場合はQRコードを返す
    return NextResponse.json({ 
      factorId: enrollData.id,
      qrCode: enrollData.totp?.qr_code,
      secret: enrollData.totp?.secret,
    });
  } catch (error) {
    console.error('MFA有効化エラー:', error);
    return NextResponse.json({ error: 'MFAの有効化に失敗しました' }, { status: 500 });
  }
}

/**
 * DELETE /api/auth/mfa
 * MFAを無効化
 */
export async function DELETE(req: NextRequest) {
  try {
    if (isLocal()) {
      return NextResponse.json({ 
        error: 'ローカル環境ではMFAを無効化できません' 
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

    const { searchParams } = new URL(req.url);
    const factorId = searchParams.get('factorId');

    if (!factorId) {
      return NextResponse.json({ error: 'factorIdが必要です' }, { status: 400 });
    }

    // MFAを無効化
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({
      factorId,
    });

    if (unenrollError) {
      return NextResponse.json({ 
        error: unenrollError.message || 'MFAの無効化に失敗しました' 
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('MFA無効化エラー:', error);
    return NextResponse.json({ error: 'MFAの無効化に失敗しました' }, { status: 500 });
  }
}

