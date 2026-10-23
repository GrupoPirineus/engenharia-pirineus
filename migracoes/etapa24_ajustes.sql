-- =====================================================
-- ETAPA 24 · AJUSTES (partes 3 e 4)
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Parte 3 — Folga de 1 hora na repetição dos lembretes da Etapa 19.
--   verificar_aprovacoes_pendentes() ganha a mesma tolerância de 1 hora no
--   intervalo de repetição que verificar_revisoes_pendentes() já usa desde
--   a Etapa 21. Sem ela, um envio feito às 10:00:00.5 faz a execução de
--   N dias depois, às 10:00:00.3, pular o lembrete ("ainda não deu N
--   dias") e só mandar no dia seguinte.
--   A função abaixo é a versão da Etapa 20 (lida de config_prazos) copiada
--   sem alterações, exceto as 4 condições de repetição (lembrete e
--   escalonamento, nos blocos de PAI e de Aumento), que ganham
--   "+ INTERVAL '1 hour'". O resto da função é idêntico.
--
-- Parte 4 — Data limite para abertura de PAI no ano em exercício.
--   config_prazos ganha dia_limite_abertura_pai / mes_limite_abertura_pai
--   (padrão 30/11, mesma validação de dia no mês da data de corte da Etapa
--   23). A partir do dia seguinte à data limite (Brasília, hoje_brasilia()
--   da Etapa 23), um trigger recusa:
--     - em pais: a mudança de status para 'em_critica' (envio novo e
--       primeiro envio de um rascunho);
--     - em aumentos_verba: o envio ('em_critica', que é como o pedido nasce);
--   quando o ano do plano (ano_calendario) é o ano em exercício. Salvar
--   rascunho continua livre. O plano do próximo exercício não é afetado.
--   EXCEÇÃO: o REENVIO de um item devolvido (status anterior 'devolvido')
--   continua liberado depois da data limite, nas duas tabelas.
--   Sem exceção por papel (nem master).
--
-- Depende da Etapa 20 (config_prazos) e da Etapa 23 (hoje_brasilia()).
-- Como aplicar: revisar e rodar inteiro no SQL Editor. Idempotente.
-- ANTES DE RODAR: troque o Bearer placeholder da função da seção 1 pelo
-- mesmo valor usado em disparar_notificacao_email() (igual às Etapas 19/20).
-- =====================================================


-- =====================================================
-- 1. verificar_aprovacoes_pendentes() — versão da Etapa 20 + folga de 1h
-- na repetição (4 linhas alteradas, marcadas pelo "+ INTERVAL '1 hour'").
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
    IF dias_parados >= v_dias_lembrete AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao) + INTERVAL '1 hour') THEN
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
    IF dias_parados >= v_dias_escalonamento AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao) + INTERVAL '1 hour') THEN
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

    IF dias_parados >= v_dias_lembrete AND (r.lembrete_enviado_em IS NULL OR r.lembrete_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao) + INTERVAL '1 hour') THEN
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

    IF dias_parados >= v_dias_escalonamento AND (r.escalonamento_enviado_em IS NULL OR r.escalonamento_enviado_em <= NOW() - make_interval(days => v_intervalo_repeticao) + INTERVAL '1 hour') THEN
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
-- 2. DATA LIMITE PARA ABERTURA DE PAI — colunas e validação
-- RLS de config_prazos não muda: leitura para autenticados, escrita só
-- master.
-- =====================================================

ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS dia_limite_abertura_pai SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS mes_limite_abertura_pai SMALLINT NOT NULL DEFAULT 11;

-- Dia válido para o mês (igual ao CHECK da data de corte, Etapa 23):
-- 29/02 não é aceito — a data limite precisa existir em todo ano.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_prazos_limite_abertura_pai_valido') THEN
    ALTER TABLE config_prazos ADD CONSTRAINT config_prazos_limite_abertura_pai_valido CHECK (
      CASE WHEN mes_limite_abertura_pai BETWEEN 1 AND 12
        THEN dia_limite_abertura_pai BETWEEN 1 AND EXTRACT(DAY FROM (make_date(2001, mes_limite_abertura_pai, 1) + INTERVAL '1 month' - INTERVAL '1 day'))::int
        ELSE FALSE
      END
    );
  END IF;
END $$;


-- =====================================================
-- 3. FUNÇÕES AUXILIARES
-- =====================================================

-- Data limite de abertura de PAI para o plano de p_ano (no próprio ano).
CREATE OR REPLACE FUNCTION data_limite_abertura_pai(p_ano int)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT make_date(
    p_ano,
    COALESCE((SELECT mes_limite_abertura_pai FROM config_prazos WHERE id = 1), 11),
    COALESCE((SELECT dia_limite_abertura_pai FROM config_prazos WHERE id = 1), 30)
  );
$$;

