import { sb } from './supabase.js';

// ═══════════════════════════════════════════════════
// CAMADA DE ACESSO (mundo × papel × escopo — Etapa 1)
// Toda decisão de acesso do código novo passa por aqui — nunca ler
// usuarios.perfil direto. As funções abaixo espelham as funções SQL
// criadas em design_handoff_portal_etapa2/sql/etapa1_base_de_acesso.sql.
// ═══════════════════════════════════════════════════

export async function isMaster() {
  const { data, error } = await sb.rpc('is_master');
  if (error) { console.error('Erro ao verificar master:', error); return false; }
  return !!data;
}

export async function temMundo(mundo) {
  const { data, error } = await sb.rpc('tem_mundo', { m: mundo });
  if (error) { console.error('Erro ao verificar acesso ao mundo:', error); return false; }
  return !!data;
}

export async function temPapel(mundo, papel) {
  const { data, error } = await sb.rpc('tem_papel', { m: mundo, p: papel });
  if (error) { console.error('Erro ao verificar papel:', error); return false; }
  return !!data;
}

export async function temPapelNoEscopo(mundo, papel, empresaId, setorId) {
  const { data, error } = await sb.rpc('tem_papel_no_escopo', {
    m: mundo, p: papel, emp: empresaId ?? null, setor: setorId ?? null
  });
  if (error) { console.error('Erro ao verificar papel no escopo:', error); return false; }
  return !!data;
}

// Lista as atribuições (mundo·papel·empresa·setor) de um usuário. A RLS de
// `atribuicoes` já garante que só o próprio usuário ou o master conseguem ler.
export async function carregarAtribuicoes(usuarioId) {
  const { data, error } = await sb.from('atribuicoes')
    .select('*, empresas(nome), setores(nome)')
    .eq('usuario_id', usuarioId)
    .order('criado_em');
  if (error) { console.error('Erro ao carregar atribuições:', error); return []; }
  return data || [];
}
