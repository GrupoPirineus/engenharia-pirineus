-- =====================================================
-- ETAPA 6 · CARGA DO PLANO — CANCELAMENTO DE LINHA, TETO POR ÁREA E RLS
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
-- planos_investimento/linhas_plano já existem (Etapa 3). Este arquivo:
--   1. Acrescenta cancelamento de linha (soft-delete com auditoria) —
--      Controladoria não apaga mais uma linha publicada, cancela.
--   2. Cria teto_area_plano: o teto por área congelado no momento em que
--      o plano passa de rascunho → aprovado — a referência contra a qual
--      uma linha nova, adicionada depois da publicação, é validada.
--   3. Recria saldo_linhas/saldo_areas (CREATE OR REPLACE VIEW, mesmas
--      colunas e mesma lógica de hoje) para ignorar linha cancelada.
--   4. RLS de leitura/escrita em planos_investimento, linhas_plano e
--      teto_area_plano.
--
-- Regra de negócio (aplicada no app, mundos/investimentos/plano.js):
--   rascunho → linha 100% editável; remover é DELETE de verdade.
--   aprovado → toda linha que já existia na publicação fica travada
--     (setor, descrição, valor) — só dá para CANCELAR (se sem reserva em
--     vinculos_verba) ou ACRESCENTAR linha nova. Linha nova continua
--     editável normalmente até ganhar reserva. Nenhuma linha editável
--     pode fazer a área estourar o teto congelado — isso fica bloqueado
--     e remetido ao aumento de verba (etapa futura). Cancelar uma linha
--     ativa libera espaço dentro do MESMO teto (não aumenta o teto).
--
-- Como aplicar: backup → rodar inteiro no SQL Editor → verificações na
-- seção 5. Idempotente (seguro rodar de novo).
-- =====================================================


-- =====================================================
-- 1. CANCELAMENTO DE LINHA (soft-delete com auditoria)
-- =====================================================

ALTER TABLE linhas_plano ADD COLUMN IF NOT EXISTS cancelada        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE linhas_plano ADD COLUMN IF NOT EXISTS cancelada_motivo TEXT;
ALTER TABLE linhas_plano ADD COLUMN IF NOT EXISTS cancelada_por    UUID REFERENCES usuarios(id);
ALTER TABLE linhas_plano ADD COLUMN IF NOT EXISTS cancelada_em     TIMESTAMPTZ;


-- =====================================================
-- 2. TETO POR ÁREA — snapshot congelado ao publicar
-- Um teto por (plano, área): a soma das linhas ativas daquela área no
-- momento da publicação. Não muda depois — é o "envelope" contra o qual
-- toda linha nova, adicionada após a publicação, é validada.
-- =====================================================

CREATE TABLE IF NOT EXISTS teto_area_plano (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id   UUID NOT NULL REFERENCES planos_investimento(id) ON DELETE CASCADE,
  area_id    UUID NOT NULL REFERENCES areas(id),
  valor_teto NUMERIC(14,2) NOT NULL DEFAULT 0,
  criado_em  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plano_id, area_id)
);


-- =====================================================
-- 3. VIEWS — saldo_linhas / saldo_areas ignoram linha cancelada
-- Texto atual das duas views (conferido antes de mexer), só acrescentando
-- "WHERE l.cancelada IS NOT TRUE" no bloco de linhas_plano l — mesmas
-- colunas, mesma ordem, mesmo JOIN de reservado (exclui vínculo de PAI
-- encerrado/reprovado/cancelado), nada mais muda.
-- =====================================================

CREATE OR REPLACE VIEW saldo_linhas AS
 SELECT l.id AS linha_id,
    l.plano_id,
    p.empresa_id,
    p.ano_calendario,
    l.setor_id,
    es.area_id,
    l.descricao,
    l.tipo,
    l.valor AS aprovado,
    COALESCE(r.reservado, 0::numeric) AS reservado,
    l.valor - COALESCE(r.reservado, 0::numeric) AS livre
   FROM linhas_plano l
     JOIN planos_investimento p ON p.id = l.plano_id
     LEFT JOIN empresa_setores es ON es.setor_id = l.setor_id AND es.empresa_id = p.empresa_id
     LEFT JOIN ( SELECT v.linha_id,
            sum(v.valor) AS reservado
           FROM vinculos_verba v
             JOIN pais pa ON pa.id = v.pai_id
          WHERE pa.status <> ALL (ARRAY['encerrado'::status_pai, 'reprovado'::status_pai, 'cancelado'::status_pai])
          GROUP BY v.linha_id) r ON r.linha_id = l.id
  WHERE l.cancelada IS NOT TRUE;

