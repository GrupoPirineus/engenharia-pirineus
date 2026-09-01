import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { badgeStatusPai, fmtMoeda } from './dashboard.js';

// ═══════════════════════════════════════════════════
// ENCERRAMENTO DO PAI (Etapa 8) — segundo passo, feito pela Controladoria
// Contábil depois que o solicitante indica conclusão (ver aprovacao.js,
// onIndicarConclusao: formalizado/em_execucao -> concluido_solicitante).
//
// Ao encerrar: grava o número do bem de cada item (itens_pai.numero_bem),
// calcula saldo_final = valor_total - valor realizado (sobra positiva /
// excedente negativo), lança esse saldo numa linha tipo=devolucao da
// ÁREA+ano do PAI (soma numa já existente; cria se não houver — uma linha
// por área+plano, igual ao teto por área da Etapa 6) e fecha o PAI
// (status=encerrado, encerrado_em). Tudo registrado em historico_pai.
//
// saldo_linhas/saldo_areas somam l.valor de toda linha não cancelada —
// uma devolução negativa (excedente) reduz o "aprovado" da área sozinha,
// sem precisar de lógica extra nas views (confirmado em teste ao vivo).
// ═══════════════════════════════════════════════════

let aoAtualizar = null;
export function definirCallbackAtualizacao(fn) { aoAtualizar = fn; }

let estadoEncerramento = null;

// ═══════════════════════════════════════════════════
// FILA (papel controladoria_contabil — back-office largo, sem escopo)
// ═══════════════════════════════════════════════════
async function carregarFilaEncerramento() {
  const { data, error } = await sb.from('pais')
    .select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome,email)')
    .eq('status', 'concluido_solicitante')
    .order('atualizado_em');
  if (error) { toast('Erro ao carregar fila de encerramento: ' + error.message, 'error'); return []; }
  return data || [];
}

