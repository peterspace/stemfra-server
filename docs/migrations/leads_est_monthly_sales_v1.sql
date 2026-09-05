-- leads.est_monthly_sales (2026-09-05, Stemfra OS: lead value rebuilt for the
-- commission model). A lead's worth is recurring: 5% of the business's monthly
-- sales. Reps type the estimate (or a per-vertical default fills it in the
-- CRM); deal_value keeps meaning the one-off BUILD FEE for custom builds.
-- Derived figures (monthly commission, expected annual value, forecast) are
-- computed in the CRM from these two columns: stemfra-ops/src/lib/leadValue.js.
alter table public.leads add column if not exists est_monthly_sales numeric;
comment on column public.leads.est_monthly_sales is 'Estimated monthly sales of the business (USD); 5% of it is Stemfra''s expected monthly commission';
comment on column public.leads.deal_value is 'One-off build fee (USD) for custom builds; 0/null for the commission website';
