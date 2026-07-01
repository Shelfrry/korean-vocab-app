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
  placement_pending boolean not null default true,
  review_cards jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.korean_vocab_words_v2
  add column if not exists placement_pending boolean not null default true;

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

create table if not exists public.otterly_grammar_v1 (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  grammar text not null,
  summary text default '',
  pattern text default '',
  examples text default '',
  source text default '',
  tag text default '',
  notes text default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.otterly_grammar_v1 enable row level security;

drop policy if exists "otterly grammar select own"
  on public.otterly_grammar_v1;

drop policy if exists "otterly grammar insert own"
  on public.otterly_grammar_v1;

drop policy if exists "otterly grammar update own"
  on public.otterly_grammar_v1;

drop policy if exists "otterly grammar delete own"
  on public.otterly_grammar_v1;

create policy "otterly grammar select own"
  on public.otterly_grammar_v1
  for select
  using ((select auth.uid()) = user_id);

create policy "otterly grammar insert own"
  on public.otterly_grammar_v1
  for insert
  with check ((select auth.uid()) = user_id);

create policy "otterly grammar update own"
  on public.otterly_grammar_v1
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "otterly grammar delete own"
  on public.otterly_grammar_v1
  for delete
  using ((select auth.uid()) = user_id);

create index if not exists otterly_grammar_v1_user_updated_idx
  on public.otterly_grammar_v1(user_id, updated_at desc);

create index if not exists otterly_grammar_v1_user_deleted_idx
  on public.otterly_grammar_v1(user_id, deleted_at);

create index if not exists otterly_grammar_v1_user_tag_idx
  on public.otterly_grammar_v1(user_id, tag);

create index if not exists otterly_grammar_v1_user_grammar_idx
  on public.otterly_grammar_v1(user_id, grammar);
