-- =====================================================
-- ETAPA 10 · DASHBOARD DO MUNDO INVESTIMENTOS
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- Reaproveita saldo_areas/saldo_linhas (Etapa 6) para aprovado/comprometido
-- (reservado)/livre. Falta só o "realizado" (valor efetivamente gasto nos
-- PAIs já encerrados) — não existe em nenhuma view hoje, por isso esta
-- migração cria UMA view nova, sem mexer nas existentes.
--
-- realizado_por_area: soma, por empresa+ano+área, o "realizado" de cada
-- PAI encerrado = valor_total - saldo_final (saldo_final positivo é
-- sobra, então valor_total - saldo_final = o que foi de fato usado;
-- saldo_final negativo é excedente, e a subtração já dá o valor maior
-- corretamente gasto). Mesma junção setor->área (empresa_setores) usada
-- em saldo_areas/saldo_linhas.
--
-- Nenhuma RLS nova é necessária: pais e empresa_setores já têm leitura
-- ampla para autenticado (Etapa 4/6); uma view herda essas permissões.
--
-- Como aplicar: rodar inteiro no SQL Editor. Idempotente (CREATE OR REPLACE).
-- =====================================================

CREATE OR REPLACE VIEW realizado_por_area AS
SELECT
  p.empresa_id,
  p.ano_calendario,
  es.area_id,
  SUM(p.valor_total - COALESCE(p.saldo_final, 0)) AS realizado,
  COUNT(*) AS qtd_pais_encerrados
FROM pais p
LEFT JOIN empresa_setores es ON es.setor_id = p.setor_id AND es.empresa_id = p.empresa_id
WHERE p.status = 'encerrado'
GROUP BY p.empresa_id, p.ano_calendario, es.area_id;


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT * FROM realizado_por_area ORDER BY ano_calendario, empresa_id;
-- Conferir que a soma bate com o que já se via manualmente antes desta
-- etapa, ex.: SELECT numero, valor_total, saldo_final, valor_total - COALESCE(saldo_final,0) AS realizado
-- FROM pais WHERE status = 'encerrado';

-- =====================================================
-- ROLLBACK
--   DROP VIEW IF EXISTS realizado_por_area;
-- =====================================================
