import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { abrirNovoPai } from './solicitacao.js';

// ═══════════════════════════════════════════════════
// LABELS
// ═══════════════════════════════════════════════════
export const STATUS_PAI_LABELS = {
  rascunho: 'Rascunho', em_critica: 'Em Crítica', aprovado: 'Aprovado',
  reprovado: 'Reprovado', formalizado: 'Formalizado', encerrado: 'Encerrado',
  devolvido: 'Devolvido'
};
export const STATUS_PAI_BADGE = {
  rascunho: 'badge-rascunho', em_critica: 'badge-em_critica', aprovado: 'badge-success',
  reprovado: 'badge-danger', formalizado: 'badge-execucao', encerrado: 'badge-concluido',
  devolvido: 'badge-pendente'
};
export const TIPO_INVESTIMENTO_LABELS = {
  obra: 'Obra / instalação', maquina_equipamento: 'Máquina / equipamento',
  ti_software: 'TI / software', melhoria: 'Projeto de melhoria'
};

export function badgeStatusPai(s) {
  return `<span class="badge ${STATUS_PAI_BADGE[s] || ''}">${STATUS_PAI_LABELS[s] || s}</span>`;
}
export function fmtMoeda(n) {
  return 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
}

// ═══════════════════════════════════════════════════
// MEUS PAIs
// ═══════════════════════════════════════════════════
export async function renderMeusPais() {
  document.getElementById('topbar-title').textContent = 'Meus PAIs';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const { data: pais, error } = await sb.from('pais')
    .select('*, empresas(nome), setores(nome)')
    .eq('solicitante_id', currentUser.id)
    .order('criado_em', { ascending: false });

  if (error) { toast('Erro ao carregar PAIs: ' + error.message, 'error'); return; }

  page.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="abrirNovoPai()">+ Novo PAI</button>
    </div>
    <div class="table-card">
      <div class="table-header"><div class="table-title">Meus PAIs</div></div>
      ${(pais || []).length === 0 ? `<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-title">Nenhum PAI ainda</div><div class="empty-desc">Clique em "Novo PAI" para abrir uma solicitação de investimento</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Título</th><th>Empresa</th><th>Área</th><th>Ano</th><th>Tipo</th><th class="text-right">Valor</th><th>Status</th><th>Criado em</th></tr></thead>
        <tbody>
          ${(pais || []).map(p => `
            <tr onclick="${['rascunho', 'devolvido'].includes(p.status) ? `abrirNovoPai('${p.id}')` : ''}" style="${['rascunho', 'devolvido'].includes(p.status) ? 'cursor:pointer' : ''}">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.numero || '— rascunho —'}</span></td>
              <td><strong>${p.titulo || '—'}</strong></td>
              <td><span class="text-muted text-sm">${p.empresas?.nome || '—'}</span></td>
              <td><span class="text-muted text-sm">${p.setores?.nome || '—'}</span></td>
              <td>${p.ano_calendario}</td>
              <td>${TIPO_INVESTIMENTO_LABELS[p.tipo] || p.tipo}</td>
              <td class="text-right">${fmtMoeda(p.valor_total)}</td>
              <td>${badgeStatusPai(p.status)}</td>
              <td>${fmtDate(p.criado_em)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { renderMeusPais, abrirNovoPai });
