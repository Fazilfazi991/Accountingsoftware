-- The project has explicit anon function privileges outside the default PUBLIC
-- grant. Keep these tenant-management RPCs callable only by authenticated users.
revoke all on function public.update_organization_settings(uuid,text,text,text,text) from anon;
revoke all on function public.create_organization_branch(uuid,text) from anon;
revoke all on function public.update_organization_branch(uuid,uuid,text,public.entity_status) from anon;
