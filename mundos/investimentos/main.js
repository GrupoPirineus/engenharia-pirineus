// Mundo Investimentos — casca do mundo (nav + dashboard). As telas de
// aprovação, composição, reserva, aumento e encerramento do PAI chegam nas
// próximas etapas; por ora só a Solicitação (papel inv_solicitante).
import { temPapel } from '../../shared/acesso.js';
import { renderMeusPais } from './dashboard.js';

export async function montarMundoInvestimentos(usuario) {
  document.getElementById('topbar-title').textContent = 'Investimentos';
  document.getElementById('topbar-actions').innerHTML = '';

  const souSolicitante = await temPapel('investimentos', 'inv_solicitante');

  document.getElementById('sidebar-nav').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Investimentos</div>
      ${souSolicitante ? `
      <button class="nav-item active" onclick="abrirMeusPais()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Meus PAIs
      </button>` : ''}
    </div>`;
  document.getElementById('user-role-display').textContent = souSolicitante ? 'Solicitante' : '';

  if (!souSolicitante) {
    document.getElementById('page-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚧</div>
        <div class="empty-title">Nenhuma tela disponível para o seu papel ainda</div>
        <div class="empty-desc">As telas de aprovação, controladoria e diretoria chegam nas próximas etapas.</div>
      </div>`;
    return;
  }

  renderMeusPais();
}

export function abrirMeusPais() {
  renderMeusPais();
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { abrirMeusPais });
