-- =====================================================
-- ETAPA 23 · JANELA DE AJUSTE DO PLANO PUBLICADO
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Regra nova:
--   Um plano já publicado (status 'aprovado') pode ser ajustado pela
--   Controladoria Operacional (ou master) até a DATA DE CORTE: por padrão
--   31/12 do ano anterior ao ano do plano (plano 2027 → corte 31/12/2026).
--   Dia/mês do corte são configuráveis em Administração → Configurações →
--   "Calendário do Plano" (config_prazos.dia_corte_plano/mes_corte_plano).
--
--   Até o corte (inclusive), em linhas tipo 'planejada':
--     - alterar valor, descrição e setor;
--     - incluir linha nova;
--     - cancelar linha sem reserva.
--   Durante a janela o teto da área (teto_area_plano) ACOMPANHA os ajustes:
--   é recalculado como a soma das linhas ativas da área a cada ajuste.
--
--   A partir do dia seguinte ao corte vale a regra de antes (Etapa 6): o
--   teto fica congelado; linha da publicação não muda mais (só cancela, se
--   sem reserva); linha nova cabe só dentro do teto. Acréscimo de teto,
--   só por aumento de verba. Sem exceção — nem para o master (os triggers
--   não olham papel).
--
-- Proteções (valem em QUALQUER fase e plano — PAIs abertos na entressafra):
--   - nenhuma linha fica com valor menor que o já reservado nela;
--   - linha com reserva não muda de setor/área nem é cancelada/excluída;
--   - todo ajuste mantém teto da área ≥ reservado da área.
--
-- Auditoria: tabela ajustes_plano (sem e-mail). Toda alteração de linha
-- 'planejada' em plano publicado EXIGE motivo e gera registro.
--
-- COMO FUNCIONA NO BANCO
--   - O app grava ajustes de plano publicado só pelas funções
--     plano_incluir_linha / plano_alterar_linha / plano_cancelar_linha
--     (seção 5). Elas guardam o motivo em app.ajuste_motivo (válido só
--     dentro da transação) e fazem o INSERT/UPDATE em linhas_plano.
--   - Trigger BEFORE (seção 6) valida proteções, janela e motivo. Um
--     UPDATE direto na tabela (sem passar pelas funções) num plano
--     publicado é recusado por falta de motivo.
--   - Trigger AFTER (seção 7) grava ajustes_plano e recalcula o teto
--     (janela aberta) ou confere o teto congelado (depois do corte).
--
-- O QUE NÃO MUDA
--   - Linhas tipo 'aumento' (aplicar_efeito_aumento, Etapa 7) e
--     'devolucao' (encerramento, Etapa 8/15) seguem como antes: os
--     triggers só aplicam a elas as proteções de reserva, e só quando a
--     linha TEM reserva (devolução tem valor negativo e nunca tem reserva).
--   - Plano em rascunho: edição livre, sem auditoria (igual hoje).
--   - RLS de linhas_plano/teto_area_plano: intocada.
--
-- Como aplicar: backup → rodar inteiro no SQL Editor → verificações na
-- seção 9. Idempotente.
-- =====================================================


-- =====================================================
-- 1. CONFIGURAÇÃO DA DATA DE CORTE — duas colunas novas na linha única de
-- config_prazos (Etapa 20). RLS de config_prazos não muda: leitura para
-- autenticados, escrita só master.
-- =====================================================

ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS dia_corte_plano SMALLINT NOT NULL DEFAULT 31;
ALTER TABLE config_prazos ADD COLUMN IF NOT EXISTS mes_corte_plano SMALLINT NOT NULL DEFAULT 12;

-- Dia válido para o mês (29/02 não é aceito — o corte precisa existir em
-- todo ano). 2001 é só um ano não bissexto de referência.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_prazos_corte_plano_valido') THEN
    ALTER TABLE config_prazos ADD CONSTRAINT config_prazos_corte_plano_valido CHECK (
      CASE WHEN mes_corte_plano BETWEEN 1 AND 12
        THEN dia_corte_plano BETWEEN 1 AND EXTRACT(DAY FROM (make_date(2001, mes_corte_plano, 1) + INTERVAL '1 month' - INTERVAL '1 day'))::int
        ELSE FALSE
      END
    );
  END IF;
