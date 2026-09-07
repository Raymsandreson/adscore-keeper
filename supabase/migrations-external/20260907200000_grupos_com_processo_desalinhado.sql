-- =============================================================================
-- Onde a corrente grupo → cliente → processo está partida.
--
-- DE ONDE ISTO VEIO
-- A varredura da 6a procurava número de processo que o CLIENTE tivesse
-- escrito no grupo, para vincular sozinho. Não achou nada: em 1.146 grupos os
-- clientes escreveram 19 números válidos e 14 já estavam na ficha. O item 6,
-- como pedido, rende zero.
--
-- O que apareceu no lugar foi outra coisa, e maior: 295 números que o NOSSO
-- robô imprimiu em 226 grupos onde nenhum cliente ligado ao grupo tem aquele
-- processo cadastrado. O robô sabia o número — ele veio de algum sistema
-- nosso. O CRM é que não sabe de quem é.
--
-- O QUE NÃO É — retirando um alarme que eu mesmo levantei
-- Parecia vazamento entre clientes: o processo do cliente B citado no grupo do
-- cliente A. Não é. Conferido pelo cumprimento das mensagens, que trazem o
-- nome de quem está sendo atendido:
--
--     grupo "CASO 337 | Osvaldo"   →  "*Bom dia Sr(a). OSVALDO*"
--     grupo "PREV 253 | MARILDA"   →  "*Boa tarde Sr(a). MARILDA RUFINO*"
--     grupo "prev 69 Antônio"      →  "*Boa tarde Sr(a). ANTONIO BEZERRA*"
--
-- A mensagem está no grupo certo, falando com a pessoa certa, do processo
-- certo. Quem está errado é o CADASTRO: o grupo aponta para uma linha de
-- `leads` e o processo está em outra linha da mesma pessoa.
--
-- (O único par que restou suspeito — PREV 513 citando processo de PREV 408 —
-- caiu ao ler a mensagem inteira: ela lista dois números, e o do cabeçalho é o
-- correto. Não há evidência de vazamento nestes dados.)
--
-- AS CINCO CLASSES, MEDIDAS EM 07/09/2026 SOBRE OS 295
--
--   1. processo não existe em lead_processes    81 pares ·  75 grupos ·   985 msgs
--   2. grupo sem cliente vinculado             169 pares · 127 grupos · 4.344 msgs
--   3. ficha paralela do MESMO caso             17 pares ·  15 grupos ·   321 msgs
--   4. a conferir (nome sem código)             14 pares ·  13 grupos ·   146 msgs
--   5. número de caso diferente                 14 pares ·  12 grupos ·   122 msgs
--
-- A classe 2 é o grosso e a mais acionável: 127 grupos que o robô atende
-- ativamente — 4.344 mensagens — e que o CRM não liga a cliente nenhum. O
-- processo citado TEM dono em `lead_processes`; falta a linha em
-- `lead_whatsapp_groups`.
--
-- POR QUE UMA VIEW, E NÃO UM CONSERTO AUTOMÁTICO
-- Escrever o vínculo é mexer em ficha de cliente com base em texto de
-- WhatsApp. A classe 2 parece segura (o dono do processo é único e o grupo não
-- tem ninguém), mas "parece segura" não é o padrão para gravar em ficha. A
-- view roteia para a esteira de conserto e deixa a decisão com gente — que é a
-- diferença entre detector e filtro.
--
-- A comparação de caso usa `busca_chave_caso` e compara pelo NÚMERO, aceitando
-- família ausente de um dos lados. Comparar 'familia/numero' como texto foi o
-- erro da primeira tentativa: família nula envenenava a chave e 'CASO 337'
-- deixava de casar com o lead cujo case_number é só '337'.
-- =============================================================================

create or replace view public.vw_grupo_processo_desalinhado as
with base as (
  select d.group_jid, d.cnj, d.ocorrencias, d.primeira_msg_id, d.primeira_em, d.ultima_em,
         g.group_name, g.area,
         exists (select 1 from public.lead_whatsapp_groups lg
                  where public.jid_chave(lg.group_jid) = public.jid_chave(d.group_jid)) as grupo_tem_cliente,
         exists (select 1 from public.lead_processes p
                  where p.deleted_at is null
                    and public.cnj_digitos(p.process_number) = d.cnj) as processo_existe
    from public.grupo_processo_detectado d
    join public.dom_grupos_piloto g on g.group_jid = d.group_jid
   where d.status = 'eco_da_casa'
),
chaves as (
  select b.*,
         kg.numero as numero_do_grupo,
         (select array_agg(distinct kd.numero)
            from public.lead_processes p
            join public.leads l on l.id = p.lead_id,
            lateral public.busca_chave_caso(coalesce(l.case_number, l.lead_name, l.victim_name), false) kd
           where p.deleted_at is null
             and public.cnj_digitos(p.process_number) = b.cnj) as numeros_do_dono,
         (select string_agg(distinct coalesce(l.lead_name, l.victim_name), ' | ')
            from public.lead_processes p
            join public.leads l on l.id = p.lead_id
           where p.deleted_at is null
             and public.cnj_digitos(p.process_number) = b.cnj) as dono_do_processo,
         (select array_agg(distinct p.lead_id)
            from public.lead_processes p
           where p.deleted_at is null
             and public.cnj_digitos(p.process_number) = b.cnj) as leads_donos
    from base b
    left join lateral public.busca_chave_caso(b.group_name, false) kg on true
)
select
  c.group_jid,
  c.group_name,
  c.area,
  public.cnj_formatado(c.cnj) as processo,
  c.cnj,
  c.dono_do_processo,
  c.leads_donos,
  c.ocorrencias,
  c.primeira_msg_id,
  c.primeira_em,
  c.ultima_em,
  case
    when not c.processo_existe                                    then 'processo_orfao'
    when not c.grupo_tem_cliente                                  then 'grupo_sem_cliente'
    when c.numero_do_grupo is null or c.numeros_do_dono is null   then 'a_conferir'
    when c.numero_do_grupo = any(c.numeros_do_dono)               then 'ficha_paralela'
    else                                                               'caso_diferente'
  end as classe,
  -- O que fazer com a linha. Fica na view de propósito: quem abre a tela não
  -- deveria precisar reconstruir o raciocínio a cada vez.
  case
    when not c.processo_existe        then 'achar de onde o robo tirou esse numero (inss_admin_processes?) e cadastrar, ou marcar como erro'
    when not c.grupo_tem_cliente      then 'ligar o grupo ao dono do processo em lead_whatsapp_groups, apos conferir o nome'
    when c.numero_do_grupo is null or c.numeros_do_dono is null then 'conferir na mao: nome sem codigo de caso dos dois lados'
    when c.numero_do_grupo = any(c.numeros_do_dono) then 'mesma pessoa em duas fichas: fundir os leads ou apontar o grupo para a ficha do processo'
    else 'conferir: o numero de caso do grupo nao bate com o do dono do processo'
  end as o_que_fazer
from chaves c;

comment on view public.vw_grupo_processo_desalinhado is
  'Grupos onde o robo citou um processo que nenhum cliente do grupo tem cadastrado, classificado por causa provavel. Detector: nao altera nada.';

grant select on public.vw_grupo_processo_desalinhado to authenticated;

-- =============================================================================
-- ROLLBACK
-- drop view if exists public.vw_grupo_processo_desalinhado;
-- É uma view: não guarda dado e não altera nenhum. Derrubar não perde nada.
-- =============================================================================
