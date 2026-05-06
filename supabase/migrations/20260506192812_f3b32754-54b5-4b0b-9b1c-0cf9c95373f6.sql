
-- 1) Trigger que ao criar profile (novo signup) consome o convite pendente:
--    aplica access_profile_id, module_permissions e whatsapp_instance_ids
CREATE OR REPLACE FUNCTION public.consume_team_invitation_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv RECORD;
  perm jsonb;
  inst_id uuid;
BEGIN
  SELECT * INTO inv
  FROM public.team_invitations
  WHERE lower(email) = lower(NEW.email)
    AND accepted_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Garante user_role com access_profile_id do convite
  INSERT INTO public.user_roles (user_id, role, access_profile_id)
  VALUES (NEW.user_id, inv.role, inv.access_profile_id)
  ON CONFLICT (user_id, role) DO UPDATE
    SET access_profile_id = COALESCE(EXCLUDED.access_profile_id, public.user_roles.access_profile_id);

  -- Aplica módulos
  IF inv.module_permissions IS NOT NULL THEN
    FOR perm IN SELECT * FROM jsonb_array_elements(inv.module_permissions)
    LOOP
      INSERT INTO public.member_module_permissions (user_id, module_key, access_level)
      VALUES (NEW.user_id, perm->>'module_key', perm->>'access_level')
      ON CONFLICT (user_id, module_key) DO UPDATE
        SET access_level = EXCLUDED.access_level, updated_at = now();
    END LOOP;
  END IF;

  -- Aplica instâncias WhatsApp
  IF inv.whatsapp_instance_ids IS NOT NULL THEN
    FOREACH inst_id IN ARRAY inv.whatsapp_instance_ids
    LOOP
      INSERT INTO public.whatsapp_instance_users (user_id, instance_id)
      VALUES (NEW.user_id, inst_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Marca convite como aceito
  UPDATE public.team_invitations
  SET accepted_at = now()
  WHERE id = inv.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'consume_team_invitation_on_signup failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_consume_invite ON public.profiles;
CREATE TRIGGER on_profile_created_consume_invite
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.consume_team_invitation_on_signup();

-- 2) Backfill: aplica o convite pendente da Vanessa
DO $$
DECLARE
  inv RECORD;
  perm jsonb;
  inst_id uuid;
BEGIN
  SELECT ti.* INTO inv
  FROM public.team_invitations ti
  WHERE lower(ti.email) = 'vanessamirandamacedo@gmail.com'
    AND ti.accepted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.user_roles
    SET access_profile_id = COALESCE(inv.access_profile_id, access_profile_id)
    WHERE user_id = '1d6f6602-5274-427c-8b70-54b6e19dc524';

    FOR perm IN SELECT * FROM jsonb_array_elements(inv.module_permissions)
    LOOP
      INSERT INTO public.member_module_permissions (user_id, module_key, access_level)
      VALUES ('1d6f6602-5274-427c-8b70-54b6e19dc524', perm->>'module_key', perm->>'access_level')
      ON CONFLICT (user_id, module_key) DO UPDATE
        SET access_level = EXCLUDED.access_level, updated_at = now();
    END LOOP;

    IF inv.whatsapp_instance_ids IS NOT NULL THEN
      FOREACH inst_id IN ARRAY inv.whatsapp_instance_ids
      LOOP
        INSERT INTO public.whatsapp_instance_users (user_id, instance_id)
        VALUES ('1d6f6602-5274-427c-8b70-54b6e19dc524', inst_id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    UPDATE public.team_invitations SET accepted_at = now() WHERE id = inv.id;
  END IF;
END $$;
