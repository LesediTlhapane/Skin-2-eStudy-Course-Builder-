-- ============================================================================
-- eStudy Master Course Builder V2 — Private Per-Company Storage & Policies
-- ============================================================================
-- Bucket: course-sources (PRIVATE)
-- Object Path Convention: <company_id>/<course_id>/<source_id>-<filename>
-- All files remain strictly private; access is granted only via short-lived
-- signed URLs verified against active company membership.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-sources',
  'course-sources',
  false,
  5242880, -- 5 MB max per uploaded source file
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880;

-- Read source files strictly within companies where user is an active member
drop policy if exists "course_sources_select_company_member" on storage.objects;
create policy "course_sources_select_company_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'course-sources'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

-- Upload source files strictly into active member company folder (admin/author/reviewer)
drop policy if exists "course_sources_insert_company_editor" on storage.objects;
create policy "course_sources_insert_company_editor"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'course-sources'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin', 'author', 'reviewer'])
  );

-- Delete source files strictly within caller's company folder (admin/author)
drop policy if exists "course_sources_delete_company_author" on storage.objects;
create policy "course_sources_delete_company_author"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'course-sources'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin', 'author'])
  );
