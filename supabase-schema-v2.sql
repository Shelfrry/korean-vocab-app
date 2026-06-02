create table if not exists public.korean_vocab_words_v2 (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  korean text not null,
  base_form text default '',
  meaning text default '',
  part_of_speech text default '',
  example_ko text default '',
  example_zh text default '',
  pronunciation text default '',
  forms text default '',
  confusion text default '',
  source text default '',
  notes text default '',

  mastered boolean not null default false,
  review_cards jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.korean_vocab_words_v2 enable row level security;

drop policy if exists "korean vocab v2 select own"
  on public.korean_vocab_words_v2;

drop policy if exists "korean vocab v2 insert own"
  on public.korean_vocab_words_v2;

drop policy if exists "korean vocab v2 update own"
  on public.korean_vocab_words_v2;

drop policy if exists "korean vocab v2 delete own"
  on public.korean_vocab_words_v2;

create policy "korean vocab v2 select own"
  on public.korean_vocab_words_v2
  for select
  using ((select auth.uid()) = user_id);

create policy "korean vocab v2 insert own"
  on public.korean_vocab_words_v2
  for insert
  with check ((select auth.uid()) = user_id);

create policy "korean vocab v2 update own"
  on public.korean_vocab_words_v2
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "korean vocab v2 delete own"
  on public.korean_vocab_words_v2
  for delete
  using ((select auth.uid()) = user_id);

create index if not exists korean_vocab_words_v2_user_updated_idx
  on public.korean_vocab_words_v2(user_id, updated_at desc);

create index if not exists korean_vocab_words_v2_user_deleted_idx
  on public.korean_vocab_words_v2(user_id, deleted_at);

create index if not exists korean_vocab_words_v2_user_korean_idx
  on public.korean_vocab_words_v2(user_id, korean);
