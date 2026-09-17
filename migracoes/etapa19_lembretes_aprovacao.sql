-- =====================================================
-- ETAPA 19 · LEMBRETES E ESCALONAMENTO POR INATIVIDADE (mundo Investimentos)
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Reaproveita o MESMO padrão da Etapa 9 (verificar_vencimento_pai): uma
-- função de banco SECURITY DEFINER, à prova de erro (cada envio dentro de
-- BEGIN/EXCEPTION WHEN OTHERS THEN NULL — a varredura nunca trava por causa
-- de um envio que falhou), chamando a MESMA edge function notificar-email
-- (mesma URL/Bearer de disparar_notificacao_email), agendada 1x/dia via
-- pg_cron. Não cria RLS nova — a função ignora RLS por ser SECURITY
-- DEFINER, e nenhuma policy existente foi tocada.
--
-- Regras (Parte 2 do pedido):
--   X = 2 dias sem decisão no passo pendente atual -> lembrete ao titular
--       da fila daquela etapa (mesma resolução de destinatário já usada
--       pelos e-mails de fila da Etapa 9: papel global para
--       controladoria_op/diretor_ceo, alcada_por_setor para
--       aprovador/diretor).
--   Y = 4 dias sem decisão -> escalonamento ao(s) master(es).
--   Cadência: no máximo 1 envio a cada 2 dias POR PASSO e por tipo de
--       envio (lembrete e escalonamento têm cada um sua própria régua,
--       controlada pela sua própria coluna de "último envio") — por isso
--       DUAS colunas novas por tabela, não uma.
--   Só dispara enquanto o passo segue com decisao='pendente' — ao
--       aprovar/devolver/reprovar a query para de encontrar a linha
--       (filtro WHERE decisao = 'pendente'), então cessa sozinho, sem
--       precisar limpar nada.
--   Vale para PAI (passos_aprovacao) e Aumento de Verba (passos_aumento) —
--       dois FOR dentro da mesma função, mesma lógica, tabelas diferentes.
--
-- A Parte 1 do pedido (e-mail de confirmação de criação do PAI ao
-- solicitante) NÃO precisa de SQL novo — reaproveita a trigger já existente
-- em `pais` (AFTER INSERT OR UPDATE, Etapa 9, trg_notif_pais) chamando a
-- MESMA disparar_notificacao_email(); só a edge function ganhou os ramos
-- novos para reconhecer o evento (ver supabase/functions/notificar-email/
-- index.ts nesta branch).
--
-- Como aplicar: revisar e rodar inteiro no SQL Editor. Idempotente
-- (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION + unschedule antes
-- de schedule).
-- =====================================================


-- =====================================================
-- 1. COLUNAS NOVAS — "último envio" de cada tipo, por passo pendente.
-- Ficam null enquanto o passo nunca recebeu aquele tipo de aviso; ao
-- reabrir um novo passo (nova linha, nova ordem — ex.: reenvio após
-- devolução, ou avanço para a próxima etapa), a linha nasce com as duas
-- colunas null de novo, então a régua de 2/4 dias recomeça do zero para
-- aquele passo — é o comportamento esperado (o "parado há N dias" é do
-- passo atual, não do PAI/Aumento como um todo).
-- =====================================================

ALTER TABLE passos_aprovacao ADD COLUMN IF NOT EXISTS lembrete_enviado_em timestamptz;
ALTER TABLE passos_aprovacao ADD COLUMN IF NOT EXISTS escalonamento_enviado_em timestamptz;

ALTER TABLE passos_aumento ADD COLUMN IF NOT EXISTS lembrete_enviado_em timestamptz;
ALTER TABLE passos_aumento ADD COLUMN IF NOT EXISTS escalonamento_enviado_em timestamptz;


-- =====================================================
-- 2. FUNÇÃO DE VARREDURA
-- Um FOR para passos_aprovacao (PAI) e outro para passos_aumento (Aumento)
-- dentro da mesma função — mesma lógica, tabelas/colunas diferentes.
-- "dias_parados" = dias corridos inteiros desde criado_em do passo pendente
-- atual (a entrada nesse passo — não desde a abertura do PAI/Aumento).
-- =====================================================