CREATE OR REPLACE VIEW saldo_areas AS
 SELECT p.empresa_id,
    p.ano_calendario,
    es.area_id,
    a.nome AS area_nome,
    sum(l.valor) AS aprovado,
    COALESCE(sum(r.reservado), 0::numeric) AS reservado,
    sum(l.valor) - COALESCE(sum(r.reservado), 0::numeric) AS livre
   FROM linhas_plano l
     JOIN planos_investimento p ON p.id = l.plano_id
     LEFT JOIN empresa_setores es ON es.setor_id = l.setor_id AND es.empresa_id = p.empresa_id
     LEFT JOIN areas a ON a.id = es.area_id
     LEFT JOIN ( SELECT v.linha_id,
            sum(v.valor) AS reservado
           FROM vinculos_verba v
             JOIN pais pa ON pa.id = v.pai_id
          WHERE pa.status <> ALL (ARRAY['encerrado'::status_pai, 'reprovado'::status_pai, 'cancelado'::status_pai])
          GROUP BY v.linha_id) r ON r.linha_id = l.id
  WHERE l.cancelada IS NOT TRUE
  GROUP BY p.empresa_id, p.ano_calendario, es.area_id, a.nome;


-- =====================================================
-- 4. RLS
-- Não desabilita RLS nenhuma que já exista — só garante (idempotente,
-- via DROP POLICY IF EXISTS + CREATE POLICY) que as regras abaixo valem.
-- =====================================================

ALTER TABLE planos_investimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE linhas_plano        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teto_area_plano     ENABLE ROW LEVEL SECURITY;

-- Leitura: todo autenticado (o solicitante do PAI precisa enxergar o bolo
-- aprovado; a leitura já funcionava via a view saldo_linhas, isto só torna
-- explícito nas tabelas-base também).
DROP POLICY IF EXISTS planos_investimento_leitura ON planos_investimento;
CREATE POLICY planos_investimento_leitura ON planos_investimento FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS linhas_plano_leitura ON linhas_plano;
CREATE POLICY linhas_plano_leitura ON linhas_plano FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS teto_area_plano_leitura ON teto_area_plano;
CREATE POLICY teto_area_plano_leitura ON teto_area_plano FOR SELECT TO authenticated USING (true);

-- Escrita (INSERT/UPDATE/DELETE): só quem tem o papel controladoria_op no
-- mundo investimentos (via tem_papel, já usada em toda a Etapa 4/6 para
-- esse papel como back-office largo, sem escopo de empresa/setor) ou o
-- master.
DROP POLICY IF EXISTS planos_investimento_escrita ON planos_investimento;
CREATE POLICY planos_investimento_escrita ON planos_investimento FOR ALL TO authenticated
USING (is_master() OR tem_papel('investimentos', 'controladoria_op'))
WITH CHECK (is_master() OR tem_papel('investimentos', 'controladoria_op'));

DROP POLICY IF EXISTS linhas_plano_escrita ON linhas_plano;
CREATE POLICY linhas_plano_escrita ON linhas_plano FOR ALL TO authenticated
USING (is_master() OR tem_papel('investimentos', 'controladoria_op'))
WITH CHECK (is_master() OR tem_papel('investimentos', 'controladoria_op'));

DROP POLICY IF EXISTS teto_area_plano_escrita ON teto_area_plano;
CREATE POLICY teto_area_plano_escrita ON teto_area_plano FOR ALL TO authenticated
USING (is_master() OR tem_papel('investimentos', 'controladoria_op'))
WITH CHECK (is_master() OR tem_papel('investimentos', 'controladoria_op'));


-- =====================================================
-- 5. VERIFICAÇÃO
-- =====================================================
-- 5a. Colunas e tabela novas existem?
-- SELECT column_name FROM information_schema.columns WHERE table_name='linhas_plano' AND column_name LIKE 'cancelada%';
-- SELECT * FROM teto_area_plano LIMIT 5;

-- 5b. As policies existem?
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename IN ('planos_investimento','linhas_plano','teto_area_plano') ORDER BY tablename, cmd;

-- 5c. As views continuam com as mesmas colunas de antes (CREATE OR REPLACE
-- só é aceito assim) e nenhuma linha cancelada aparece?
-- SELECT * FROM saldo_linhas WHERE linha_id IN (SELECT id FROM linhas_plano WHERE cancelada);
--   esperado: 0 linhas.
-- SELECT * FROM saldo_areas LIMIT 5;

-- =====================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS planos_investimento_leitura ON planos_investimento;
--   DROP POLICY IF EXISTS planos_investimento_escrita ON planos_investimento;
--   DROP POLICY IF EXISTS linhas_plano_leitura ON linhas_plano;
--   DROP POLICY IF EXISTS linhas_plano_escrita ON linhas_plano;
--   DROP POLICY IF EXISTS teto_area_plano_leitura ON teto_area_plano;
--   DROP POLICY IF EXISTS teto_area_plano_escrita ON teto_area_plano;
--   DROP TABLE IF EXISTS teto_area_plano;
--   ALTER TABLE linhas_plano DROP COLUMN IF EXISTS cancelada, DROP COLUMN IF EXISTS cancelada_motivo,
--     DROP COLUMN IF EXISTS cancelada_por, DROP COLUMN IF EXISTS cancelada_em;
--   -- restaurar as views para a versão sem "WHERE l.cancelada IS NOT TRUE"
--   -- (o texto exato de antes desta migração está registrado acima, no
--   -- comentário da seção 3 — é só tirar essa linha do CREATE OR REPLACE).
-- =====================================================
