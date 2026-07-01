create table if not exists public.vocab_cards (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  meaning text default '',
  note text default '',
  pos text default '',
  pronunciation text default '',
  forms text default '',
  box integer not null default 1,
  next_review date not null default current_date,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.vocab_cards enable row level security;

drop policy if exists "vocab cards select own" on public.vocab_cards;
drop policy if exists "vocab cards insert own" on public.vocab_cards;
drop policy if exists "vocab cards update own" on public.vocab_cards;
drop policy if exists "vocab cards delete own" on public.vocab_cards;

create policy "vocab cards select own"
  on public.vocab_cards
  for select
  using ((select auth.uid()) = user_id);

create policy "vocab cards insert own"
  on public.vocab_cards
  for insert
  with check ((select auth.uid()) = user_id);

create policy "vocab cards update own"
  on public.vocab_cards
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vocab cards delete own"
  on public.vocab_cards
  for delete
  using ((select auth.uid()) = user_id);

create index if not exists vocab_cards_user_next_review_idx
  on public.vocab_cards(user_id, next_review);

create index if not exists vocab_cards_user_updated_idx
  on public.vocab_cards(user_id, updated_at desc);
