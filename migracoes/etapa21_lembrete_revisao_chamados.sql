-- =====================================================
-- ETAPA 21 · LEMBRETES DA ETAPA REVISÃO (mundo Chamados)
-- Projeto: Sistema de Gestão de Engenharia — Grupo Pirineus
--
-- Mesmo padrão das Etapas 19/20 (verificar_aprovacoes_pendentes): função de
-- banco SECURITY DEFINER, à prova de erro (cada envio dentro de
-- BEGIN/EXCEPTION WHEN OTHERS THEN NULL — a varredura nunca trava por causa
-- de um envio que falhou), chamando a MESMA edge function notificar-email
-- (mesma URL/Bearer de disparar_notificacao_email), agendada 1x/dia via
-- pg_cron, com prazos lidos de config_prazos (fallback para os defaults).
--
-- Regras:
--   X = dias_lembrete_revisao (padrão 2) dias em Revisão -> 1º lembrete, só
--       ao solicitante, com botão que abre direto o chamado (?chamado=<id>).
--   A partir do 2º lembrete -> solicitante + cópia ao(s) gestor(es). Quem
--       decide "é o 2º" é o contador revisao_lembretes_enviados, enviado no
--       payload como "aviso"; a edge function só lê.
--   Cadência: no máximo 1 lembrete a cada intervalo_lembrete_revisao_dias
--       (padrão 2) por chamado, controlada por revisao_ultimo_lembrete_em.
--   Para sozinha quando o chamado sai de 'revisao' (concluído ou devolvido
--       para correção) — a query filtra status = 'revisao', e a trigger
--       zera o controle na saída.
--
-- MARCO DE TEMPO (de onde vem a data de entrada em Revisão):
--   - chamados NÃO tem coluna própria para isso. O único registro é
--     historico_status (status_novo = 'revisao', criado_em), gravado pelo
--     front (moverStatus em mundos/chamados/chamados.js) num INSERT SEPARADO,
--     depois do UPDATE de status — não é atômico (se o INSERT falhar, a
--     entrada em revisão fica sem registro) e não é escrito por trigger.
--   - Por isso esta etapa cria chamados.revisao_desde, preenchida por
--     trigger BEFORE ... OF status na própria tabela (sempre consistente com
--     o status), e usa historico_status SÓ no backfill único dos chamados que
--     já estão em revisão hoje (fallback NOW() se não houver registro).
--   - Confirme no banco antes de rodar (consultas na seção VERIFICAÇÃO, bloco
--     "antes de aplicar").
--
-- Efeito colateral conhecido (inofensivo): se a trigger de e-mail de
-- chamados (disparar_notificacao_email) for AFTER UPDATE sem "OF status", os
-- UPDATEs de controle feitos aqui (backfill e marcação de lembrete enviado)
-- chamam a edge function com status inalterado — ela responde "status
-- inalterado" e não envia nada (ramo `table === 'chamados'`, já existente).
--
-- Não cria nem altera RLS: a função ignora RLS por ser SECURITY DEFINER; as
-- colunas novas de config_prazos herdam as policies da Etapa 20 (leitura
-- autenticado, escrita só master).
--
-- Como aplicar: revisar, substituir o Bearer placeholder e rodar inteiro no
-- SQL Editor. Idempotente (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE +
-- DROP TRIGGER IF EXISTS + unschedule antes de schedule + backfill só onde
-- revisao_desde IS NULL + flag só se não existir).
-- =====================================================


-- =====================================================
-- 1. PRAZOS CONFIGURÁVEIS — duas colunas novas na linha única de
-- config_prazos (Etapa 20). Editáveis pelo master em Administração →
-- Configurações → "Chamados: Revisão".
-- =====================================================

ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS dias_lembrete_revisao INT NOT NULL DEFAULT 2 CHECK (dias_lembrete_revisao > 0);
ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS intervalo_lembrete_revisao_dias INT NOT NULL DEFAULT 2 CHECK (intervalo_lembrete_revisao_dias > 0);


-- =====================================================
-- 2. MARCO + CONTROLE DE ENVIO em chamados
--   revisao_desde               — entrada na revisão ATUAL (trigger abaixo)
--   revisao_lembretes_enviados  — quantos lembretes já saíram nesta revisão
--                                 (0 = nenhum; o próximo é o nº contador+1;
--                                 >= 1 enviado => o próximo vai com cópia)
--   revisao_ultimo_lembrete_em  — quando saiu o último (régua do intervalo)
-- Os três zeram a cada nova entrada em revisão (ex.: correção -> execução ->
-- revisão de novo), então a régua recomeça do 1º aviso, só ao solicitante.
-- =====================================================

ALTER TABLE chamados ADD COLUMN IF NOT EXISTS revisao_desde timestamptz;
ALTER TABLE chamados ADD COLUMN IF NOT EXISTS revisao_lembretes_enviados int NOT NULL DEFAULT 0;
ALTER TABLE chamados ADD COLUMN IF NOT EXISTS revisao_ultimo_lembrete_em timestamptz;


