-- Storage アップロードポリシーを店舗分離対応に更新
-- 認証済み全ユーザーが任意パスに書き込める問題を修正
-- store_id に対する store_admins チェックを追加

DROP POLICY IF EXISTS "Authenticated users can upload to forms bucket" ON storage.objects;
DROP POLICY IF EXISTS "Store admins can upload to their own store path" ON storage.objects;

CREATE POLICY "Store admins can upload to their own store path"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'forms'
    AND EXISTS (
      SELECT 1 FROM public.store_admins
      WHERE store_id = (storage.foldername(name))[2]
        AND user_id = (SELECT auth.uid())
    )
  );