export async function renderFragmentoFilaEncerramento() {
  const pais = await carregarFilaEncerramento();
  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">PAIs aguardando encerramento · ${pais.length}</div></div>
      ${pais.length === 0 ? `
      <div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Fila vazia</div><div class="empty-desc">Nenhum PAI com conclusão indicada aguardando encerramento.</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Título</th><th>Empresa</th><th>Área/Setor</th><th class="text-right">Valor aprovado</th><th>Solicitante</th></tr></thead>
        <tbody>
          ${pais.map(p => `
            <tr onclick="abrirEncerramentoPai('${p.id}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.numero || '—'}</span></td>
              <td><strong>${p.titulo}</strong></td>
              <td>${p.empresas?.nome || '—'}</td>
              <td>${p.setores?.nome || '—'}</td>
              <td class="text-right">${fmtMoeda(p.valor_total)}</td>
              <td>${p.solicitante?.nome || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// TELA DE ENCERRAMENTO
// ═══════════════════════════════════════════════════
export async function abrirEncerramentoPai(paiId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-lg"><div class="loading"><div class="spinner"></div> Carregando...</div></div>';
  document.body.appendChild(overlay);

  const [{ data: pai, error: erroPai }, { data: itens, error: erroItens }] = await Promise.all([
    sb.from('pais').select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome,email)').eq('id', paiId).single(),
    sb.from('itens_pai').select('*').eq('pai_id', paiId).order('ordem')
  ]);
  if (erroPai || !pai) { toast('Erro ao carregar PAI: ' + (erroPai?.message || ''), 'error'); overlay.remove(); return; }
  if (erroItens) { toast('Erro ao carregar itens: ' + erroItens.message, 'error'); overlay.remove(); return; }

  estadoEncerramento = { paiId, valorTotal: Number(pai.valor_total), itens: itens || [], realizado: 0, observacao: '' };

  overlay.id = 'modal-encerramento-pai';
  overlay.querySelector('.modal').innerHTML = renderModalEncerramento(pai);
}

function renderModalEncerramento(pai) {
  const realizado = estadoEncerramento.realizado;
  const saldo = pai.valor_total - realizado;
  return `
    <div class="modal-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="font-mono text-xs" style="color:var(--accent)">${pai.numero || '—'}</span>
          ${badgeStatusPai(pai.status)}
        </div>
        <h2>Encerrar PAI</h2>
      </div>
      <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="info-row">
        <div class="info-item"><span class="info-label">Título</span><span class="info-val">${pai.titulo}</span></div>
        <div class="info-item"><span class="info-label">Empresa</span><span class="info-val">${pai.empresas?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Área/Setor</span><span class="info-val">${pai.setores?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Solicitante</span><span class="info-val">${pai.solicitante?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Valor aprovado</span><span class="info-val">${fmtMoeda(pai.valor_total)}</span></div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Número do bem por item *</div>
        <table><thead><tr><th>Aplicação</th><th class="text-right">Valor</th><th style="width:180px">Nº do bem</th></tr></thead><tbody>
          ${estadoEncerramento.itens.map((it, i) => `
            <tr>
              <td>${it.aplicacao}</td>
              <td class="text-right">${fmtMoeda(it.valor)}</td>
              <td><input type="text" id="item-bem-${i}" value="${it.numero_bem || ''}" placeholder="ex.: 4500123" oninput="onEncerramentoBemInput(${i}, this.value)"></td>
            </tr>`).join('')}
        </tbody></table>
      </div>

      <div class="form-section">
        <div class="form-row">
          <div class="field"><label>Valor final realizado *</label>
            <input type="number" min="0" step="0.01" id="encerramento-realizado" value="${realizado || ''}" placeholder="0" oninput="onEncerramentoRealizadoInput(this.value)">
          </div>
          <div class="field"><label>Saldo apurado</label>
            <div id="encerramento-saldo" style="height:38px;display:flex;align-items:center;font-weight:700;color:${saldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoeda(Math.abs(saldo))} ${saldo >= 0 ? '(sobra)' : '(excedente)'}</div>
          </div>
        </div>
        <div class="text-xs text-muted">Sobra volta para o bolo da área; excedente desconta do bolo da área — o "livre" pode ficar negativo.</div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Observação (opcional)</div>
        <textarea id="encerramento-observacao" rows="2" oninput="onEncerramentoObservacaoInput(this.value)" placeholder="Detalhe o encerramento, se necessário..."></textarea>
      </div>
      <div id="encerramento-erro" class="text-xs" style="color:var(--red);min-height:16px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmarEncerramento()">Confirmar encerramento</button>
    </div>`;
}

function onEncerramentoBemInput(i, valor) { estadoEncerramento.itens[i].numero_bem = valor; }
function onEncerramentoObservacaoInput(valor) { estadoEncerramento.observacao = valor; }

function onEncerramentoRealizadoInput(valor) {
  const n = parseFloat(valor);
  estadoEncerramento.realizado = isNaN(n) ? 0 : n;
  const saldoEl = document.getElementById('encerramento-saldo');
  if (!saldoEl) return;
  const saldo = estadoEncerramento.valorTotal - estadoEncerramento.realizado;
  saldoEl.textContent = `${fmtMoeda(Math.abs(saldo))} ${saldo >= 0 ? '(sobra)' : '(excedente)'}`;
  saldoEl.style.color = saldo >= 0 ? 'var(--green)' : 'var(--red)';
}

// ═══════════════════════════════════════════════════
// CONFIRMAÇÃO — grava numero_bem, saldo_final, devolução e encerra
// ═══════════════════════════════════════════════════
export async function confirmarEncerramento() {
  const erroEl = document.getElementById('encerramento-erro');
  erroEl.textContent = '';

  const { paiId, itens, realizado, observacao } = estadoEncerramento;

  if (itens.some(it => !it.numero_bem || !String(it.numero_bem).trim())) {
    erroEl.textContent = 'Informe o número do bem de todos os itens.';
    return;
  }
  if (realizado === null || realizado === undefined || isNaN(realizado) || realizado < 0) {
    erroEl.textContent = 'Informe o valor final realizado.';
    return;
  }

  const { data: pai, error: erroPai } = await sb.from('pais').select('*').eq('id', paiId).single();
  if (erroPai || !pai) { toast('Erro ao carregar PAI: ' + (erroPai?.message || ''), 'error'); return; }

  for (const it of itens) {
    const { error } = await sb.from('itens_pai').update({ numero_bem: String(it.numero_bem).trim() }).eq('id', it.id);
    if (error) { toast('Erro ao gravar número do bem: ' + error.message, 'error'); return; }
  }

  const saldoFinal = pai.valor_total - realizado;

  const { error: erroDevolucao } = await lancarDevolucao(pai, saldoFinal);
  if (erroDevolucao) { toast('Erro ao lançar a devolução: ' + erroDevolucao.message, 'error'); return; }

  const agora = new Date().toISOString();
  const { error: erroEncerrar } = await sb.from('pais').update({
    status: 'encerrado', encerrado_em: agora, saldo_final: saldoFinal
  }).eq('id', paiId);
  if (erroEncerrar) { toast('Erro ao encerrar o PAI: ' + erroEncerrar.message, 'error'); return; }

  const resumo = `Encerrado pela Controladoria Contábil. Valor aprovado: ${fmtMoeda(pai.valor_total)}. Valor realizado: ${fmtMoeda(realizado)}. Saldo apurado: ${fmtMoeda(Math.abs(saldoFinal))} (${saldoFinal >= 0 ? 'sobra' : 'excedente'}).`;
  await sb.from('historico_pai').insert({
    pai_id: paiId, usuario_id: currentUser.id, de_status: 'concluido_solicitante', para_status: 'encerrado',
    observacao: observacao ? `${resumo} ${observacao}` : resumo, criado_em: agora
  });

  document.getElementById('modal-encerramento-pai')?.remove();
  toast(`PAI ${pai.numero} encerrado — saldo de ${fmtMoeda(Math.abs(saldoFinal))} (${saldoFinal >= 0 ? 'sobra' : 'excedente'}) lançado na área`);
  if (aoAtualizar) await aoAtualizar();
}

// Uma linha tipo=devolucao por (plano, área) — mesma área pode ter vários
// setores (empresa_setores), então a busca cobre todos eles, não só o
// setor do PAI. Sobra soma, excedente subtrai (valor pode ficar negativo).
async function lancarDevolucao(pai, saldoFinal) {
  if (!pai.plano_id) return { error: null }; // PAI sem plano vinculado (não deveria acontecer) — nada a lançar

  const { data: areaId } = await sb.rpc('area_do_setor_emp', { p_empresa: pai.empresa_id, p_setor: pai.setor_id });
  let setorIds = [pai.setor_id];
  if (areaId) {
    const { data: setoresDaArea } = await sb.from('empresa_setores').select('setor_id').eq('empresa_id', pai.empresa_id).eq('area_id', areaId);
    if (setoresDaArea?.length) setorIds = setoresDaArea.map(s => s.setor_id);
  }

  const { data: linhaExistente, error: erroBusca } = await sb.from('linhas_plano').select('*')
    .eq('plano_id', pai.plano_id).eq('tipo', 'devolucao').eq('cancelada', false).in('setor_id', setorIds).maybeSingle();
  if (erroBusca) return { error: erroBusca };

  if (linhaExistente) {
    const { error } = await sb.from('linhas_plano').update({
      valor: Number(linhaExistente.valor) + saldoFinal,
      descricao: `${linhaExistente.descricao}, ${pai.numero}`
    }).eq('id', linhaExistente.id);
    return { error };
  }

  const { error } = await sb.from('linhas_plano').insert({
    plano_id: pai.plano_id, setor_id: pai.setor_id, tipo: 'devolucao',
    descricao: `Devolução — encerramento PAI ${pai.numero}`, valor: saldoFinal
  });
  return { error };
}

// Funções chamadas via atributos inline (onclick/onchange) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  abrirEncerramentoPai, onEncerramentoBemInput, onEncerramentoRealizadoInput,
  onEncerramentoObservacaoInput, confirmarEncerramento
});
