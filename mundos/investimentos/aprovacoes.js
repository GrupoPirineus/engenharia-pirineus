import { temPapel } from '../../shared/acesso.js';
import { renderFragmentoFilaPai, definirCallbackAtualizacao as definirCallbackPai } from './aprovacao.js';
import { renderFragmentoFilaAumento, definirCallbackAtualizacao as definirCallbackAumento } from './aumento.js';

// ═══════════════════════════════════════════════════
// TELA CONSOLIDADA "APROVAÇÕES" (Etapa 7b)
// Uma aba por papel de aprovação (Controladoria, Superintendente, Diretor,
// Diretor CEO) — cada aba junta a fila de PAI e a de Aumento de Verba
// daquele mesmo papel/etapa, para não espalhar ~10 itens soltos no menu.
// Quem só tem um desses papéis vê uma aba só; quem acumula vê várias
// (ex.: a conta de teste vanderlei, que é controladoria_op + aprovador +
// diretor + diretor_ceo).
// ═══════════════════════════════════════════════════

const ABAS = [
  { chave: 'controladoria', titulo: 'Controladoria Operacional', papel: 'controladoria_op', temPai: true, temAumento: true },
  { chave: 'aprovador', titulo: 'Superintendente', papel: 'inv_aprovador', temPai: true, temAumento: true },
  { chave: 'diretor', titulo: 'Diretor da Área', papel: 'diretor', temPai: true, temAumento: true },
  { chave: 'diretor_ceo', titulo: 'Diretor CEO', papel: 'diretor_ceo', temPai: false, temAumento: true }
];

let abasDisponiveis = [];
let abaAtiva = null;

export async function renderAprovacoes() {
  document.getElementById('topbar-title').textContent = 'Aprovações';
  document.getElementById('topbar-actions').innerHTML = '';
  const page = document.getElementById('page-content');
  page.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';

  const resultados = await Promise.all(ABAS.map(a => temPapel('investimentos', a.papel)));
  abasDisponiveis = ABAS.filter((a, i) => resultados[i]);

  if (!abasDisponiveis.length) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-title">Sem papel de aprovação</div>
        <div class="empty-desc">Fale com o administrador se você deveria participar de alguma etapa de aprovação.</div>
      </div>`;
    return;
  }

  if (!abasDisponiveis.some(a => a.chave === abaAtiva)) abaAtiva = abasDisponiveis[0].chave;
  definirCallbackPai(recarregarAbaAtiva);
  definirCallbackAumento(recarregarAbaAtiva);
  montarTelaAprovacoes();
}

function montarTelaAprovacoes() {
  const page = document.getElementById('page-content');
  page.innerHTML = `
    <div class="auth-tabs" style="max-width:${Math.min(720, abasDisponiveis.length * 190)}px;margin-bottom:20px">
      ${abasDisponiveis.map(a => `<button class="auth-tab ${a.chave === abaAtiva ? 'active' : ''}" onclick="onTrocarAbaAprovacoes('${a.chave}')">${a.titulo}</button>`).join('')}
    </div>
    <div id="aprovacoes-conteudo" style="display:flex;flex-direction:column;gap:20px"><div class="loading"><div class="spinner"></div> Carregando...</div></div>`;
  recarregarAbaAtiva();
}

export function onTrocarAbaAprovacoes(chave) {
  abaAtiva = chave;
  montarTelaAprovacoes();
}

async function recarregarAbaAtiva() {
  const conteudo = document.getElementById('aprovacoes-conteudo');
  if (!conteudo) return;
  const aba = abasDisponiveis.find(a => a.chave === abaAtiva);
  if (!aba) return;
  const partes = await Promise.all([
    aba.temPai ? renderFragmentoFilaPai(aba.chave) : null,
    aba.temAumento ? renderFragmentoFilaAumento(aba.chave) : null
  ]);
  conteudo.innerHTML = partes.filter(Boolean).join('');
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { renderAprovacoes, onTrocarAbaAprovacoes });
