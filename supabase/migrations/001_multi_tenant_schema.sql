-- ============================================================================
-- eStudy Master Course Builder V2 — Phase 1 Multi-Tenant SaaS Schema & RLS
-- ============================================================================
-- Run this migration against a PostgreSQL / Supabase database before enabling
-- multi-tenant SaaS endpoints and cloud persistence.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Core Tenant, Identity & Membership Tables
-- ----------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(trim(company_name)) >= 2),
  company_slug text not null unique check (company_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_url text,
  primary_colour text not null default '#052B66' check (primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_colour text not null default '#45CC42' check (secondary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  subscription_status text not null default 'trialing' check (
    subscription_status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null check (role in ('company_admin', 'author', 'reviewer', 'viewer')),
  membership_status text not null default 'active' check (
    membership_status in ('active', 'invited', 'suspended')
  ),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 2. Course Authoring, Templates, Sources, Governance & AI Usage Tables
-- ----------------------------------------------------------------------------

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.user_profiles(id) on delete set null,
  local_source_id text,
  course_name text not null default 'Untitled Course Project',
  course_data jsonb not null,
  lifecycle_status text not null default 'draft' check (
    lifecycle_status in ('draft', 'in_development', 'awaiting_review', 'revision_required', 'completed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, local_source_id)
);

create table if not exists public.course_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  trigger text not null default 'manual_snapshot' check (
    trigger in ('auto_save', 'stage_approval', 'ai_generation', 'manual_snapshot', 'restore')
  ),
  summary text not null default '',
  snapshot_data jsonb not null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  created_by uuid references public.user_profiles(id) on delete set null,
  local_source_id text,
  template_name text not null,
  template_data jsonb not null,
  visibility text not null default 'company' check (visibility in ('system', 'company')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_visibility_company_check check (
    (visibility = 'system' and company_id is null) or
    (visibility = 'company' and company_id is not null)
  ),
  unique (company_id, local_source_id)
);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  storage_path text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  extracted_text text not null default '',
  verification_status text not null default 'NEEDS REVIEW' check (
    verification_status in ('VERIFIED', 'NEEDS REVIEW', 'UNSUPPORTED')
  ),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  stage integer not null check (stage between 1 and 7),
  role_key text not null,
  reviewer_id uuid references public.user_profiles(id) on delete set null,
  reviewer_name text not null,
  decision text not null check (decision in ('approved', 'rejected', 'pending')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost numeric(12, 6) not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Indexes for Query Performance
-- ----------------------------------------------------------------------------

create index if not exists idx_company_memberships_user on public.company_memberships (user_id, membership_status);
create index if not exists idx_company_memberships_company on public.company_memberships (company_id, membership_status);
create index if not exists idx_courses_company_updated on public.courses (company_id, updated_at desc);
create index if not exists idx_course_versions_course on public.course_versions (company_id, course_id, version_number desc);
create index if not exists idx_templates_company on public.templates (company_id, visibility);
create index if not exists idx_source_documents_company_course on public.source_documents (company_id, course_id);
create index if not exists idx_course_approvals_company_course on public.course_approvals (company_id, course_id);
create index if not exists idx_ai_usage_company_created on public.ai_usage_records (company_id, created_at desc);
create index if not exists idx_audit_logs_company_created on public.audit_logs (company_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Updated-At Triggers & Auth Profile Auto-Provisioning
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_courses_updated_at on public.courses;
create trigger trg_courses_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_templates_updated_at on public.templates;
create trigger trg_templates_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

drop trigger if exists trg_source_documents_updated_at on public.source_documents;
create trigger trg_source_documents_updated_at
  before update on public.source_documents
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when excluded.full_name <> '' then excluded.full_name
          else public.user_profiles.full_name
        end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 5. RLS Helper Functions
-- ----------------------------------------------------------------------------

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.membership_status = 'active'
  );
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = target_company_id
      and cm.user_id = auth.uid()
      and cm.membership_status = 'active'
      and cm.role = any(allowed_roles)
  );
$$;

-- Safe onboarding helper when an already-authenticated user creates a new company workspace.
-- Always assigns the creator as 'company_admin' strictly within their newly created company.
create or replace function public.create_company_workspace(
  p_company_name text,
  p_company_slug text,
  p_primary_colour text default '#052B66',
  p_secondary_colour text default '#45CC42',
  p_logo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_company_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required to create a company workspace.';
  end if;

  insert into public.companies (
    company_name,
    company_slug,
    logo_url,
    primary_colour,
    secondary_colour
  ) values (
    trim(p_company_name),
    lower(trim(p_company_slug)),
    p_logo_url,
    coalesce(nullif(trim(p_primary_colour), ''), '#052B66'),
    coalesce(nullif(trim(p_secondary_colour), ''), '#45CC42')
  )
  returning id into v_company_id;

  insert into public.company_memberships (company_id, user_id, role, membership_status)
  values (v_company_id, v_user_id, 'company_admin', 'active');

  insert into public.audit_logs (company_id, user_id, action, resource_type, resource_id)
  values (v_company_id, v_user_id, 'company_created', 'company', v_company_id::text);

  return v_company_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Strict Row Level Security (RLS) Policies
-- ----------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.user_profiles enable row level security;
alter table public.company_memberships enable row level security;
alter table public.courses enable row level security;
alter table public.course_versions enable row level security;
alter table public.templates enable row level security;
alter table public.source_documents enable row level security;
alter table public.course_approvals enable row level security;
alter table public.ai_usage_records enable row level security;
alter table public.audit_logs enable row level security;

-- companies
drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member"
  on public.companies for select
  to authenticated
  using (public.is_company_member(id));

drop policy if exists "companies_update_admin" on public.companies;
create policy "companies_update_admin"
  on public.companies for update
  to authenticated
  using (public.has_company_role(id, array['company_admin']))
  with check (public.has_company_role(id, array['company_admin']));

-- user_profiles
drop policy if exists "user_profiles_select_self_or_comember" on public.user_profiles;
create policy "user_profiles_select_self_or_comember"
  on public.user_profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.company_memberships mine
      join public.company_memberships theirs
        on mine.company_id = theirs.company_id
      where mine.user_id = auth.uid()
        and mine.membership_status = 'active'
        and theirs.user_id = public.user_profiles.id
    )
  );

drop policy if exists "user_profiles_update_self" on public.user_profiles;
create policy "user_profiles_update_self"
  on public.user_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- company_memberships
drop policy if exists "memberships_select_same_company_or_self" on public.company_memberships;
create policy "memberships_select_same_company_or_self"
  on public.company_memberships for select
  to authenticated
  using (user_id = auth.uid() or public.is_company_member(company_id));

drop policy if exists "memberships_insert_admin_only" on public.company_memberships;
create policy "memberships_insert_admin_only"
  on public.company_memberships for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin'])
    and role in ('company_admin', 'author', 'reviewer', 'viewer')
  );

drop policy if exists "memberships_update_admin_only" on public.company_memberships;
create policy "memberships_update_admin_only"
  on public.company_memberships for update
  to authenticated
  using (public.has_company_role(company_id, array['company_admin']))
  with check (
    public.has_company_role(company_id, array['company_admin'])
    and role in ('company_admin', 'author', 'reviewer', 'viewer')
  );

drop policy if exists "memberships_delete_admin_only" on public.company_memberships;
create policy "memberships_delete_admin_only"
  on public.company_memberships for delete
  to authenticated
  using (public.has_company_role(company_id, array['company_admin']));

-- courses
drop policy if exists "courses_select_member" on public.courses;
create policy "courses_select_member"
  on public.courses for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "courses_insert_author" on public.courses;
create policy "courses_insert_author"
  on public.courses for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'author'])
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists "courses_update_editor" on public.courses;
create policy "courses_update_editor"
  on public.courses for update
  to authenticated
  using (public.has_company_role(company_id, array['company_admin', 'author', 'reviewer']))
  with check (public.has_company_role(company_id, array['company_admin', 'author', 'reviewer']));

drop policy if exists "courses_delete_admin_or_author" on public.courses;
create policy "courses_delete_admin_or_author"
  on public.courses for delete
  to authenticated
  using (public.has_company_role(company_id, array['company_admin', 'author']));

-- course_versions
drop policy if exists "course_versions_select_member" on public.course_versions;
create policy "course_versions_select_member"
  on public.course_versions for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "course_versions_insert_editor" on public.course_versions;
create policy "course_versions_insert_editor"
  on public.course_versions for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'author', 'reviewer'])
    and (created_by is null or created_by = auth.uid())
  );