CREATE OR REPLACE FUNCTION verificar_aprovacoes_pendentes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  dias_parados int;
BEGIN
  -- ===== PAI (passos_aprovacao) =====
  FOR r IN
    SELECT pa.id AS passo_id, pa.pai_id, pa.etapa, pa.ordem, pa.criado_em,
           pa.lembrete_enviado_em, pa.escalonamento_enviado_em,
           p.numero, p.titulo, p.empresa_id, p.setor_id
    FROM passos_aprovacao pa
    JOIN pais p ON p.id = pa.pai_id
    WHERE pa.decisao = 'pendente'
      AND pa.criado_em <= NOW() - INTERVAL '2 days'
  LOOP
    dias_parados := FLOOR(EXTRACT(EPOCH FROM (NOW() - r.criado_em)) / 86400)::int;

    -- Lembrete ao titular da fila (X = 2 dias; repete no máx. 1x/2 dias)
    IF dias_parados >= 2 AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - INTERVAL '2 days') THEN
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
            'type', 'CRON', 'table', 'lembrete_aprovacao_pai', 'schema', 'public',
            'record', jsonb_build_object(
              'passo_id', r.passo_id, 'pai_id', r.pai_id, 'etapa', r.etapa, 'ordem', r.ordem,
              'dias', dias_parados, 'numero', r.numero, 'titulo', r.titulo,
              'empresa_id', r.empresa_id, 'setor_id', r.setor_id
            ),
            'old_record', null
          )
        );
        UPDATE passos_aprovacao SET lembrete_enviado_em = NOW() WHERE id = r.passo_id;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- a varredura nunca pode travar por causa de um envio que falhou
      END;
    END IF;

    -- Escalonamento ao(s) master(es) (Y = 4 dias; repete no máx. 1x/2 dias)
    IF dias_parados >= 4 AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - INTERVAL '2 days') THEN
      BEGIN
        PERFORM net.http_post(
          url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
          ),
          body := jsonb_build_object(
            'type', 'CRON', 'table', 'escalonamento_aprovacao_pai', 'schema', 'public',
            'record', jsonb_build_object(
              'passo_id', r.passo_id, 'pai_id', r.pai_id, 'etapa', r.etapa, 'ordem', r.ordem,
              'dias', dias_parados, 'numero', r.numero, 'titulo', r.titulo,
              'empresa_id', r.empresa_id, 'setor_id', r.setor_id
            ),
            'old_record', null
          )
        );
        UPDATE passos_aprovacao SET escalonamento_enviado_em = NOW() WHERE id = r.passo_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  -- ===== AUMENTO DE VERBA (passos_aumento) =====
  FOR r IN
    SELECT pa.id AS passo_id, pa.aumento_id, pa.etapa, pa.ordem, pa.criado_em,
           pa.lembrete_enviado_em, pa.escalonamento_enviado_em,
           a.numero, a.empresa_id, a.setor_id
    FROM passos_aumento pa
    JOIN aumentos_verba a ON a.id = pa.aumento_id
    WHERE pa.decisao = 'pendente'
      AND pa.criado_em <= NOW() - INTERVAL '2 days'
  LOOP
    dias_parados := FLOOR(EXTRACT(EPOCH FROM (NOW() - r.criado_em)) / 86400)::int;

    IF dias_parados >= 2 AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - INTERVAL '2 days') THEN
      BEGIN
        PERFORM net.http_post(
          url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
          ),
          body := jsonb_build_object(
            'type', 'CRON', 'table', 'lembrete_aprovacao_aumento', 'schema', 'public',
            'record', jsonb_build_object(
              'passo_id', r.passo_id, 'aumento_id', r.aumento_id, 'etapa', r.etapa, 'ordem', r.ordem,
              'dias', dias_parados, 'numero', r.numero, 'empresa_id', r.empresa_id, 'setor_id', r.setor_id
            ),
            'old_record', null
          )
        );
        UPDATE passos_aumento SET lembrete_enviado_em = NOW() WHERE id = r.passo_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    IF dias_parados >= 4 AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - INTERVAL '2 days') THEN
      BEGIN
        PERFORM net.http_post(
          url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
          ),
          body := jsonb_build_object(
            'type', 'CRON', 'table', 'escalonamento_aprovacao_aumento', 'schema', 'public',
            'record', jsonb_build_object(
              'passo_id', r.passo_id, 'aumento_id', r.aumento_id, 'etapa', r.etapa, 'ordem', r.ordem,
              'dias', dias_parados, 'numero', r.numero, 'empresa_id', r.empresa_id, 'setor_id', r.setor_id
            ),
            'old_record', null
          )
        );
        UPDATE passos_aumento SET escalonamento_enviado_em = NOW() WHERE id = r.passo_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END;
