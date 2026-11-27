# Supabase Multi-Tenant SaaS Setup Guide

## 1. Environment Variables
Set these variables in `.env` (local development) and Vercel Project Environment Variables (production):

- `VITE_SUPABASE_URL` — Supabase Project URL (`https://<ref>.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` — Supabase Publishable / Anon Key (safe for browser bundle)
- `SUPABASE_URL` — Supabase Project URL (server-side; also used by production rate limiting)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Service Role Key (**server-side only**, required for tenant operations & `consume_rate_limit` RPC; never expose in `VITE_*` variables)
- `GROQ_API_KEY` — Existing Groq Cloud API Key (optional `GROQ_API_KEY_2` for rotation)
- `APP_URL` — Deployed origin URL (used for auth redirect / password recovery links)
- `RATE_LIMIT_MAX_PER_MIN` — Maximum requests per minute per client/tenant bucket (default `60`, minimum `5`). In production (`NODE_ENV=production` or `VERCEL_ENV=production`), `MemoryRateLimitStore` is rejected and requests fail closed with HTTP `503` if Supabase rate limiting is unavailable.

## 2. Database & Storage Migrations
Run the SQL migration files in order via Supabase Dashboard -> SQL Editor (or `supabase db push`):

1. `supabase/migrations/001_multi_tenant_schema.sql` — Creates `companies`, `user_profiles`, `company_memberships`, `courses`, `course_versions`, `templates`, `source_documents`, `course_approvals`, `ai_usage_records`, `audit_logs`, indexes, helper functions, and strict Row Level Security (RLS) policies.
2. `supabase/migrations/002_storage_policies.sql` — Provisions the private `course-sources` Storage bucket and company-isolated storage policies.
3. `supabase/migrations/003_company_logos_storage.sql` — Provisions the public-read, company-admin-write `company-logos` Storage bucket (2 MB cap, PNG/JPEG/WebP only) and company-scoped policies.
4. `supabase/migrations/004_rate_limits.sql` — Creates `public.api_rate_limits` and the `public.consume_rate_limit(p_key, p_max_requests, p_window_ms)` PostgreSQL RPC required for shared production rate limiting (`service_role` execute only).
5. `supabase/migrations/005_governance_hardening.sql` — Adds `governance_roles` on `company_memberships`, active governance approval uniqueness / three-person rule indexes on `course_approvals`, and aligned source-management RLS policies.

## 3. Supabase Auth URL Configuration
In **Supabase Dashboard -> Authentication -> URL Configuration**:
- Set **Site URL** to your deployed domain (e.g. `https://your-app.vercel.app` or `http://localhost:3000`).
- Add Redirect URLs for password reset & email confirmation (`https://your-app.vercel.app/**` and `http://localhost:3000/**`).