-- templates (system templates readable by authenticated users; mutations scoped to company templates)
drop policy if exists "templates_select_system_or_company" on public.templates;
create policy "templates_select_system_or_company"
  on public.templates for select
  to authenticated
  using (
    (visibility = 'system' and company_id is null)
    or (company_id is not null and public.is_company_member(company_id))
  );

drop policy if exists "templates_insert_company_author" on public.templates;
create policy "templates_insert_company_author"
  on public.templates for insert
  to authenticated
  with check (
    visibility = 'company'
    and company_id is not null
    and public.has_company_role(company_id, array['company_admin', 'author'])
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists "templates_update_company_author" on public.templates;
create policy "templates_update_company_author"
  on public.templates for update
  to authenticated
  using (
    visibility = 'company'
    and company_id is not null
    and public.has_company_role(company_id, array['company_admin', 'author'])
  )
  with check (
    visibility = 'company'
    and company_id is not null
    and public.has_company_role(company_id, array['company_admin', 'author'])
  );

drop policy if exists "templates_delete_company_author" on public.templates;
create policy "templates_delete_company_author"
  on public.templates for delete
  to authenticated
  using (
    visibility = 'company'
    and company_id is not null
    and public.has_company_role(company_id, array['company_admin', 'author'])
  );

-- source_documents
drop policy if exists "source_documents_select_member" on public.source_documents;
create policy "source_documents_select_member"
  on public.source_documents for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "source_documents_insert_editor" on public.source_documents;
create policy "source_documents_insert_editor"
  on public.source_documents for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'author', 'reviewer'])
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

