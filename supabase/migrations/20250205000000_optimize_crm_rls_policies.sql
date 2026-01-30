-- ==========================================
-- Optimize CRM RLS Policies for Performance
-- 2025-02-05: Fix auth.uid() performance issues in RLS policies
-- ==========================================
--
-- Problem: auth.uid() is re-evaluated for each row in RLS policies
-- Solution: Use (select auth.uid()) to evaluate once per query
-- Reference: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- ==========================================
-- 1. customers テーブル RLS 最適化
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "store_admin_customers_select" ON customers;
DROP POLICY IF EXISTS "store_admin_customers_insert" ON customers;
DROP POLICY IF EXISTS "store_admin_customers_update" ON customers;
DROP POLICY IF EXISTS "store_admin_customers_delete" ON customers;

-- Recreate with optimized auth.uid() calls
CREATE POLICY "store_admin_customers_select" ON customers
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customers_insert" ON customers
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customers_update" ON customers
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customers_delete" ON customers
  FOR DELETE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

-- ==========================================
-- 2. customer_visits テーブル RLS 最適化
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "store_admin_customer_visits_select" ON customer_visits;
DROP POLICY IF EXISTS "store_admin_customer_visits_insert" ON customer_visits;
DROP POLICY IF EXISTS "store_admin_customer_visits_update" ON customer_visits;

-- Recreate with optimized auth.uid() calls
CREATE POLICY "store_admin_customer_visits_select" ON customer_visits
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customer_visits_insert" ON customer_visits
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customer_visits_update" ON customer_visits
  FOR UPDATE
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

-- ==========================================
-- 3. customer_interactions テーブル RLS 最適化
-- ==========================================

-- Drop existing policies
DROP POLICY IF EXISTS "store_admin_customer_interactions_select" ON customer_interactions;
DROP POLICY IF EXISTS "store_admin_customer_interactions_insert" ON customer_interactions;

-- Recreate with optimized auth.uid() calls
CREATE POLICY "store_admin_customer_interactions_select" ON customer_interactions
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

CREATE POLICY "store_admin_customer_interactions_insert" ON customer_interactions
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT store_id FROM store_admins WHERE user_id = (select auth.uid())
    )
  );

-- ==========================================
-- 完了
-- ==========================================
--
-- This migration optimizes 9 RLS policies across 3 CRM tables:
-- - customers: 4 policies (select, insert, update, delete)
-- - customer_visits: 3 policies (select, insert, update)
-- - customer_interactions: 2 policies (select, insert)
--
-- Performance improvement: auth.uid() is now evaluated once per query
-- instead of once per row, significantly improving query performance at scale.
