-- Source of truth for database migrations. Apply this file to a fresh database,
-- or run the migration block at the top against an existing Stripe-era database
-- before deploying the Xendit backend.

-- Migration: Stripe → Xendit
alter table if exists users rename column "stripeCustomerId" to "xenditSubscriptionId";
drop index if exists users_stripe_idx;
alter table if exists users add column if not exists "graceEndsAt" timestamptz;
alter table if exists users add column if not exists "proUntil" timestamptz;

create table if not exists users (
  "userId" text primary key,
  email text not null,
  "licenseTier" text not null default 'free' check ("licenseTier" in ('free', 'pro')),
  "subscriptionStatus" text not null default 'none',
  "xenditSubscriptionId" text unique,
  "graceEndsAt" timestamptz,
  "proUntil" timestamptz,
  "lastVerifiedAt" timestamptz
);

create index if not exists users_xendit_idx on users ("xenditSubscriptionId");

create table if not exists installations (
  "instId" text primary key,
  "userId" text not null references users ("userId") on delete cascade,
  "createdAt" timestamptz not null default now()
);

create index if not exists installations_user_idx on installations ("userId");

create table if not exists accounts (
  "userId" text not null references users ("userId") on delete cascade,
  "adapterId" text not null,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  primary key ("userId", "adapterId", "accountId")
);

create index if not exists accounts_user_idx on accounts ("userId");

create table if not exists webhook_events (
  "eventId" text primary key,
  "userId" text not null references users ("userId") on delete cascade,
  "processedAt" timestamptz not null default now()
);

create index if not exists webhook_events_user_idx on webhook_events ("userId");

-- Reconcile one adapter's account set for a user in a single transaction. Replaces the
-- delete-then-upsert sequence in app code, which had a TOCTOU window that concurrent
-- /save requests could race through to exceed the free-account cap.
create or replace function sync_user_accounts(
  p_user_id text,
  p_adapter_id text,
  p_account_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  delete from accounts
   where "userId" = p_user_id
     and "adapterId" = p_adapter_id
     and (cardinality(p_account_ids) = 0 or "accountId" <> all(p_account_ids));

  insert into accounts ("userId", "adapterId", "accountId", "createdAt")
       select p_user_id, p_adapter_id, unnest(p_account_ids), now()
         on conflict ("userId", "adapterId", "accountId") do nothing;

  select count(*) into v_total from accounts where "userId" = p_user_id;
  return v_total;
end;
$$;