-- =====================================================
-- 3. TRIGGER — preenche/zera o marco quando o status muda.
-- BEFORE (altera NEW, sem UPDATE extra) e só "OF status": os UPDATEs de
-- controle da varredura (seção 6), que não mexem em status, não disparam
-- esta trigger. Compara status::text para não depender do tipo da coluna
-- (enum ou text).
-- =====================================================

CREATE OR REPLACE FUNCTION marcar_revisao_chamado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'revisao' THEN
    IF TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'revisao' THEN
      NEW.revisao_desde := NOW();
      NEW.revisao_lembretes_enviados := 0;
      NEW.revisao_ultimo_lembrete_em := NULL;
    END IF;
  ELSE
    -- Saiu de revisão (concluído, correção, reaberto...): zera o controle.
    NEW.revisao_desde := NULL;
    NEW.revisao_lembretes_enviados := 0;
    NEW.revisao_ultimo_lembrete_em := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_marcar_revisao_chamado ON chamados;
CREATE TRIGGER trg_marcar_revisao_chamado
  BEFORE INSERT OR UPDATE OF status ON chamados
  FOR EACH ROW EXECUTE FUNCTION marcar_revisao_chamado();


-- =====================================================
-- 4. BACKFILL — chamados que JÁ estão em revisão quando esta etapa roda.
-- Usa a última entrada em revisão registrada em historico_status; sem
-- registro, NOW() (a régua começa hoje, em vez de disparar por uma data
-- inventada). Chamados antigos parados há mais de X dias recebem o 1º
-- lembrete já na primeira varredura — é o comportamento esperado.
-- =====================================================

UPDATE chamados c
SET revisao_desde = COALESCE(
  (SELECT MAX(h.criado_em) FROM historico_status h
    WHERE h.chamado_id = c.id AND h.status_novo::text = 'revisao'),
  NOW())
WHERE c.status::text = 'revisao'
  AND c.revisao_desde IS NULL;


-- =====================================================
-- 5. FLAG em config_notificacoes — ativa por padrão. flagAtivo() da edge
-- function já trata linha ausente como ativa; a linha existe para poder ser
-- desligada sem deploy (UPDATE ... SET ativo = false). Envolvida em bloco
-- próprio: se config_notificacoes tiver outra coluna obrigatória, só avisa
-- (o lembrete continua funcionando pelo default da edge function).
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config_notificacoes WHERE evento = 'chamado_lembrete_revisao') THEN
    INSERT INTO config_notificacoes (evento, ativo) VALUES ('chamado_lembrete_revisao', true);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Não foi possível inserir a flag chamado_lembrete_revisao em config_notificacoes (%). O lembrete segue ativo pelo default da edge function.', SQLERRM;
END $$;


-- =====================================================
-- 6. FUNÇÃO DE VARREDURA
-- "dias_em_revisao" = dias corridos inteiros desde revisao_desde.
-- Tolerância de 1 hora na régua do intervalo: o cron roda sempre no mesmo
-- horário, mas NOW() de cada execução varia alguns milissegundos/segundos;
-- sem a folga, um envio feito às 10:00:00.5 faria a execução de 2 dias
-- depois, às 10:00:00.3, pular o lembrete por "ainda não deu 2 dias" e só
-- mandar no dia seguinte.
-- =====================================================

CREATE OR REPLACE FUNCTION verificar_revisoes_pendentes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  dias_em_revisao int;
  v_dias_lembrete int;
  v_intervalo int;
BEGIN
  SELECT
    COALESCE((SELECT dias_lembrete_revisao FROM config_prazos WHERE id = 1), 2),
    COALESCE((SELECT intervalo_lembrete_revisao_dias FROM config_prazos WHERE id = 1), 2)
  INTO v_dias_lembrete, v_intervalo;

  FOR r IN
    SELECT c.id, c.codigo, c.titulo, c.solicitante_id, c.revisao_desde,
           c.revisao_lembretes_enviados, c.revisao_ultimo_lembrete_em
    FROM chamados c
    WHERE c.status::text = 'revisao'
      AND c.revisao_desde IS NOT NULL
      AND c.revisao_desde <= NOW() - make_interval(days => v_dias_lembrete)
      AND (c.revisao_ultimo_lembrete_em IS NULL
           OR c.revisao_ultimo_lembrete_em <= NOW() - make_interval(days => v_intervalo) + INTERVAL '1 hour')
  LOOP
    dias_em_revisao := FLOOR(EXTRACT(EPOCH FROM (NOW() - r.revisao_desde)) / 86400)::int;

    BEGIN
      PERFORM net.http_post(
        url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          -- Mesmo Bearer usado em disparar_notificacao_email() — não
          -- versionado aqui de propósito (GitHub bloqueia push com segredo
          -- exposto). Antes de rodar, substitua pelo mesmo valor que está
          -- naquela função (Dashboard > Database Functions, ou
          -- SELECT pg_get_functiondef('disparar_notificacao_email'::regproc)).
          'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
        ),
        body := jsonb_build_object(
          'type', 'CRON', 'table', 'lembrete_revisao_chamado', 'schema', 'public',
          'record', jsonb_build_object(
            'chamado_id', r.id, 'codigo', r.codigo, 'titulo', r.titulo,
            'solicitante_id', r.solicitante_id, 'dias', dias_em_revisao,
            -- nº deste aviso: 1 = só solicitante; >= 2 = com cópia aos gestores
            'aviso', r.revisao_lembretes_enviados + 1
          ),
          'old_record', null
        )
      );
      UPDATE chamados
      SET revisao_lembretes_enviados = r.revisao_lembretes_enviados + 1,
          revisao_ultimo_lembrete_em = NOW()
      WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- a varredura nunca pode travar por causa de um envio que falhou
    END;
  END LOOP;
