-- ============================================================================
-- eStudy Master Course Builder V2 — Governance & RBAC Security Hardening
-- ============================================================================
-- Additive, non-breaking migration:
-- 1. Adds explicit governance_roles authorization array on company_memberships.
--    Neither company_admin nor reviewer automatically qualifies for governance
--    gates without explicit role assignment.
-- 2. Hardens course_approvals with active/revocation tracking and partial
--    unique indexes enforcing:
--    - Single active approval per (company_id, course_id, role_key)
--    - Three-person rule: a single reviewer_id cannot hold more than one
--      active Stage 6 governance approval on the same course.
-- 3. Aligns RLS policies for source_documents, storage.objects, and
--    course_approvals with backend/frontend RBAC.
-- ============================================================================

-- 1. Explicit governance role authorizations on company_memberships
alter table public.company_memberships
  add column if not exists governance_roles text[] not null default '{}'::text[];

alter table public.company_memberships
  drop constraint if exists company_memberships_governance_roles_check;

alter table public.company_memberships
  add constraint company_memberships_governance_roles_check check (
    governance_roles <@ array['sme', 'instructional_designer', 'compliance_authorizer']::text[]
  );

-- 2. Harden course_approvals for immutable audit history & 3-person rule
alter table public.course_approvals
  add column if not exists governance_role text,
  add column if not exists active boolean not null default true,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.user_profiles(id) on delete set null;

create index if not exists idx_course_approvals_active_lookup
  on public.course_approvals (company_id, course_id, stage, active, created_at desc);

-- Ensure at most one active approved record per governance role on a course
create unique index if not exists uq_course_approvals_active_role
  on public.course_approvals (company_id, course_id, role_key)
  where stage = 6 and decision = 'approved' and active = true;

-- Enforce the three-person rule at database level:
-- One authenticated human reviewer cannot hold multiple active governance approvals on the same course.
create unique index if not exists uq_course_approvals_three_person_rule
  on public.course_approvals (company_id, course_id, reviewer_id)
  where stage = 6 and decision = 'approved' and active = true and reviewer_id is not null;

-- Helper function to verify explicit governance role authorization under RLS
create or replace function public.has_governance_role(target_company_id uuid, required_gov_role text)
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
      and cm.role in ('reviewer', 'company_admin')
      and required_gov_role = any(cm.governance_roles)
  );
$$;

grant execute on function public.has_governance_role(uuid, text) to authenticated, service_role;

-- 3. Tighten course_approvals RLS (remove 'author' from inserting approvals, bind reviewer_id = auth.uid())
drop policy if exists "course_approvals_insert_reviewer" on public.course_approvals;
create policy "course_approvals_insert_reviewer"
  on public.course_approvals for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'reviewer'])
    and reviewer_id is not null
    and reviewer_id = auth.uid()
    and (
      stage <> 6
      or public.has_governance_role(
        company_id,
        coalesce(
          governance_role,
          case role_key
            when 'instructionalDesigner' then 'instructional_designer'
            when 'complianceAuthorizer' then 'compliance_authorizer'
            else role_key
          end
        )
      )
    )
  );

drop policy if exists "course_approvals_update_own_uncompleted" on public.course_approvals;
create policy "course_approvals_update_own_uncompleted"
  on public.course_approvals for update
  to authenticated
  using (
    public.has_company_role(company_id, array['company_admin', 'reviewer'])
    and reviewer_id = auth.uid()
    and not exists (
      select 1
      from public.courses c
      where c.id = course_approvals.course_id
        and c.company_id = course_approvals.company_id
        and c.lifecycle_status = 'completed'
    )
  )
  with check (
    reviewer_id = auth.uid()
  );

-- 4. Align source_documents & storage.objects RLS: Reviewer is View-Only (Author + Company Admin only for upload/modify)
drop policy if exists "source_documents_insert_editor" on public.source_documents;
create policy "source_documents_insert_editor"
  on public.source_documents for insert
  to authenticated
  with check (
    public.has_company_role(company_id, array['company_admin', 'author'])
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

drop policy if exists "source_documents_update_editor" on public.source_documents;
create policy "source_documents_update_editor"
  on public.source_documents for update
  to authenticated
  using (public.has_company_role(company_id, array['company_admin', 'author']))
  with check (public.has_company_role(company_id, array['company_admin', 'author']));

drop policy if exists "course_sources_insert_company_editor" on storage.objects;
create policy "course_sources_insert_company_editor"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-sources'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin', 'author'])
  );

notify pgrst, 'reload schema';
