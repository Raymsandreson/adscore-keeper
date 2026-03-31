
-- Table to link ambassador contacts to products
CREATE TABLE IF NOT EXISTS public.ambassador_product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  product_service_id UUID NOT NULL REFERENCES public.products_services(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ambassador_contact_id, product_service_id)
);

ALTER TABLE public.ambassador_product_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ambassador product links"
ON public.ambassador_product_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert ambassador product links"
ON public.ambassador_product_links FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update ambassador product links"
ON public.ambassador_product_links FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete ambassador product links"
ON public.ambassador_product_links FOR DELETE TO authenticated USING (true);

-- Ensure 'embaixador' classification exists
INSERT INTO public.contact_classifications (name, color, description, show_in_workflow, is_system)
VALUES ('Embaixador', '#f59e0b', 'Parceiro que capta leads/casos para membros do time', true, true)
ON CONFLICT DO NOTHING;
