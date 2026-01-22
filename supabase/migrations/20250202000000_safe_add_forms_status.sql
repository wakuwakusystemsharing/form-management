-- ==========================================
-- Safe migration: Add status column to forms table
-- This migration safely handles cases where the table might not exist
-- ==========================================

-- Only proceed if the forms table exists
DO $$
BEGIN
    -- Check if forms table exists
    IF EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'forms'
    ) THEN
        -- Check if status column already exists
        IF NOT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'forms' 
            AND column_name = 'status'
        ) THEN
            -- Add status column if it doesn't exist
            ALTER TABLE forms 
            ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
            
            -- Add check constraint
            ALTER TABLE forms 
            ADD CONSTRAINT forms_status_check 
            CHECK (status IN ('active', 'inactive'));
        END IF;
    END IF;
END $$;