END $$;

-- Pendência futura (NÃO implementada aqui): "data limite para abertura de
-- PAI no ano em exercício" entra como outra coluna desta mesma linha.


-- =====================================================
-- 2. FUNÇÕES AUXILIARES
-- =====================================================

-- Hoje no fuso de Brasília (o servidor roda em UTC — sem isso, das 21h às
-- 24h do dia do corte a janela já apareceria fechada).
CREATE OR REPLACE FUNCTION hoje_brasilia()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

-- Data de corte do plano de p_ano = dia/mês configurados, no ano anterior.
CREATE OR REPLACE FUNCTION data_corte_plano(p_ano int)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT make_date(
    p_ano - 1,
    COALESCE((SELECT mes_corte_plano FROM config_prazos WHERE id = 1), 12),
    COALESCE((SELECT dia_corte_plano FROM config_prazos WHERE id = 1), 31)
  );
$$;

-- Reservado vivo de uma linha — mesma regra da view saldo_linhas (exclui
-- vínculo de PAI encerrado/reprovado/cancelado).
CREATE OR REPLACE FUNCTION reservado_linha_plano(p_linha_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(v.valor), 0)
  FROM vinculos_verba v
  JOIN pais pa ON pa.id = v.pai_id
  WHERE v.linha_id = p_linha_id
    AND pa.status <> ALL (ARRAY['encerrado'::status_pai, 'reprovado'::status_pai, 'cancelado'::status_pai]);
$$;