drop policy if exists "source_documents_update_editor" on public.source_documents;
create policy "source_documents_update_editor"
  on public.source_documents for update
  to authenticated
  using (public.has_company_role(company_id, array['company_admin', 'author', 'reviewer']))
  with check (public.has_company_role(company_id, array['company_admin', 'author', 'reviewer']));

drop policy if exists "source_documents_delete_admin_or_author" on public.source_documents;
create policy "source_documents_delete_admin_or_author"
  on public.source_documents for delete
  to authenticated
  using (public.has_company_role(company_id, array['company_admin', 'author']));

-- course_approvals
drop policy if exists "course_approvals_select_member" on public.course_approvals;
create policy "course_approvals_select_member"
  on public.course_approvals for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "course_approvals_insert_reviewer" on public.course_approvals;
create policy "course_approvals_insert_reviewer"
  on public.course_approvals for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'reviewer', 'author'])
    and (reviewer_id is null or reviewer_id = auth.uid())
  );

-- ai_usage_records
drop policy if exists "ai_usage_select_member" on public.ai_usage_records;
create policy "ai_usage_select_member"
  on public.ai_usage_records for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "ai_usage_insert_member" on public.ai_usage_records;
create policy "ai_usage_insert_member"
  on public.ai_usage_records for insert
  to authenticated
  with check (
    public.is_company_member(company_id)
    and (user_id is null or user_id = auth.uid())
  );

-- audit_logs
drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (public.has_company_role(company_id, array['company_admin']));

drop policy if exists "audit_logs_insert_member" on public.audit_logs;
create policy "audit_logs_insert_member"
  on public.audit_logs for insert
  to authenticated
  with check (
    public.is_company_member(company_id)
    and (user_id is null or user_id = auth.uid())
  );
