-- leads: commission_rate + currency (2026-09-05, Peter: "a Sales type dropdown
-- before Estimated monthly sales: commission (default 5%) or custom (the fee);
-- and a currency, default USD"). `service` carries the sales type
-- ('website' = commission, 'custom_build' = fixed fee); these two columns
-- carry the rate and the money unit. CRM math: stemfra-ops/src/lib/leadValue.js.
alter table public.leads add column if not exists commission_rate numeric not null default 5;
alter table public.leads add column if not exists currency text not null default 'USD';
comment on column public.leads.commission_rate is 'Commission percentage for this lead (default 5)';
comment on column public.leads.currency is 'ISO currency of est_monthly_sales / deal_value (default USD)';
