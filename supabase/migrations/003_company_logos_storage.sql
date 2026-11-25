-- ============================================================================
-- eStudy Master Course Builder V2 — Phase 2 Company Logos Storage & Policies
-- ============================================================================
-- Bucket: company-logos (PUBLIC READ for branding display; ADMIN-ONLY WRITE)
-- Object Path Convention: <company_id>/<logo_uuid>-<filename>.<ext>
-- Note: Keep 'course-sources' strictly private (002_storage_policies.sql).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152, -- 2 MB exact limit
  array[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- Allow public read of company branding logos only within the company-logos bucket
drop policy if exists "company_logos_public_read" on storage.objects;
create policy "company_logos_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'company-logos');

-- Restrict logo uploads strictly to authenticated company_admin users inside their own company folder
drop policy if exists "company_logos_admin_insert" on storage.objects;
create policy "company_logos_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin'])
  );

-- Restrict logo replacements/updates strictly to authenticated company_admin users
drop policy if exists "company_logos_admin_update" on storage.objects;
create policy "company_logos_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin'])
  )
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin'])
  );

-- Restrict logo deletions strictly to authenticated company_admin users inside their own company folder
drop policy if exists "company_logos_admin_delete" on storage.objects;
create policy "company_logos_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_company_role(((storage.foldername(name))[1])::uuid, array['company_admin'])
  );
