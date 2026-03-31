
-- Tabela de embaixadores (pessoas externas que captam leads)
CREATE TABLE public.ambassadors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  instagram_username TEXT,
  city TEXT,
  state TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vínculo entre embaixadores e membros do time
CREATE TABLE public.ambassador_member_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ambassador_id, member_user_id)
);

-- Campanhas/metas para embaixadores (configurável como OTE)
CREATE TABLE public.ambassador_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  member_user_id UUID, -- null = global para todos os membros
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  metric_key TEXT NOT NULL DEFAULT 'leads_captured', -- leads_captured, leads_converted
  target_value NUMERIC NOT NULL DEFAULT 10,
  reward_value NUMERIC NOT NULL DEFAULT 100, -- R$ por meta atingida
  min_threshold_percent NUMERIC NOT NULL DEFAULT 70, -- % mínimo para receber
  accelerator_multiplier NUMERIC DEFAULT 1.5, -- multiplicador acima da meta
  cap_percent NUMERIC DEFAULT 200, -- teto máximo
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leads captados por embaixadores (rastreamento)
CREATE TABLE public.ambassador_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id UUID NOT NULL REFERENCES public.ambassadors(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL, -- membro que recebeu o lead
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES public.ambassador_campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'captured', -- captured, converted, rejected
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.ambassadors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_member_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_referrals ENABLE ROW LEVEL SECURITY;

-- Políticas: authenticated pode ver tudo (dados compartilhados do time)
CREATE POLICY "Authenticated users can view ambassadors" ON public.ambassadors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage ambassadors" ON public.ambassadors FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view ambassador links" ON public.ambassador_member_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage ambassador links" ON public.ambassador_member_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view campaigns" ON public.ambassador_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage campaigns" ON public.ambassador_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can view referrals" ON public.ambassador_referrals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage referrals" ON public.ambassador_referrals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER update_ambassadors_updated_at BEFORE UPDATE ON public.ambassadors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ambassador_campaigns_updated_at BEFORE UPDATE ON public.ambassador_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ambassador_referrals_updated_at BEFORE UPDATE ON public.ambassador_referrals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
