INSERT INTO public.member_module_permissions (user_id, module_key, access_level)
VALUES ('e1849012-7d6b-49b9-a5e5-36a2332e6eb8', 'team_management', 'view')
ON CONFLICT (user_id, module_key) DO UPDATE
  SET access_level = EXCLUDED.access_level, updated_at = now();