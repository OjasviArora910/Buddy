-- Run in Supabase SQL editor. User-scoped database requests use verified JWTs and RLS.
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_cron;

create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default 'New conversation' check(length(title) between 1 and 120),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id uuid references public.conversations(id) on delete cascade,
 role text not null check(role in ('user','assistant')), content text not null,
 created_at timestamptz not null default now()
);

alter table public.messages add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
insert into public.conversations (user_id, title)
select distinct m.user_id, 'Earlier conversations'
from public.messages m
where m.conversation_id is null
  and not exists (
    select 1 from public.conversations c
    where c.user_id = m.user_id and c.title = 'Earlier conversations'
  );
update public.messages m
set conversation_id = (
  select c.id from public.conversations c
  where c.user_id = m.user_id and c.title = 'Earlier conversations'
  order by c.created_at limit 1
)
where m.conversation_id is null;

create table if not exists public.memories (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 content text not null check(length(content) between 1 and 500),
 category text not null default 'preferences' check(category in ('user_profile','relationships','life_events','preferences','open_threads')),
 embedding vector(768),
 sensitive boolean not null default false,
 consented_at timestamptz,
 source_reason text not null default 'Saved by the user',
 retention_days integer check(retention_days is null or retention_days between 1 and 3650),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not sensitive or consented_at is not null)
);

create table if not exists public.memory_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 automatic_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);

-- Upgrade the original manually-created memory table without losing saved items.
alter table public.memories add column if not exists category text not null default 'preferences';
alter table public.memories add column if not exists embedding vector(768);
alter table public.memories add column if not exists sensitive boolean not null default false;
alter table public.memories add column if not exists consented_at timestamptz;
alter table public.memories add column if not exists source_reason text not null default 'Saved by the user';
alter table public.memories add column if not exists retention_days integer;
alter table public.memories add column if not exists expires_at timestamptz;
alter table public.memories add column if not exists updated_at timestamptz not null default now();
alter table public.memories alter column content type text;
alter table public.memories drop constraint if exists memories_category_check;
update public.memories set category = 'relationships' where category = 'people';
alter table public.memories add constraint memories_category_check check(category in ('user_profile','relationships','life_events','preferences','open_threads'));
alter table public.memories drop constraint if exists memories_content_check;
alter table public.memories add constraint memories_content_check check(length(content) between 1 and 500);
alter table public.memories drop constraint if exists memories_check;
alter table public.memories drop constraint if exists memories_sensitive_consent_check;
alter table public.memories add constraint memories_sensitive_consent_check check(not sensitive or consented_at is not null);
alter table public.memories drop constraint if exists memories_retention_days_check;
alter table public.memories add constraint memories_retention_days_check check(retention_days is null or retention_days between 1 and 3650);
update public.memories set consented_at = created_at where sensitive and consented_at is null;

create index if not exists messages_user_created on public.messages(user_id,created_at);
create index if not exists messages_conversation_created on public.messages(user_id,conversation_id,created_at desc);
create index if not exists conversations_user_updated on public.conversations(user_id,updated_at desc);
create index if not exists memories_user_created on public.memories(user_id,created_at);
create index if not exists memories_expiry on public.memories(user_id,expires_at);
create index if not exists memories_embedding_cosine on public.memories using hnsw (embedding vector_cosine_ops);

select cron.unschedule(jobid)
from cron.job
where jobname = 'buddy-delete-expired-memories';
select cron.schedule(
 'buddy-delete-expired-memories',
 '17 3 * * *',
 'delete from public.memories where expires_at is not null and expires_at <= now()'
);

create or replace function public.match_memories(
 query_embedding vector(768),
 match_user_id uuid,
 match_count int default 5
) returns table(id uuid, content text, category text, sensitive boolean, similarity float)
language sql stable
as $$
 select m.id, m.content, m.category, m.sensitive,
        1 - (m.embedding <=> query_embedding) as similarity
 from public.memories m
 where m.user_id = match_user_id
   and (auth.uid() = match_user_id or auth.role() = 'service_role')
   and m.embedding is not null
   and (m.expires_at is null or m.expires_at > now())
 order by m.embedding <=> query_embedding
 limit greatest(1, least(match_count, 10));
$$;
revoke all on function public.match_memories(vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_memories(vector, uuid, int) to authenticated, service_role;

alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.conversations enable row level security;
alter table public.memory_settings enable row level security;
drop policy if exists "own memory settings select" on public.memory_settings;
drop policy if exists "own memory settings insert" on public.memory_settings;
drop policy if exists "own memory settings update" on public.memory_settings;
create policy "own memory settings select" on public.memory_settings for select to authenticated using (auth.uid() = user_id);
create policy "own memory settings insert" on public.memory_settings for insert to authenticated with check (auth.uid() = user_id);
create policy "own memory settings update" on public.memory_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own conversations select" on public.conversations;
drop policy if exists "own conversations insert" on public.conversations;
drop policy if exists "own conversations update" on public.conversations;
drop policy if exists "own conversations delete" on public.conversations;
create policy "own conversations select" on public.conversations for select to authenticated using (auth.uid() = user_id);
create policy "own conversations insert" on public.conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "own conversations update" on public.conversations for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own conversations delete" on public.conversations for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "own messages select" on public.messages;
drop policy if exists "own messages insert" on public.messages;
drop policy if exists "own memories select" on public.memories;
drop policy if exists "own memories insert" on public.memories;
drop policy if exists "own memories update" on public.memories;
drop policy if exists "own memories delete" on public.memories;
drop policy if exists "own messages update" on public.messages;
drop policy if exists "own messages delete" on public.messages;
drop policy if exists "own conversation messages select" on public.messages;
drop policy if exists "own conversation messages insert" on public.messages;
create policy "own conversation messages select" on public.messages for select to authenticated using (
 auth.uid() = user_id and exists (
  select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
 )
);
create policy "own conversation messages insert" on public.messages for insert to authenticated with check (
 auth.uid() = user_id and exists (
  select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
 )
);
create policy "own memories select" on public.memories for select to authenticated using (auth.uid() = user_id);
create policy "own memories insert" on public.memories for insert to authenticated with check (auth.uid() = user_id);
create policy "own memories update" on public.memories for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own memories delete" on public.memories for delete to authenticated using (auth.uid() = user_id);

grant usage on schema public to authenticated, service_role;
grant select, insert on public.messages, public.conversations to authenticated;
grant update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.memories to authenticated;
grant select, insert, update on public.memory_settings to authenticated;
grant all on public.messages, public.memories to service_role;
