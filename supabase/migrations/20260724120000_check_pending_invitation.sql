-- Permite que um visitante NÃO autenticado verifique se o próprio e-mail tem
-- convite de equipe pendente, sem expor role/permissões nem enumerar a tabela.
-- Necessário porque a RLS de team_invitations só libera SELECT para admin/convidador,
-- então o convidado anônimo não consegue validar o convite antes de criar a conta.
--
-- Retorna apenas true/false para o e-mail exato informado.
CREATE OR REPLACE FUNCTION public.check_pending_invitation(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_invitations
    WHERE lower(email) = lower(trim(p_email))
      AND accepted_at IS NULL
      AND expires_at > now()
  );
$$;

-- Executável pelo cliente anônimo (tela de cadastro por convite) e autenticado.
REVOKE ALL ON FUNCTION public.check_pending_invitation(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_pending_invitation(text) TO anon, authenticated;
