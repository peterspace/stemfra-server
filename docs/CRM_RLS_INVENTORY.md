# CRM RLS policy inventory (live, 2026-09-03) — input to the role-hardening migration

| table | policy | cmd | roles | qual | with_check |
|---|---|---|---|---|---|
| activity_feed | Authenticated users can insert activity | INSERT | {public} |  | (auth.uid() IS NOT NULL) |
| activity_feed | Authenticated users can view activity | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| activity_feed | activity_feed_all | ALL | {authenticated} | true | true |
| billing_charges | billing_charges_staff_all | ALL | {authenticated} | is_stemfra_staff() | is_stemfra_staff() |
| call_scripts | call_scripts staff all | ALL | {public} | is_stemfra_staff() | is_stemfra_staff() |
| companies | Authenticated users can delete companies | DELETE | {public} | (auth.uid() IS NOT NULL) |  |
| companies | Authenticated users can insert companies | INSERT | {public} |  | (auth.uid() IS NOT NULL) |
| companies | Authenticated users can update companies | UPDATE | {public} | (auth.uid() IS NOT NULL) |  |
| companies | Authenticated users can view companies | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| companies | companies_all | ALL | {authenticated} | true | true |
| companies | companies_public_name | SELECT | {anon} | (EXISTS ( SELECT 1
   FROM sites s
  WHERE ((s.company_id = companies.id) AND (s.status = ANY (ARRAY['live'::site_status |  |
| contacts | Authenticated users can delete contacts | DELETE | {public} | (auth.uid() IS NOT NULL) |  |
| contacts | Authenticated users can insert contacts | INSERT | {public} |  | (auth.uid() IS NOT NULL) |
| contacts | Authenticated users can update contacts | UPDATE | {public} | (auth.uid() IS NOT NULL) |  |
| contacts | Authenticated users can view contacts | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| contacts | contacts_all | ALL | {authenticated} | true | true |
| deals | Authenticated users can delete deals | DELETE | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| deals | Authenticated users can insert deals | INSERT | {public} |  | (auth.uid() IS NOT NULL) |
| deals | Authenticated users can update deals | UPDATE | {public} | (auth.uid() IS NOT NULL) |  |
| deals | Authenticated users can view deals | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| deals | deals_all | ALL | {authenticated} | true | true |
| expenses | Admin and managers can manage expenses | ALL | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| expenses | Admin and managers can view expenses | SELECT | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| expenses | expenses_all | ALL | {authenticated} | true | true |
| income | Admin and managers can manage income | ALL | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| income | Admin and managers can view income | SELECT | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| income | income_all | ALL | {authenticated} | true | true |
| invoices | Admin and managers can manage invoices | ALL | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| invoices | Admin and managers can view invoices | SELECT | {public} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, ' |  |
| invoices | invoices_all | ALL | {authenticated} | true | true |
| leads | Authenticated users can delete leads | DELETE | {public} | (auth.uid() IS NOT NULL) |  |
| leads | Authenticated users can insert leads | INSERT | {public} |  | (auth.uid() IS NOT NULL) |
| leads | Authenticated users can update leads | UPDATE | {public} | (auth.uid() IS NOT NULL) |  |
| leads | Authenticated users can view leads | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| leads | leads_all | ALL | {authenticated} | true | true |
| pricing_countries | pricing_countries_admin | ALL | {authenticated} | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) | (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))) |
| pricing_countries | pricing_countries_read | SELECT | {authenticated} | true |  |
| profiles | Admins can update any profile | UPDATE | {public} | (EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'admin'::tex |  |
| profiles | Users can update own profile | UPDATE | {public} | (auth.uid() = id) |  |
| profiles | Users can view all profiles | SELECT | {public} | (auth.uid() IS NOT NULL) |  |
| profiles | profiles_select | SELECT | {authenticated} | true |  |
| profiles | profiles_update | UPDATE | {authenticated} | (auth.uid() = id) |  |
| subscriptions | subscriptions_owner_delete | DELETE | {authenticated} | (site_id IN ( SELECT user_owned_site_ids() AS user_owned_site_ids)) |  |
| subscriptions | subscriptions_owner_insert | INSERT | {authenticated} |  | (site_id IN ( SELECT user_owned_site_ids() AS user_owned_site_ids)) |
| subscriptions | subscriptions_owner_read | SELECT | {authenticated} | (is_stemfra_staff() OR (site_id IN ( SELECT user_owned_site_ids() AS user_owned_site_ids))) |  |
| subscriptions | subscriptions_owner_update | UPDATE | {authenticated} | (site_id IN ( SELECT user_owned_site_ids() AS user_owned_site_ids)) | (site_id IN ( SELECT user_owned_site_ids() AS user_owned_site_ids)) |
| subscriptions | subscriptions_staff_all | ALL | {authenticated} | is_stemfra_staff() | is_stemfra_staff() |