END;
$function$;


-- =====================================================
-- 7. AGENDAMENTO (pg_cron) — 1x/dia às 10h (fuso do banco, normalmente
-- UTC — depois de verificar_vencimento_pai às 8h e
-- verificar_aprovacoes_pendentes às 9h, para não competir pela mesma
-- janela). Sem pg_cron, só avisa via RAISE NOTICE (mesmas alternativas da
-- Etapa 9).
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-revisoes-pendentes';
    PERFORM cron.schedule('verificar-revisoes-pendentes', '0 10 * * *', 'SELECT verificar_revisoes_pendentes();');
  ELSE
    RAISE NOTICE 'pg_cron não está habilitado neste projeto — verificar_revisoes_pendentes() está pronta, mas precisa ser agendada por outro meio (ver comentário da Seção 4 de etapa9_previsao_conclusao.sql).';
  END IF;
END $$;


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- Antes de aplicar — confirmar que não existe coluna/trigger de marco já
-- pronta em chamados (esperado: nenhuma coluna de "revisão desde"; só a
-- trigger de e-mail):
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chamados' ORDER BY ordinal_position;
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'chamados'::regclass AND NOT tgisinternal;
--   SELECT c.codigo, (SELECT MAX(h.criado_em) FROM historico_status h WHERE h.chamado_id = c.id AND h.status_novo::text = 'revisao') AS entrou_em_revisao
--     FROM chamados c WHERE c.status::text = 'revisao'; -- linhas com null = sem registro no histórico (backfill usa NOW())
--
-- Depois de aplicar:
--   SELECT dias_lembrete_revisao, intervalo_lembrete_revisao_dias FROM config_prazos WHERE id = 1; -- 2 / 2
--   SELECT codigo, status, revisao_desde, revisao_lembretes_enviados, revisao_ultimo_lembrete_em FROM chamados WHERE status::text = 'revisao';
--   SELECT * FROM config_notificacoes WHERE evento = 'chamado_lembrete_revisao';
--   SELECT * FROM cron.job WHERE jobname = 'verificar-revisoes-pendentes'; -- só existe se pg_cron estiver ativo
--   SELECT verificar_revisoes_pendentes(); -- roda manualmente, pra testar sem esperar o agendador
--
-- Simular (só em homologação — NÃO rodar em produção) um chamado há 2 e
-- depois há 4 dias em Revisão:
--   -- dia 2: 1º aviso, só ao solicitante
--   UPDATE chamados SET revisao_desde = NOW() - INTERVAL '2 days', revisao_lembretes_enviados = 0, revisao_ultimo_lembrete_em = NULL WHERE id = '<uuid>';
--   SELECT verificar_revisoes_pendentes();
--   SELECT revisao_lembretes_enviados FROM chamados WHERE id = '<uuid>'; -- 1
--   -- dia 4: recua o relógio do chamado em mais 2 dias (marco e último envio)
--   UPDATE chamados SET revisao_desde = revisao_desde - INTERVAL '2 days', revisao_ultimo_lembrete_em = revisao_ultimo_lembrete_em - INTERVAL '2 days' WHERE id = '<uuid>';
--   SELECT verificar_revisoes_pendentes(); -- 2º aviso, com cópia ao(s) gestor(es)
--   SELECT revisao_lembretes_enviados FROM chamados WHERE id = '<uuid>'; -- 2
--   -- rodar de novo no mesmo dia não envia nada (intervalo)

-- =====================================================
-- ROLLBACK
--   DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-revisoes-pendentes';
--   END IF; END $$;
--   DROP FUNCTION IF EXISTS verificar_revisoes_pendentes();
--   DROP TRIGGER IF EXISTS trg_marcar_revisao_chamado ON chamados;
--   DROP FUNCTION IF EXISTS marcar_revisao_chamado();
--   DELETE FROM config_notificacoes WHERE evento = 'chamado_lembrete_revisao';
--   ALTER TABLE chamados DROP COLUMN IF EXISTS revisao_desde;
--   ALTER TABLE chamados DROP COLUMN IF EXISTS revisao_lembretes_enviados;
--   ALTER TABLE chamados DROP COLUMN IF EXISTS revisao_ultimo_lembrete_em;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS dias_lembrete_revisao;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS intervalo_lembrete_revisao_dias;
-- =====================================================
