create table if not exists public.notice_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  username text,
  password_hash text not null,
  role text not null check (role in ('admin', 'reader')),
  created_at timestamptz not null default now()
);

create unique index if not exists notice_users_email_unique
  on public.notice_users (lower(email))
  where email is not null;

create unique index if not exists notice_users_username_unique
  on public.notice_users (lower(username))
  where username is not null;

create unique index if not exists notice_users_one_account_per_role
  on public.notice_users (role);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 100),
  message text not null check (char_length(message) between 5 and 3000),
  author text not null,
  created_at timestamptz not null default now()
);

alter table public.notice_users enable row level security;
alter table public.notices enable row level security;
revoke all on public.notice_users from anon, authenticated;
revoke all on public.notices from anon, authenticated;
grant select, insert, update, delete on public.notice_users to service_role;
grant select, insert, update, delete on public.notices to service_role;

create or replace function public.setup_initial_accounts(
  p_admin_name text,
  p_admin_email text,
  p_admin_password_hash text,
  p_reader_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_admin_id uuid;
begin
  insert into public.notice_users (name, email, password_hash, role)
  values (p_admin_name, lower(p_admin_email), p_admin_password_hash, 'admin')
  returning id into new_admin_id;

  insert into public.notice_users (name, username, password_hash, role)
  values ('Portaria', 'Portaria', p_reader_password_hash, 'reader');

  return new_admin_id;
exception
  when unique_violation then
    return null;
end;
$$;

revoke all on function public.setup_initial_accounts(text, text, text, text) from public, anon, authenticated;
grant execute on function public.setup_initial_accounts(text, text, text, text) to service_role;
