-- Offline Admin API access tokens for Shopify handoff (authorization code grant).
-- Used when client_credentials is not permitted on the shop (custom distribution).

create table if not exists public.shopify_admin_tokens (
  shop_domain text primary key,
  access_token text not null,
  scope text,
  updated_at timestamptz not null default now()
);

alter table public.shopify_admin_tokens enable row level security;

revoke all on table public.shopify_admin_tokens from anon, authenticated;
grant all on table public.shopify_admin_tokens to service_role;
