-- =====================================================
-- ETAPA 20 · PRAZOS DE COMUNICAÇÃO CONFIGURÁVEIS PELO MASTER
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Tira do código os prazos hoje fixos e os move para uma tabela de
-- configuração única (singleton), editável pelo master em Administração →
-- Prazos de Comunicação:
--   - lembrete ao aprovador  (Etapa 19, era 2 dias fixos)
--   - escalonamento ao master (Etapa 19, era 4 dias fixos)
--   - intervalo de repetição  (Etapa 19, era 2 dias fixos)
--   - aviso de vencimento da obra (Etapa 9, era 7 dias fixos)
--
-- verificar_aprovacoes_pendentes() (Etapa 19) e verificar_vencimento_pai()
-- (Etapa 9) passam a LER esses 4 valores de config_prazos em vez das
-- constantes '2 days'/'4 days'/'7 days' — com fallback para os mesmos
-- defaults de sempre (2/4/2/7) se a linha não existir, então nada muda de
-- comportamento até o master editar algo. Nenhuma outra parte das duas
-- funções foi alterada (mesmos FOR, mesmo BEGIN/EXCEPTION WHEN OTHERS THEN
-- NULL por envio, mesmo net.http_post) — reproduzo a função inteira porque
-- CREATE OR REPLACE FUNCTION exige o corpo completo, não um diff.
--
-- Não mexe em RLS existente de nenhuma outra tabela — só cria a RLS nova de
-- config_prazos (leitura ampla, escrita só master).
--
-- Como aplicar: revisar e rodar inteiro no SQL Editor. Idempotente
-- (CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING +
-- DROP POLICY IF EXISTS/CREATE POLICY + CREATE OR REPLACE FUNCTION).
-- =====================================================


-- =====================================================
-- 1. TABELA — singleton (id fixo = 1, CHECK garante que nunca existe uma
-- segunda linha). atualizado_por é quem editou por último, para auditoria
-- simples na própria tela.
-- =====================================================

CREATE TABLE IF NOT EXISTS config_prazos (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dias_lembrete_aprovador    INT NOT NULL DEFAULT 2 CHECK (dias_lembrete_aprovador > 0),
  dias_escalonamento_master  INT NOT NULL DEFAULT 4 CHECK (dias_escalonamento_master > 0),
  intervalo_repeticao_dias   INT NOT NULL DEFAULT 2 CHECK (intervalo_repeticao_dias > 0),
  dias_aviso_vencimento      INT NOT NULL DEFAULT 7 CHECK (dias_aviso_vencimento > 0),
  atualizado_em              TIMESTAMPTZ,
  atualizado_por             UUID REFERENCES usuarios(id),
  CONSTRAINT config_prazos_escalonamento_maior_lembrete CHECK (dias_escalonamento_master > dias_lembrete_aprovador)
);

-- Semeia a linha única com os defaults atuais — para nada mudar de
-- comportamento até o master editar pela tela.
INSERT INTO config_prazos (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- =====================================================
-- 2. RLS — leitura para todo autenticado (a função de varredura já ignora
-- RLS por ser SECURITY DEFINER; isto é só para a tela do master conseguir
-- ler/gravar pelo client normal), escrita só para master.
-- =====================================================

ALTER TABLE config_prazos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_prazos_leitura ON config_prazos;
CREATE POLICY config_prazos_leitura ON config_prazos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS config_prazos_escrita ON config_prazos;
CREATE POLICY config_prazos_escrita ON config_prazos FOR ALL TO authenticated
USING (is_master())
WITH CHECK (is_master());


-- =====================================================
-- 3. verificar_aprovacoes_pendentes() (Etapa 19) — mesma função, agora lendo
-- os 3 prazos de config_prazos em vez das constantes '2 days'/'4 days'.
-- Corpo completo reproduzido (CREATE OR REPLACE exige a função inteira).
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
  v_dias_lembrete int;
  v_dias_escalonamento int;
  v_intervalo_repeticao int;
BEGIN
  SELECT
    COALESCE((SELECT dias_lembrete_aprovador FROM config_prazos WHERE id = 1), 2),
    COALESCE((SELECT dias_escalonamento_master FROM config_prazos WHERE id = 1), 4),
    COALESCE((SELECT intervalo_repeticao_dias FROM config_prazos WHERE id = 1), 2)
  INTO v_dias_lembrete, v_dias_escalonamento, v_intervalo_repeticao;

  -- ===== PAI (passos_aprovacao) =====
  FOR r IN
    SELECT pa.id AS passo_id, pa.pai_id, pa.etapa, pa.ordem, pa.criado_em,
           pa.lembrete_enviado_em, pa.escalonamento_enviado_em,
           p.numero, p.titulo, p.empresa_id, p.setor_id
    FROM passos_aprovacao pa
    JOIN pais p ON p.id = pa.pai_id
    WHERE pa.decisao = 'pendente'
      AND pa.criado_em <= NOW() - make_interval(days => v_dias_lembrete)
  LOOP
    dias_parados := FLOOR(EXTRACT(EPOCH FROM (NOW() - r.criado_em)) / 86400)::int;

    -- Lembrete ao titular da fila (X dias; repete no máx. 1x por intervalo)
    IF dias_parados >= v_dias_lembrete AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao)) THEN
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

    -- Escalonamento ao(s) master(es) (Y dias; repete no máx. 1x por intervalo)
    IF dias_parados >= v_dias_escalonamento AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao)) THEN
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
      AND pa.criado_em <= NOW() - make_interval(days => v_dias_lembrete)
  LOOP
    dias_parados := FLOOR(EXTRACT(EPOCH FROM (NOW() - r.criado_em)) / 86400)::int;

    IF dias_parados >= v_dias_lembrete AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao)) THEN
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

    IF dias_parados >= v_dias_escalonamento AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao)) THEN
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
-- 4. verificar_vencimento_pai() (Etapa 9) — mesma função, agora lendo
-- dias_aviso_vencimento de config_prazos em vez de '7 days' fixo (a mesma
-- variável cobre tanto a janela "faltam <= N dias" quanto a cadência de
-- repetição — exatamente o papel duplo que o '7 days' já tinha antes).
-- =====================================================

