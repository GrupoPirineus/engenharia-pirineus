-- =====================================================
-- ETAPA 9 · TRIGGERS DE E-MAIL (mundo Investimentos)
-- Projeto: Fluxo de aprovação de investimento — Grupo Pirineus
--
-- NÃO cria função de trigger nova — reaproveita a mesma
-- disparar_notificacao_email() já usada pelos Chamados (mesma URL, mesmo
-- Bearer, mesmo net.http_post, mesmo EXCEPTION WHEN OTHERS THEN NULL).
-- Todo o roteamento por evento fica na edge function notificar-email
-- (ver supabase/functions/notificar-email/index.ts nesta branch — os
-- blocos de Chamados não foram tocados, só foram acrescentados blocos
-- novos por tabela).
--
-- Tabelas pedidas explicitamente (Parte B da Etapa 9):
--   pais              AFTER INSERT OR UPDATE
--   passos_aprovacao  AFTER INSERT
--   passos_aumento    AFTER INSERT
--   usuarios          AFTER INSERT OR UPDATE
--
-- Duas tabelas ACRESCENTADAS além da lista, com justificativa (avaliar e
-- comentar antes de aplicar se não forem desejadas — a Seção 2 já vem
-- comentada, separada da Seção 1, para dar essa opção):
--
--   aumentos_verba AFTER UPDATE — a Parte A pede "decisão final/mudança de
--   status do aumento -> e-mail ao solicitante do aumento". Sem trigger
--   NESTA tabela não existe nenhum sinal de webhook para isso: quando o
--   passo 3 (Diretor) colapsa com o Diretor CEO, aplicar_efeito_aumento()
--   grava status='aprovado' direto em aumentos_verba, SEM inserir um passo
--   4 em passos_aumento — ou seja, o caso colapsado só é detectável aqui.
--   Sem esta trigger, a aprovação com colapso nunca notificaria o
--   solicitante.
--
--   atribuicoes AFTER INSERT — a Parte A pede "UPDATE que libera o acesso
--   (vira ativo / ganha atribuição) -> e-mail ao usuário". Nesta base,
--   usuarios.ativo já nasce TRUE por padrão (confirmado em teste) — quase
--   nunca é um UPDATE de usuarios que libera o acesso de um cadastro
--   pendente, e sim a PRIMEIRA linha em atribuicoes (o que o admin faz na
--   ficha de usuário). A trigger em usuarios (Seção 1) continua cobrindo o
--   caso de desbloqueio (alternarBloqueioAdmin, ativo false->true); esta
--   cobre o caso — mais comum — do cadastro pendente ganhando acesso.
--
-- Idempotente (DROP TRIGGER IF EXISTS + CREATE TRIGGER).
-- =====================================================


-- =====================================================
-- SEÇÃO 1 · Triggers pedidas explicitamente
-- =====================================================

DROP TRIGGER IF EXISTS trg_notif_pais ON pais;
CREATE TRIGGER trg_notif_pais
AFTER INSERT OR UPDATE ON public.pais
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();

DROP TRIGGER IF EXISTS trg_notif_passos_aprovacao ON passos_aprovacao;
CREATE TRIGGER trg_notif_passos_aprovacao
AFTER INSERT ON public.passos_aprovacao
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();

DROP TRIGGER IF EXISTS trg_notif_passos_aumento ON passos_aumento;
CREATE TRIGGER trg_notif_passos_aumento
AFTER INSERT ON public.passos_aumento
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();

DROP TRIGGER IF EXISTS trg_notif_usuarios ON usuarios;
CREATE TRIGGER trg_notif_usuarios
AFTER INSERT OR UPDATE ON public.usuarios
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();


-- =====================================================
-- SEÇÃO 2 · Triggers acrescentadas (ver justificativa no cabeçalho) —
-- revise antes de aplicar; comente/apague se preferir cobrir esses casos
-- de outro jeito.
-- =====================================================

DROP TRIGGER IF EXISTS trg_notif_aumentos_verba ON aumentos_verba;
CREATE TRIGGER trg_notif_aumentos_verba
AFTER UPDATE ON public.aumentos_verba
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();

DROP TRIGGER IF EXISTS trg_notif_atribuicoes ON atribuicoes;
CREATE TRIGGER trg_notif_atribuicoes
AFTER INSERT ON public.atribuicoes
FOR EACH ROW EXECUTE FUNCTION disparar_notificacao_email();


-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- SELECT tgname, tgrelid::regclass::text AS tabela, pg_get_triggerdef(oid)
-- FROM pg_trigger
-- WHERE tgfoid = 'disparar_notificacao_email'::regproc AND NOT tgisinternal
-- ORDER BY tabela;

-- =====================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_notif_pais ON pais;
--   DROP TRIGGER IF EXISTS trg_notif_passos_aprovacao ON passos_aprovacao;
--   DROP TRIGGER IF EXISTS trg_notif_passos_aumento ON passos_aumento;
--   DROP TRIGGER IF EXISTS trg_notif_usuarios ON usuarios;
--   DROP TRIGGER IF EXISTS trg_notif_aumentos_verba ON aumentos_verba;
--   DROP TRIGGER IF EXISTS trg_notif_atribuicoes ON atribuicoes;
-- =====================================================
