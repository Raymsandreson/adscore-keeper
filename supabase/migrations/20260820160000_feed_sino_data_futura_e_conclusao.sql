-- Conserta as linhas do feed do sino que já entraram erradas (20/08/2026).
--
-- O QUE ESTAVA ERRADO, no 0000375-74.2026.5.08.0120:
--   O push do TRT8 de 12/06/2026 trazia três eventos — a conclusão das 16:32,
--   a audiência cancelada das 12:08 e a SALA da audiência designada para
--   16/09/2026. O parser carimbava a linha com a MAIOR data do bloco, que era a
--   audiência que ainda nem aconteceu: o card foi para o topo do feed com
--   16/09/2026 e, como "Hoje"/"7 dias"/"30 dias" só tinham piso, apareceu como
--   notícia do dia — uma conclusão de junho anunciada em agosto, sendo que a
--   sentença saiu em 27/07/2026 e o Recurso Ordinário em 11/08.
--
--   Junto disso, "Conclusos os autos para julgamento Proferir sentença" caía em
--   'decisao_merito' só por conter a palavra "sentença". Conclusão é o processo
--   subindo para o juiz, não o julgamento.
--
-- O código já não erra mais (emailPushParser: teto na data do e-mail;
-- processUpdateClassifier: conclusão fora do teste de mérito; o sino filtra
-- pelo dia da captura quando a movimentação está no futuro). Aqui só o passivo:
-- 38 linhas com data no futuro e 18 conclusões vestidas de decisão.
--
-- Aplicar no Externo (kmedldlepwiityjsdahz).

-- 1) Data no futuro volta para o último evento do bloco que JÁ tinha acontecido
--    quando a linha foi capturada. As 38 linhas têm esse evento — nenhuma fica
--    sem data e nenhuma data é inventada.
update public.process_updates u
   set data_movimentacao = sub.ultima_ocorrida
  from (
    select u2.id,
           max((e->>'data')::date) as ultima_ocorrida
      from public.process_updates u2,
           lateral jsonb_array_elements(coalesce(u2.eventos, '[]'::jsonb)) e
     where u2.data_movimentacao > u2.created_at::date
       and (e->>'data') ~ '^\d{4}-\d{2}-\d{2}$'
       and (e->>'data')::date <= u2.created_at::date
     group by u2.id
  ) sub
 where u.id = sub.id;

-- 2) Conclusão anunciada como decisão de mérito. A linha continua no feed — só
--    troca de categoria, na mesma ordem do classificador (audiência antes de
--    despacho, para o card que também traz audiência). Fica de fora a conclusão
--    que já vem com o julgamento na mesma linha.
update public.process_updates
   set categoria = case
         when descricao ~* 'audi[êe]nc' then 'audiencia'
         else 'despacho'
       end,
       titulo = case
         when titulo = 'Decisão de mérito' and descricao ~* 'audi[êe]nc' then 'Audiência'
         when titulo = 'Decisão de mérito' then 'Despacho'
         else titulo
       end
 where categoria = 'decisao_merito'
   and descricao ~* 'conclus'
   and descricao !~* 'julgad[oa]s?\s+(parcialmente\s+)?(im)?procedent|julgo |ac[óo]rd[ãa]o|tr[âa]nsito em julgado';
