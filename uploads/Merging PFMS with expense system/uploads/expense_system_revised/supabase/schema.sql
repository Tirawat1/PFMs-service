-- WC Finance production starter schema (review before use)
-- Run in a new Supabase project, then replace the example policies with rules
-- validated against your institution's real role and department model.

create extension if not exists pgcrypto;

create type public.request_status as enum (
  'notified','docs_submitted','verified','disbursed','purchase_complete','closed'
);
create type public.transaction_type as enum ('in','out','transfer');

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_en text not null,
  name_th text,
  permissions jsonb not null default '[]'::jsonb,
  system_role boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  department text,
  role_id uuid not null references public.roles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_en text not null,
  name_th text,
  opening_balance numeric(18,2) not null default 0 check (opening_balance >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name_en text not null,
  name_th text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.category_document_requirements (
  category_id uuid not null references public.expense_categories(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id),
  required boolean not null default true,
  sort_order integer not null default 0,
  primary key (category_id, document_type_id)
);

create table public.reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique not null,
  title text not null,
  description text not null,
  category_id uuid not null references public.expense_categories(id),
  payment_account_id uuid not null references public.accounts(id),
  amount numeric(18,2) not null check (amount > 0),
  requester_id uuid not null references public.profiles(user_id),
  department text not null,
  status public.request_status not null default 'notified',
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.request_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.reimbursement_requests(id) on delete cascade,
  document_type_id uuid references public.document_types(id),
  requirement_name_snapshot text not null,
  storage_path text,
  external_url text,
  original_filename text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references public.profiles(user_id),
  uploaded_at timestamptz,
  unique(request_id, requirement_name_snapshot)
);

create table public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  request_id uuid references public.reimbursement_requests(id),
  transaction_type public.transaction_type not null,
  amount numeric(18,2) not null check (amount > 0),
  description text not null,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.request_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.reimbursement_requests(id) on delete cascade,
  action text not null check (action in ('submitted','verified','returned','disbursed','purchase_complete','closed')),
  note text,
  acted_by uuid not null references public.profiles(user_id),
  acted_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  request_id uuid references public.reimbursement_requests(id) on delete cascade,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(user_id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- Current balance view. Transfers should be represented by paired transactions.
create view public.account_balances as
select a.id, a.code, a.name_en, a.name_th,
       a.opening_balance
       + coalesce(sum(case when t.transaction_type = 'in' then t.amount
                           when t.transaction_type = 'out' then -t.amount
                           else 0 end),0) as balance
from public.accounts a
left join public.account_transactions t on t.account_id = a.id
group by a.id;

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.document_types enable row level security;
alter table public.category_document_requirements enable row level security;
alter table public.reimbursement_requests enable row level security;
alter table public.request_documents enable row level security;
alter table public.account_transactions enable row level security;
alter table public.request_reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Minimal self-profile policy. Add carefully reviewed role-aware policies before use.
create policy "users can read own profile"
on public.profiles for select
to authenticated
using (user_id = auth.uid());

create policy "users can read own notifications"
on public.notifications for select
to authenticated
using (recipient_id = auth.uid());

create policy "users can update own notification read time"
on public.notifications for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- Intentionally no broad policies for financial tables.
-- Implement server-side RPC/functions for workflow transitions and disbursement,
-- then grant execute permissions instead of allowing unrestricted client writes.
