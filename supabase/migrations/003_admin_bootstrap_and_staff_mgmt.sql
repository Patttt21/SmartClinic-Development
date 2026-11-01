-- ============================================================================
-- SmartClinic Outpatient Healthcare Management System
-- Migration 003: Durable One-Time Initial Admin Bootstrap Lock & Staff Columns
-- ============================================================================
-- Run this migration in your Supabase SQL Editor AFTER 001_smartclinic_schema.sql
-- and 002_rls_policies.sql.
-- ============================================================================

-- Ensure clinical specialty is stored alongside staff_profiles for Admin Staff Management
ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT '';

-- Durable singleton lock table guaranteeing the initial System Administrator
-- bootstrap can execute AT MOST ONCE across all server instances and restarts.
CREATE TABLE IF NOT EXISTS public.system_bootstrap_lock (
  singleton_key TEXT PRIMARY KEY DEFAULT 'initial_admin'
    CHECK (singleton_key = 'initial_admin'),
  bootstrapped_admin_uid UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  bootstrapped_admin_email TEXT NOT NULL,
  bootstrap_disabled BOOLEAN NOT NULL DEFAULT TRUE CHECK (bootstrap_disabled = TRUE),
  bootstrapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strictly enable RLS with ZERO client policies so only the backend server
-- (authenticated via SUPABASE_SERVICE_ROLE_KEY) can read or write this table.
ALTER TABLE public.system_bootstrap_lock ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.system_bootstrap_lock FROM anon, authenticated;
