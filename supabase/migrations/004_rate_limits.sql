-- ============================================================================
-- eStudy Master Course Builder — Migration 004: Distributed API Rate Limiting
-- ============================================================================
-- Provides a shared PostgreSQL-backed sliding/fixed window counter table and
-- atomic RPC function for serverless deployments where in-memory rate limits
-- are ineffective across horizontal function instances.
-- ============================================================================

create table if not exists public.api_rate_limits (
  rate_key text primary key,
  request_count integer not null default 1 check (request_count >= 0),
  window_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limits_expires
  on public.api_rate_limits (window_expires_at);

alter table public.api_rate_limits enable row level security;

-- Lock down direct client access; backend accesses strictly via service role.
revoke all on table public.api_rate_limits from anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_max_requests integer,
  p_window_ms integer
)
returns table (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => greatest(1, ceil(p_window_ms::numeric / 1000.0)));
  v_count integer;
  v_expires timestamptz;
begin
  -- Opportunistically prune stale expired buckets to bound table size
  delete from public.api_rate_limits
  where window_expires_at < v_now - interval '5 minutes'
    and rate_key <> p_key;

  insert into public.api_rate_limits (rate_key, request_count, window_expires_at, updated_at)
  values (p_key, 1, v_now + v_window, v_now)
  on conflict (rate_key) do update
    set request_count = case
      when public.api_rate_limits.window_expires_at <= v_now then 1
      else public.api_rate_limits.request_count + 1
    end,
    window_expires_at = case
      when public.api_rate_limits.window_expires_at <= v_now then v_now + v_window
      else public.api_rate_limits.window_expires_at
    end,
    updated_at = v_now
  returning public.api_rate_limits.request_count, public.api_rate_limits.window_expires_at
  into v_count, v_expires;

  allowed := v_count <= greatest(1, p_max_requests);
  current_count := v_count;
  retry_after_seconds := greatest(1, ceil(extract(epoch from (v_expires - v_now)))::integer);
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