CREATE OR REPLACE FUNCTION verificar_vencimento_pai()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_dias_aviso int;
BEGIN
  v_dias_aviso := COALESCE((SELECT dias_aviso_vencimento FROM config_prazos WHERE id = 1), 7);

  FOR r IN
    SELECT id, numero, titulo, previsao_conclusao
    FROM pais
    WHERE previsao_conclusao IS NOT NULL
      AND status <> 'encerrado'
      AND previsao_conclusao <= CURRENT_DATE + make_interval(days => v_dias_aviso)
      AND (aviso_vencimento_enviado_em IS NULL OR aviso_vencimento_enviado_em <= NOW() - make_interval(days => v_dias_aviso))
  LOOP
    BEGIN
      PERFORM net.http_post(
        url := 'https://oklglgvhlqixzxngbsvw.supabase.co/functions/v1/notificar-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer SUBSTITUA_PELO_MESMO_BEARER_DE_disparar_notificacao_email'
        ),
        body := jsonb_build_object(
          'type', 'CRON',
          'table', 'aviso_vencimento_pai',
          'schema', 'public',
          'record', to_jsonb(r),
          'old_record', null
        )
      );
      UPDATE pais SET aviso_vencimento_enviado_em = NOW() WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- a varredura nunca pode travar por causa de um envio que falhou
    END;
  END LOOP;
END;
$function$;


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT * FROM config_prazos; -- deve ter exatamente 1 linha, com 2/4/2/7
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'config_prazos';
-- SELECT proname FROM pg_proc WHERE proname IN ('verificar_aprovacoes_pendentes','verificar_vencimento_pai');
--
-- Testar que o master consegue editar e um não-master é barrado pela RLS
-- (rodar como o próprio usuário, não como service role):
--   UPDATE config_prazos SET dias_lembrete_aprovador = 3 WHERE id = 1; -- master: ok / outro papel: 0 linhas afetadas
--
-- Testar que a função de varredura respeita o valor novo (mesmo teste
-- manual descrito em etapa19_lembretes_aprovacao.sql, mudando o prazo
-- antes):
--   UPDATE config_prazos SET dias_lembrete_aprovador = 1 WHERE id = 1;
--   UPDATE passos_aprovacao SET criado_em = NOW() - INTERVAL '1 day', lembrete_enviado_em = NULL WHERE id = '<uuid do passo>';
--   SELECT verificar_aprovacoes_pendentes(); -- deve disparar o lembrete com dias_lembrete=1 em vez de 2

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS config_prazos_leitura ON config_prazos;
--   DROP POLICY IF EXISTS config_prazos_escrita ON config_prazos;
--   DROP TABLE IF EXISTS config_prazos;
--   -- e restaurar verificar_aprovacoes_pendentes()/verificar_vencimento_pai()
--   -- para as versões de etapa19_lembretes_aprovacao.sql / etapa9_previsao_conclusao.sql
--   -- (constantes '2 days'/'4 days'/'7 days' em vez de config_prazos).
-- =====================================================