-- true quando p_ano é o ano em exercício e hoje (Brasília) já passou da
-- data limite. O plano do próximo exercício nunca cai aqui.
CREATE OR REPLACE FUNCTION abertura_pai_encerrada(p_ano int)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_ano = EXTRACT(YEAR FROM hoje_brasilia())::int
     AND hoje_brasilia() > data_limite_abertura_pai(p_ano);
$$;

GRANT EXECUTE ON FUNCTION data_limite_abertura_pai(int) TO authenticated;
GRANT EXECUTE ON FUNCTION abertura_pai_encerrada(int) TO authenticated;


-- =====================================================
-- 4. TRIGGER — recusa o envio depois da data limite
-- Uma função para as duas tabelas (ambas têm status e ano_calendario).
-- Só olha a TRANSIÇÃO para 'em_critica' — atualizações de um item que já
-- está em_critica (ex.: decisões da Controladoria) não são afetadas.
-- =====================================================

CREATE OR REPLACE FUNCTION bloquear_envio_apos_limite_abertura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Reenvio de item devolvido (devolvido -> em_critica) continua liberado
  -- depois da data limite: o PAI/aumento já tinha sido aberto no prazo.
  IF NEW.status::text = 'em_critica'
     AND (TG_OP = 'INSERT'
          OR (OLD.status IS DISTINCT FROM NEW.status AND OLD.status::text IS DISTINCT FROM 'devolvido'))
     AND abertura_pai_encerrada(NEW.ano_calendario) THEN
    RAISE EXCEPTION 'Prazo para abertura de PAI no exercício % encerrado em %',
      NEW.ano_calendario, to_char(data_limite_abertura_pai(NEW.ano_calendario), 'DD/MM');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pais_limite_abertura ON pais;
CREATE TRIGGER trg_pais_limite_abertura
  BEFORE INSERT OR UPDATE OF status ON pais
  FOR EACH ROW EXECUTE FUNCTION bloquear_envio_apos_limite_abertura();

DROP TRIGGER IF EXISTS trg_aumentos_verba_limite_abertura ON aumentos_verba;
CREATE TRIGGER trg_aumentos_verba_limite_abertura
  BEFORE INSERT OR UPDATE OF status ON aumentos_verba
  FOR EACH ROW EXECUTE FUNCTION bloquear_envio_apos_limite_abertura();


-- =====================================================
-- 5. VERIFICAÇÃO
-- =====================================================
-- 5a. Configuração: deve mostrar 30 / 11.
-- SELECT dia_limite_abertura_pai, mes_limite_abertura_pai FROM config_prazos WHERE id = 1;
-- SELECT data_limite_abertura_pai(2026);  -- 2026-11-30
-- SELECT abertura_pai_encerrada(2026), abertura_pai_encerrada(2027);
--   -- até 30/11/2026: false, false · a partir de 01/12/2026: true, false

-- 5b. Triggers criados?
-- SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE '%limite_abertura%';

-- 5c. Teste do bloqueio sem esperar a data (dentro de BEGIN ... ROLLBACK):
--   BEGIN;
--   UPDATE config_prazos SET dia_limite_abertura_pai = 1, mes_limite_abertura_pai = 1 WHERE id = 1;
--   UPDATE pais SET status = 'em_critica' WHERE id = '<rascunho do ano em exercício>';
--     → erro "Prazo para abertura de PAI no exercício 2026 encerrado em 01/01"
--   ROLLBACK;
--   BEGIN;
--   UPDATE config_prazos SET dia_limite_abertura_pai = 1, mes_limite_abertura_pai = 1 WHERE id = 1;
--   UPDATE pais SET status = 'em_critica' WHERE id = '<PAI devolvido do ano em exercício>';
--     → passa (reenvio de devolvido é liberado)
--   ROLLBACK;

-- 5d. Folga de 1h — a função ficou com as 4 condições novas?
-- SELECT (length(pg_get_functiondef('verificar_aprovacoes_pendentes'::regproc))
--       - length(replace(pg_get_functiondef('verificar_aprovacoes_pendentes'::regproc), 'INTERVAL ''1 hour''', '')))
--       / length('INTERVAL ''1 hour''') AS ocorrencias;  -- esperado 4

-- =====================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_pais_limite_abertura ON pais;
--   DROP TRIGGER IF EXISTS trg_aumentos_verba_limite_abertura ON aumentos_verba;
--   DROP FUNCTION IF EXISTS bloquear_envio_apos_limite_abertura();
--   DROP FUNCTION IF EXISTS abertura_pai_encerrada(int);
--   DROP FUNCTION IF EXISTS data_limite_abertura_pai(int);
--   ALTER TABLE config_prazos DROP CONSTRAINT IF EXISTS config_prazos_limite_abertura_pai_valido;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS dia_limite_abertura_pai;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS mes_limite_abertura_pai;
--   -- Folga de 1h: rodar de novo a seção 3 de etapa20_config_prazos.sql.
-- =====================================================
