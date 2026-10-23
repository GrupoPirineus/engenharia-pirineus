import { sb } from '../../shared/supabase.js';

// ═══════════════════════════════════════════════════
// ANO-CALENDÁRIO (mundo Investimentos)
//
// Regra única: só o ano vigente e o próximo (vigente + 1) são
// selecionáveis, calculados pela data do sistema — nunca lista longa.
// O <option> mostra e grava sempre "YYYY" puro (sem sufixo); a dica de
// qual é o vigente/próximo exercício é texto auxiliar renderizado à parte.
// ═══════════════════════════════════════════════════

export function anoVigente() {
  return new Date().getFullYear();
}

export function anosValidosPai() {
  const atual = anoVigente();
  return [atual, atual + 1];
}

export function anoValido(ano) {
  return anosValidosPai().includes(Number(ano));
}

export function renderOpcoesAno(anoSelecionado) {
  return anosValidosPai()
    .map(a => `<option value="${a}" ${a === anoSelecionado ? 'selected' : ''}>${a}</option>`)
    .join('');
}

// Texto auxiliar exibido ao lado do seletor — nunca dentro do valor do ano.
export function dicaAno(ano) {
  const atual = anoVigente();
  if (Number(ano) === atual) return 'ano vigente';
  if (Number(ano) === atual + 1) return 'próximo exercício';
  return '';
}

// Data de hoje em Brasília, 'AAAA-MM-DD' — mesma referência do banco
// (hoje_brasilia(), Etapa 23), para tela e trigger concordarem no dia.
export function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// ═══════════════════════════════════════════════════
// DATA LIMITE PARA ABERTURA DE PAI (Etapa 24)
// config_prazos.dia/mes_limite_abertura_pai (padrão 30/11), no próprio ano
// em exercício. A partir do dia seguinte, PAI e aumento de verba do plano
// do ano em exercício não podem mais ser enviados (rascunho pode). O plano
// do próximo exercício não é afetado. O banco recusa o mesmo envio
// (trigger de etapa24_ajustes.sql) — aqui é só para avisar antes.
// ═══════════════════════════════════════════════════
export async function carregarLimiteAbertura() {
  const { data, error } = await sb.from('config_prazos').select('dia_limite_abertura_pai,mes_limite_abertura_pai').eq('id', 1).maybeSingle();
  if (error) console.error('Erro ao carregar data limite de abertura de PAI:', error);
  return { dia: data?.dia_limite_abertura_pai ?? 30, mes: data?.mes_limite_abertura_pai ?? 11 };
}

// Texto do aviso quando o prazo de p_ano já encerrou; null quando ainda
// pode enviar (ou quando o ano não é o em exercício).
export function avisoPrazoAbertura(ano, limite) {
  if (Number(ano) !== anoVigente() || !limite) return null;
  const dd = String(limite.dia).padStart(2, '0');
  const mm = String(limite.mes).padStart(2, '0');
  if (hojeBrasilia() <= `${ano}-${mm}-${dd}`) return null;
  return `Prazo para abertura de PAI no exercício ${ano} encerrado em ${dd}/${mm}`;
}
