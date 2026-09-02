// Mundo Investimentos — casca do mundo (nav + dashboard). Cobre a
// Solicitação (inv_solicitante), o motor de aprovação do PAI e do Aumento
// de Verba (Etapa 4 e 7) — Etapa 7b consolidou as ~10 filas soltas em uma
// única tela "Aprovações" com abas por papel (ver aprovacoes.js).
import { temPapel } from '../../shared/acesso.js';
import { renderMeusPais } from './dashboard.js';
import { renderAprovacoes } from './aprovacoes.js';
import { renderPlanoInvestimento } from './plano.js';
import { renderPainel } from './painel.js';

export async function montarMundoInvestimentos(usuario) {
  document.getElementById('topbar-title').textContent = 'Investimentos';
  document.getElementById('topbar-actions').innerHTML = '';

  const [souSolicitante, souControladoria, souAprovador, souDiretor, souDiretorCeo, souContabil] = await Promise.all([
    temPapel('investimentos', 'inv_solicitante'),
    temPapel('investimentos', 'controladoria_op'),
    temPapel('investimentos', 'inv_aprovador'),
    temPapel('investimentos', 'diretor'),
    temPapel('investimentos', 'diretor_ceo'),
    temPapel('investimentos', 'controladoria_contabil')
  ]);
  const souAprovadorDeAlgumaEtapa = souControladoria || souAprovador || souDiretor || souDiretorCeo || souContabil;
  const temAlgumPapel = souSolicitante || souAprovadorDeAlgumaEtapa;

  const papeis = [];
  if (souSolicitante) papeis.push('Solicitante');
  if (souControladoria) papeis.push('Controladoria Operacional');
  if (souAprovador) papeis.push('Superintendente');
  if (souDiretor) papeis.push('Diretor');
  if (souDiretorCeo) papeis.push('Diretor CEO');
  if (souContabil) papeis.push('Controladoria Contábil');

  document.getElementById('sidebar-nav').innerHTML = `
    <div class="nav-section">
      <div class="nav-label">Investimentos</div>
      ${temAlgumPapel ? `
      <button class="nav-item" onclick="renderPainel()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>
        Dashboard
      </button>` : ''}
      ${souSolicitante ? `
      <button class="nav-item" onclick="abrirMeusPais()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Meus PAIs
      </button>` : ''}
      ${souControladoria ? `
      <button class="nav-item" onclick="renderPlanoInvestimento()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21H3M6 21V10M12 21V4M18 21v-7"/></svg>
        Plano de Investimento
      </button>` : ''}
      ${souAprovadorDeAlgumaEtapa ? `
      <button class="nav-item" onclick="renderAprovacoes()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Aprovações
      </button>` : ''}
    </div>`;
  document.getElementById('user-role-display').textContent = papeis.join(' · ');

  // Primeira tela: prioriza a fila de aprovação sobre o dashboard do
  // solicitante quando a pessoa acumula os dois papéis — é o trabalho
  // pendente mais provável de precisar de atenção.
  if (souAprovadorDeAlgumaEtapa) renderAprovacoes();
  else if (souSolicitante) renderMeusPais();
  else {
    document.getElementById('page-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚧</div>
        <div class="empty-title">Nenhuma tela disponível para o seu papel ainda</div>
        <div class="empty-desc">Fale com o administrador se você deveria ter acesso a alguma tela deste mundo.</div>
      </div>`;
  }
}

export function abrirMeusPais() {
  renderMeusPais();
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { abrirMeusPais });
