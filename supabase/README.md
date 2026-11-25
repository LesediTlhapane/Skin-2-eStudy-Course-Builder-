# Supabase Multi-Tenant SaaS Setup Guide

## 1. Environment Variables
Set these variables in `.env` (local development) and Vercel Project Environment Variables (production):

- `VITE_SUPABASE_URL` — Supabase Project URL (`https://<ref>.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` — Supabase Publishable / Anon Key (safe for browser bundle)
- `SUPABASE_URL` — Supabase Project URL (server-side)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Service Role Key (**server-side only**, never expose in `VITE_*` variables)
- `GROQ_API_KEY` — Existing Groq Cloud API Key (optional `GROQ_API_KEY_2` for rotation)
- `APP_URL` — Deployed origin URL (used for auth redirect / password recovery links)

## 2. Database & Storage Migrations
Run the SQL migration files in order via Supabase Dashboard -> SQL Editor (or `supabase db push`):

1. `supabase/migrations/001_multi_tenant_schema.sql` — Creates `companies`, `user_profiles`, `company_memberships`, `courses`, `course_versions`, `templates`, `source_documents`, `course_approvals`, `ai_usage_records`, `audit_logs`, indexes, helper functions, and strict Row Level Security (RLS) policies.
2. `supabase/migrations/002_storage_policies.sql` — Provisions the private `course-sources` Storage bucket and company-isolated storage policies.
3. `supabase/migrations/003_company_logos_storage.sql` — Provisions the public-read, company-admin-write `company-logos` Storage bucket (2 MB cap, PNG/JPEG/WebP only) and company-scoped policies.

## 3. Supabase Auth URL Configuration
In **Supabase Dashboard -> Authentication -> URL Configuration**:
- Set **Site URL** to your deployed domain (e.g. `https://your-app.vercel.app` or `http://localhost:3000`).
- Add Redirect URLs for password reset & email confirmation (`https://your-app.vercel.app/**` and `http://localhost:3000/**`).
