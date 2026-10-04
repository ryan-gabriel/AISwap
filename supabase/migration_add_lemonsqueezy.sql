-- Add Lemon Squeezy columns (additive, nullable, transitional)
alter table if exists users add column if not exists "lemonsqueezySubscriptionId" text unique;
alter table if exists users add column if not exists "lemonsqueezyCheckoutId" text;
alter table if exists users add column if not exists "lemonsqueezyCustomerId" text;
alter table if exists users add column if not exists "lemonsqueezyVariantId" text;
create index if not exists users_ls_sub_idx on users ("lemonsqueezySubscriptionId");
create index if not exists users_ls_checkout_idx on users ("lemonsqueezyCheckoutId");
create index if not exists users_ls_customer_idx on users ("lemonsqueezyCustomerId");