-- Formata valor para mensagem de erro ("R$ 150.000,00").
CREATE OR REPLACE FUNCTION fmt_reais(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'R$ ' || replace(replace(replace(to_char(COALESCE(p, 0), 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;


-- =====================================================
-- 3. AUDITORIA — ajustes_plano
-- Uma linha por campo alterado. valor_antes/valor_depois em texto (setor
-- gravado pelo NOME, valor como número — a tela formata).
-- =====================================================

CREATE TABLE IF NOT EXISTS ajustes_plano (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id      UUID NOT NULL REFERENCES planos_investimento(id) ON DELETE CASCADE,
  linha_id      UUID REFERENCES linhas_plano(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('inclusao', 'alteracao', 'cancelamento')),
  campo         TEXT NOT NULL,   -- 'setor' | 'descricao' | 'valor' | 'situacao'
  valor_antes   TEXT,
  valor_depois  TEXT,
  motivo        TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
  na_janela     BOOLEAN NOT NULL, -- true = dentro da janela de ajuste; false = depois do corte
  feito_por     UUID REFERENCES usuarios(id) DEFAULT auth.uid(),
  feito_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ajustes_plano_plano_idx ON ajustes_plano (plano_id, feito_em DESC);


-- =====================================================
-- 4. RLS — ajustes_plano
-- Leitura: autenticados. Escrita: controladoria_op e master — só INSERT,
-- e só em nome próprio. Sem policy de UPDATE/DELETE: o histórico é
-- imutável. (Na prática quem grava é o trigger da seção 7, SECURITY
-- DEFINER; a policy de INSERT existe para cumprir o requisito de escrita.)
-- =====================================================

ALTER TABLE ajustes_plano ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ajustes_plano_leitura ON ajustes_plano;
CREATE POLICY ajustes_plano_leitura ON ajustes_plano FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS ajustes_plano_insercao ON ajustes_plano;
CREATE POLICY ajustes_plano_insercao ON ajustes_plano FOR INSERT TO authenticated
WITH CHECK ((is_master() OR tem_papel('investimentos', 'controladoria_op')) AND feito_por = auth.uid());


-- =====================================================
-- 5. FUNÇÕES DE GRAVAÇÃO (chamadas pelo app via sb.rpc)
-- SECURITY INVOKER (padrão): a RLS de linhas_plano (Etapa 6 — escrita
-- só controladoria_op/master) continua valendo para quem chama.
-- =====================================================

CREATE OR REPLACE FUNCTION plano_incluir_linha(
  p_plano_id uuid, p_setor_id uuid, p_descricao text, p_valor numeric, p_motivo text
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_status text;
  v_id     uuid;
BEGIN
  IF NOT (is_master() OR tem_papel('investimentos', 'controladoria_op')) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o plano';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero';
  END IF;

  SELECT status::text INTO v_status FROM planos_investimento WHERE id = p_plano_id;
  IF v_status IS DISTINCT FROM 'aprovado' THEN
    RAISE EXCEPTION 'Esta função é só para plano publicado';
  END IF;

  PERFORM set_config('app.ajuste_motivo', btrim(p_motivo), true);
  INSERT INTO linhas_plano (plano_id, setor_id, descricao, valor, tipo)
  VALUES (p_plano_id, p_setor_id, COALESCE(btrim(p_descricao), ''), p_valor, 'planejada')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION plano_alterar_linha(
  p_linha_id uuid, p_setor_id uuid, p_descricao text, p_valor numeric, p_motivo text
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_linha linhas_plano%ROWTYPE;
BEGIN
  IF NOT (is_master() OR tem_papel('investimentos', 'controladoria_op')) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o plano';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste';
  END IF;

  SELECT * INTO v_linha FROM linhas_plano WHERE id = p_linha_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha não encontrada'; END IF;

  IF v_linha.setor_id IS NOT DISTINCT FROM p_setor_id
     AND v_linha.descricao IS NOT DISTINCT FROM COALESCE(btrim(p_descricao), '')
     AND v_linha.valor = p_valor THEN
    RAISE EXCEPTION 'Nada foi alterado';
  END IF;

  PERFORM set_config('app.ajuste_motivo', btrim(p_motivo), true);
  UPDATE linhas_plano
     SET setor_id = p_setor_id, descricao = COALESCE(btrim(p_descricao), ''), valor = p_valor
   WHERE id = p_linha_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sem permissão para alterar esta linha'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION plano_cancelar_linha(p_linha_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT (is_master() OR tem_papel('investimentos', 'controladoria_op')) THEN
    RAISE EXCEPTION 'Sem permissão para ajustar o plano';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  PERFORM set_config('app.ajuste_motivo', btrim(p_motivo), true);
  UPDATE linhas_plano
     SET cancelada = TRUE, cancelada_motivo = btrim(p_motivo), cancelada_por = auth.uid(), cancelada_em = NOW()
   WHERE id = p_linha_id AND cancelada IS NOT TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha não encontrada, já cancelada ou sem permissão'; END IF;
END;
$$;


-- =====================================================
-- 6. TRIGGER BEFORE — proteções + janela + motivo
-- =====================================================

CREATE OR REPLACE FUNCTION linhas_plano_validar_ajuste()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plano      planos_investimento%ROWTYPE;
  v_reservado  numeric := 0;
  v_cancelando boolean := false;
  v_corte      date;
  v_janela     boolean;
  v_motivo     text;
BEGIN
  -- ── Proteções de reserva: qualquer plano, qualquer tipo de linha ──
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_reservado := reservado_linha_plano(OLD.id);
    IF v_reservado > 0 THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Linha com reserva (%) não pode ser excluída', fmt_reais(v_reservado);
      END IF;
      IF NEW.valor < v_reservado THEN
        RAISE EXCEPTION 'Valor não pode ficar abaixo do já reservado nesta linha (%)', fmt_reais(v_reservado);
      END IF;
      IF NEW.setor_id IS DISTINCT FROM OLD.setor_id THEN
        RAISE EXCEPTION 'Linha com reserva (%) não pode mudar de setor/área', fmt_reais(v_reservado);
      END IF;
      IF NEW.cancelada AND NOT COALESCE(OLD.cancelada, false) THEN
        RAISE EXCEPTION 'Linha com reserva (%) não pode ser cancelada', fmt_reais(v_reservado);
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_plano FROM planos_investimento
   WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.plano_id ELSE NEW.plano_id END);

  -- Só linha 'planejada' de plano publicado segue para as regras de ajuste.
  IF v_plano.status::text IS DISTINCT FROM 'aprovado'
     OR (CASE WHEN TG_OP = 'DELETE' THEN OLD.tipo ELSE NEW.tipo END)::text <> 'planejada' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plano publicado: cancele a linha em vez de excluir';
  END IF;

  v_motivo := NULLIF(btrim(current_setting('app.ajuste_motivo', true)), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Ajuste de plano publicado exige motivo (use a tela do Plano)';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.cancelada, false) THEN
      RAISE EXCEPTION 'Linha cancelada não pode ser alterada';
    END IF;
    IF NEW.plano_id IS DISTINCT FROM OLD.plano_id OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'Plano e tipo da linha não podem ser alterados';
    END IF;
    v_cancelando := NEW.cancelada AND NOT COALESCE(OLD.cancelada, false);
  END IF;

  v_corte  := data_corte_plano(v_plano.ano_calendario);
  v_janela := hoje_brasilia() <= v_corte;

  -- ── Depois do corte: regra da Etapa 6 ──
  -- (inclusão de linha nova é conferida contra o teto no trigger AFTER)
  IF NOT v_janela AND TG_OP = 'UPDATE' AND NOT v_cancelando THEN
    IF OLD.criado_em <= v_plano.aprovado_em THEN
      RAISE EXCEPTION 'Plano congelado desde %: linhas da publicação não podem mais ser alteradas — acréscimos somente por aumento de verba',
        to_char(v_corte + 1, 'DD/MM/YYYY');
    END IF;
    IF v_reservado > 0 THEN
      RAISE EXCEPTION 'Plano congelado: linha com reserva não pode mais ser alterada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_linhas_plano_validar_ajuste ON linhas_plano;
CREATE TRIGGER trg_linhas_plano_validar_ajuste
  BEFORE INSERT OR UPDATE OR DELETE ON linhas_plano
  FOR EACH ROW EXECUTE FUNCTION linhas_plano_validar_ajuste();


-- =====================================================
-- 7. TRIGGER AFTER — auditoria + teto
-- =====================================================

CREATE OR REPLACE FUNCTION linhas_plano_registrar_ajuste()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plano      planos_investimento%ROWTYPE;
  v_motivo     text;
  v_janela     boolean;
  v_tipo       text;
  v_area_nova  uuid;
  v_area_velha uuid;
  v_area       uuid;
  v_soma       numeric;
  v_reservado  numeric;
  v_teto       numeric;
BEGIN
  SELECT * INTO v_plano FROM planos_investimento WHERE id = NEW.plano_id;
  IF v_plano.status::text IS DISTINCT FROM 'aprovado' OR NEW.tipo::text <> 'planejada' THEN
    RETURN NULL;
  END IF;

  v_motivo := btrim(current_setting('app.ajuste_motivo', true)); -- garantido pelo BEFORE
  v_janela := hoje_brasilia() <= data_corte_plano(v_plano.ano_calendario);

  -- ── Auditoria ──
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'inclusao';
    INSERT INTO ajustes_plano (plano_id, linha_id, tipo, campo, valor_antes, valor_depois, motivo, na_janela) VALUES
      (NEW.plano_id, NEW.id, v_tipo, 'setor',     NULL, (SELECT nome FROM setores WHERE id = NEW.setor_id), v_motivo, v_janela),
      (NEW.plano_id, NEW.id, v_tipo, 'descricao', NULL, NEW.descricao,     v_motivo, v_janela),
      (NEW.plano_id, NEW.id, v_tipo, 'valor',     NULL, NEW.valor::text,   v_motivo, v_janela);
  ELSIF NEW.cancelada AND NOT COALESCE(OLD.cancelada, false) THEN
    v_tipo := 'cancelamento';
    INSERT INTO ajustes_plano (plano_id, linha_id, tipo, campo, valor_antes, valor_depois, motivo, na_janela)
    VALUES (NEW.plano_id, NEW.id, v_tipo, 'situacao', 'Ativa (' || NEW.valor::text || ')', 'Cancelada', v_motivo, v_janela);
  ELSE
    v_tipo := 'alteracao';
    IF NEW.setor_id IS DISTINCT FROM OLD.setor_id THEN
      INSERT INTO ajustes_plano (plano_id, linha_id, tipo, campo, valor_antes, valor_depois, motivo, na_janela)
      VALUES (NEW.plano_id, NEW.id, v_tipo, 'setor',
              (SELECT nome FROM setores WHERE id = OLD.setor_id), (SELECT nome FROM setores WHERE id = NEW.setor_id), v_motivo, v_janela);
    END IF;
    IF NEW.descricao IS DISTINCT FROM OLD.descricao THEN
      INSERT INTO ajustes_plano (plano_id, linha_id, tipo, campo, valor_antes, valor_depois, motivo, na_janela)
      VALUES (NEW.plano_id, NEW.id, v_tipo, 'descricao', OLD.descricao, NEW.descricao, v_motivo, v_janela);
    END IF;
    IF NEW.valor IS DISTINCT FROM OLD.valor THEN
      INSERT INTO ajustes_plano (plano_id, linha_id, tipo, campo, valor_antes, valor_depois, motivo, na_janela)
      VALUES (NEW.plano_id, NEW.id, v_tipo, 'valor', OLD.valor::text, NEW.valor::text, v_motivo, v_janela);
    END IF;
  END IF;

  -- ── Teto por área ──
  v_area_nova := area_do_setor_emp(v_plano.empresa_id, NEW.setor_id);
  IF TG_OP = 'UPDATE' THEN
    v_area_velha := area_do_setor_emp(v_plano.empresa_id, OLD.setor_id);
  END IF;

  FOR v_area IN SELECT DISTINCT a FROM unnest(ARRAY[v_area_nova, v_area_velha]) AS a WHERE a IS NOT NULL LOOP
    -- Soma e reservado das linhas ATIVAS (todos os tipos) da área no plano.
    SELECT COALESCE(SUM(l.valor), 0), COALESCE(SUM(reservado_linha_plano(l.id)), 0)
      INTO v_soma, v_reservado
      FROM linhas_plano l
      JOIN empresa_setores es ON es.setor_id = l.setor_id AND es.empresa_id = v_plano.empresa_id
     WHERE l.plano_id = v_plano.id AND l.cancelada IS NOT TRUE AND es.area_id = v_area;

    IF v_janela THEN
      -- Janela aberta: o teto acompanha os ajustes.
      IF v_soma < v_reservado THEN
        RAISE EXCEPTION 'O teto da área ficaria em %, abaixo do já reservado nela (%)', fmt_reais(v_soma), fmt_reais(v_reservado);
      END IF;
      INSERT INTO teto_area_plano (plano_id, area_id, valor_teto)
      VALUES (v_plano.id, v_area, v_soma)
      ON CONFLICT (plano_id, area_id) DO UPDATE SET valor_teto = EXCLUDED.valor_teto;
    ELSIF v_tipo <> 'cancelamento' AND v_area = v_area_nova THEN
      -- Depois do corte: teto congelado — inclusão/alteração tem que caber nele.
      SELECT valor_teto INTO v_teto FROM teto_area_plano WHERE plano_id = v_plano.id AND area_id = v_area;
      IF v_soma > COALESCE(v_teto, 0) + 0.005 THEN
        RAISE EXCEPTION 'Plano congelado: estouraria o teto da área (teto %, ficaria %) — acréscimos somente por aumento de verba',
          fmt_reais(COALESCE(v_teto, 0)), fmt_reais(v_soma);
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_linhas_plano_registrar_ajuste ON linhas_plano;
CREATE TRIGGER trg_linhas_plano_registrar_ajuste
  AFTER INSERT OR UPDATE ON linhas_plano
  FOR EACH ROW EXECUTE FUNCTION linhas_plano_registrar_ajuste();


-- =====================================================
-- 8. PERMISSÕES DE EXECUÇÃO (o Supabase já concede EXECUTE a PUBLIC por
-- padrão; explícito aqui para não depender disso).
-- =====================================================

GRANT EXECUTE ON FUNCTION data_corte_plano(int) TO authenticated;
GRANT EXECUTE ON FUNCTION plano_incluir_linha(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION plano_alterar_linha(uuid, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION plano_cancelar_linha(uuid, text) TO authenticated;


-- =====================================================
-- 9. VERIFICAÇÃO
-- =====================================================
-- 9a. Configuração: deve mostrar 31 / 12.
-- SELECT dia_corte_plano, mes_corte_plano FROM config_prazos WHERE id = 1;
-- SELECT data_corte_plano(2027);  -- esperado 2026-12-31
-- SELECT data_corte_plano(2026);  -- esperado 2025-12-31 (plano 2026 já congelado)

-- 9b. Triggers e policies criados?
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'linhas_plano'::regclass AND NOT tgisinternal;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ajustes_plano';

-- 9c. Teste manual (como usuário controladoria_op, num plano 2027 publicado
-- — rodar dentro de BEGIN; ... ROLLBACK; para não sujar dados):
--   -- UPDATE direto é recusado (sem motivo):
--   UPDATE linhas_plano SET valor = valor + 1 WHERE id = '<linha planejada>';
--     → erro "Ajuste de plano publicado exige motivo"
--   -- Pela função, passa e audita:
--   SELECT plano_alterar_linha('<linha>', '<setor>', 'desc', 123456, 'teste');
--   SELECT * FROM ajustes_plano ORDER BY feito_em DESC LIMIT 3;
--   -- Abaixo do reservado é recusado:
--   SELECT plano_alterar_linha('<linha com reserva>', '<setor>', 'desc', 1, 'teste');
--     → erro "Valor não pode ficar abaixo do já reservado nesta linha (R$ ...)"
--   -- Num plano 2026 (já depois do corte), linha da publicação é recusada:
--   SELECT plano_alterar_linha('<linha 2026>', '<setor>', 'desc', 1, 'teste');
--     → erro "Plano congelado desde 01/01/2026 ..."

-- 9d. Fluxos que NÃO devem ter mudado (conferir depois de aplicar):
--   - Aprovar um aumento de verba (aplicar_efeito_aumento) continua criando
--     a linha tipo=aumento e elevando o teto.
--   - Encerrar PAI com excedente continua lançando/somando a linha
--     tipo=devolucao.

-- =====================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_linhas_plano_registrar_ajuste ON linhas_plano;
--   DROP TRIGGER IF EXISTS trg_linhas_plano_validar_ajuste ON linhas_plano;
--   DROP FUNCTION IF EXISTS linhas_plano_registrar_ajuste();
--   DROP FUNCTION IF EXISTS linhas_plano_validar_ajuste();
--   DROP FUNCTION IF EXISTS plano_incluir_linha(uuid, uuid, text, numeric, text);
--   DROP FUNCTION IF EXISTS plano_alterar_linha(uuid, uuid, text, numeric, text);
--   DROP FUNCTION IF EXISTS plano_cancelar_linha(uuid, text);
--   DROP POLICY IF EXISTS ajustes_plano_leitura ON ajustes_plano;
--   DROP POLICY IF EXISTS ajustes_plano_insercao ON ajustes_plano;
--   DROP TABLE IF EXISTS ajustes_plano;
--   DROP FUNCTION IF EXISTS reservado_linha_plano(uuid);
--   DROP FUNCTION IF EXISTS data_corte_plano(int);
--   DROP FUNCTION IF EXISTS hoje_brasilia();
--   DROP FUNCTION IF EXISTS fmt_reais(numeric);
--   ALTER TABLE config_prazos DROP CONSTRAINT IF EXISTS config_prazos_corte_plano_valido;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS dia_corte_plano;
--   ALTER TABLE config_prazos DROP COLUMN IF EXISTS mes_corte_plano;
--   -- O front desta etapa chama as funções da seção 5: reverter o SQL
--   -- exige reverter também o front (plano.js) para a versão da Etapa 22.
-- =====================================================