$function$;


-- =====================================================
-- 3. AGENDAMENTO (pg_cron) — roda 1x/dia às 9h (fuso do banco, normalmente
-- UTC — 1h depois de verificar_vencimento_pai, de propósito, para não
-- competir pela mesma janela). Só ativa se pg_cron já estiver habilitado
-- neste projeto; senão só avisa via RAISE NOTICE (mesmas 3 opções da
-- Etapa 9 valem aqui: habilitar a extensão, Edge Function com Scheduled
-- Trigger chamando a RPC, ou cron externo).
-- =====================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-aprovacoes-pendentes';
    PERFORM cron.schedule('verificar-aprovacoes-pendentes', '0 9 * * *', 'SELECT verificar_aprovacoes_pendentes();');
  ELSE
    RAISE NOTICE 'pg_cron não está habilitado neste projeto — verificar_aprovacoes_pendentes() está pronta, mas precisa ser agendada por outro meio (ver comentário da Seção 4 de etapa9_previsao_conclusao.sql).';
  END IF;
END $$;


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name IN ('passos_aprovacao','passos_aumento') AND column_name LIKE '%enviado_em';
-- SELECT proname FROM pg_proc WHERE proname = 'verificar_aprovacoes_pendentes';
-- SELECT * FROM cron.job WHERE jobname = 'verificar-aprovacoes-pendentes'; -- só existe se pg_cron estiver ativo
-- SELECT verificar_aprovacoes_pendentes(); -- roda manualmente, pra testar sem esperar o agendador
--
-- Simular um passo "parado" sem esperar dias de verdade (só para teste em
-- ambiente de homologação — NÃO rodar em produção): recue o criado_em de um
-- passo pendente específico, rode a função manualmente e confira o e-mail:
--   UPDATE passos_aprovacao SET criado_em = NOW() - INTERVAL '2 days', lembrete_enviado_em = NULL, escalonamento_enviado_em = NULL WHERE id = '<uuid do passo>';
--   SELECT verificar_aprovacoes_pendentes(); -- deve disparar o lembrete
--   UPDATE passos_aprovacao SET criado_em = NOW() - INTERVAL '4 days', lembrete_enviado_em = NULL, escalonamento_enviado_em = NULL WHERE id = '<uuid do passo>';
--   SELECT verificar_aprovacoes_pendentes(); -- deve disparar lembrete + escalonamento

-- =====================================================
-- ROLLBACK
--   DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'verificar-aprovacoes-pendentes';
--   END IF; END $$;
--   DROP FUNCTION IF EXISTS verificar_aprovacoes_pendentes();
--   ALTER TABLE passos_aprovacao DROP COLUMN IF EXISTS lembrete_enviado_em;
--   ALTER TABLE passos_aprovacao DROP COLUMN IF EXISTS escalonamento_enviado_em;
--   ALTER TABLE passos_aumento DROP COLUMN IF EXISTS lembrete_enviado_em;
--   ALTER TABLE passos_aumento DROP COLUMN IF EXISTS escalonamento_enviado_em;
-- =====================================================
