import { sb } from '../../shared/supabase.js';
import { toast, fmtDate } from '../../shared/ui.js';
import { currentUser } from './auth.js';
import { badgeStatusPai, fmtMoeda, TIPO_INVESTIMENTO_LABELS } from './dashboard.js';

// ═══════════════════════════════════════════════════
// MOTOR DE APROVAÇÃO DO PAI (Etapa 4)
//
// Cadeia (resolvida por unidade — empresa_setores.area_id):
//   Controladoria Operacional (crítica) → Superintendente da área (aprovador)
//   → Diretor da área (homologação) → Controladoria Operacional (formalização)
//
// Cada etapa é uma linha em passos_aprovacao (pai_id, ordem, etapa, decisao).
// pais.status só guarda o estado "largo" (em_critica / aprovado / devolvido /
// reprovado / formalizado); QUEM decide agora é resolvido pelo passo com
// decisao='pendente' de maior ordem. Devolver reabre no solicitante; ao
// reenviar, um novo passo 'controladoria_op' é criado (ordem = max+1) —
// os passos antigos ficam como histórico, nada é apagado.
//
// Bucket do MRP: reprovar/encerrar já libera a verba sozinho, porque
// saldo_linhas/saldo_areas excluem status IN ('encerrado','reprovado',
// 'cancelado') da soma "reservado" (ver Etapa 3b). Formalizar não precisa
// mexer em vinculos_verba — o valor continua "reservado" (agora = consumido).
// ═══════════════════════════════════════════════════

const ETAPA_LABELS = { controladoria_op: 'Controladoria Operacional', aprovador: 'Superintendente da Área', diretor: 'Diretor' };
const DECISAO_LABELS = { pendente: 'Pendente', aprovado: 'Aprovado', devolvido: 'Devolvido', reprovado: 'Reprovado' };

// Chamado depois de toda decisão registrada, para quem estiver montando a
// tela (Etapa 7b: a tela "Aprovações" consolidada) recarregar a aba ativa.
let aoAtualizar = null;
export function definirCallbackAtualizacao(fn) { aoAtualizar = fn; }

// ═══════════════════════════════════════════════════
// ABERTURA DO FLUXO (chamado pela Solicitação — envio novo ou reenvio após devolução)
// Não fixa ordem=1: continua a numeração para preservar o histórico de
// ciclos anteriores quando um PAI devolvido é reenviado.
// ═══════════════════════════════════════════════════
export async function iniciarEtapaControladoria(paiId) {
  const { data: ultimo } = await sb.from('passos_aprovacao')
    .select('ordem').eq('pai_id', paiId).order('ordem', { ascending: false }).limit(1).maybeSingle();
  const proximaOrdem = (ultimo?.ordem || 0) + 1;
  const { error } = await sb.from('passos_aprovacao')
    .insert({ pai_id: paiId, ordem: proximaOrdem, etapa: 'controladoria_op', decisao: 'pendente' });
  if (error) console.error('Erro ao abrir etapa de crítica da Controladoria:', error);
}

// ═══════════════════════════════════════════════════
// FILAS (uma por papel — cada aprovador só vê as áreas/unidades que responde)
// ═══════════════════════════════════════════════════
async function carregarFilaControladoria() {
  const { data, error } = await sb.from('passos_aprovacao')
    .select('*, pai:pais(*, empresas(nome), setores(nome))')
    .eq('etapa', 'controladoria_op').eq('decisao', 'pendente')
    .order('criado_em');
  if (error) { toast('Erro ao carregar fila: ' + error.message, 'error'); return []; }
  return data || [];
}

async function carregarFilaPorResponsavel(etapa, coluna) {
  const [{ data: minhasAreas, error: errAreas }, { data: passos, error: errPassos }] = await Promise.all([
    sb.from('alcada_por_setor').select('empresa_id,setor_id').eq(coluna, currentUser.id),
    sb.from('passos_aprovacao').select('*, pai:pais(*, empresas(nome), setores(nome))').eq('etapa', etapa).eq('decisao', 'pendente').order('criado_em')
  ]);
  if (errAreas || errPassos) { toast('Erro ao carregar fila: ' + (errAreas || errPassos).message, 'error'); return []; }

  const chaves = new Set((minhasAreas || []).map(a => `${a.empresa_id}·${a.setor_id}`));
  return (passos || []).filter(p => p.pai && chaves.has(`${p.pai.empresa_id}·${p.pai.setor_id}`));
}

const carregarFilaAprovador = () => carregarFilaPorResponsavel('aprovador', 'responsavel_id');
const carregarFilaDiretor = () => carregarFilaPorResponsavel('diretor', 'diretor_id');

// Fragmento de HTML da fila de um papel (chave: 'controladoria' | 'aprovador'
// | 'diretor') — usado pela tela consolidada "Aprovações" (Etapa 7b), uma
// aba por papel, PAI e Aumento de Verba lado a lado na mesma aba.
export async function renderFragmentoFilaPai(chave) {
  const passos = chave === 'controladoria' ? await carregarFilaControladoria()
    : chave === 'aprovador' ? await carregarFilaAprovador()
    : await carregarFilaDiretor();

  return `
    <div class="table-card">
      <div class="table-header"><div class="table-title">PAIs · ${passos.length}</div></div>
      ${passos.length === 0 ? `
      <div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Fila vazia</div><div class="empty-desc">Nenhum PAI aguardando sua análise no momento.</div></div>` : `
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Número</th><th>Título</th><th>Empresa</th><th>Área/Setor</th><th class="text-right">Valor</th><th>Etapa</th><th>Enviado em</th></tr></thead>
        <tbody>
          ${passos.map(p => `
            <tr onclick="abrirDetalhePai('${p.pai.id}','${p.etapa}')">
              <td><span class="font-mono text-xs" style="color:var(--accent)">${p.pai.numero || '—'}</span></td>
              <td><strong>${p.pai.titulo}</strong></td>
              <td>${p.pai.empresas?.nome || '—'}</td>
              <td>${p.pai.setores?.nome || '—'}</td>
              <td class="text-right">${fmtMoeda(p.pai.valor_total)}</td>
              <td>${p.pai.status === 'aprovado' ? '<span class="badge badge-pendente">Formalização</span>' : '<span class="badge badge-em_critica">Em análise</span>'}</td>
              <td>${fmtDate(p.pai.enviado_em)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`}
    </div>`;
}

// ═══════════════════════════════════════════════════
// DETALHE + DECISÃO
// ═══════════════════════════════════════════════════
async function carregarDetalhePai(paiId) {
  const [{ data: pai }, { data: itens }, { data: anexos }, { data: vinculos }] = await Promise.all([
    sb.from('pais').select('*, empresas(nome), setores(nome), solicitante:solicitante_id(nome,email)').eq('id', paiId).single(),
    sb.from('itens_pai').select('*').eq('pai_id', paiId).order('ordem'),
    sb.from('anexos_pai').select('*').eq('pai_id', paiId),
    sb.from('vinculos_verba').select('*, linhas_plano(descricao)').eq('pai_id', paiId)
  ]);
  return { pai, itens: itens || [], anexos: anexos || [], vinculos: vinculos || [] };
}

export async function abrirDetalhePai(paiId, etapaAtual) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal modal-lg"><div class="loading"><div class="spinner"></div> Carregando...</div></div>';
  document.body.appendChild(overlay);

  const { pai, itens, anexos, vinculos } = await carregarDetalhePai(paiId);
  if (!pai) { toast('PAI não encontrado', 'error'); overlay.remove(); return; }

  const formalizacao = etapaAtual === 'controladoria_op' && pai.status === 'aprovado';
  const podeReprovar = etapaAtual !== 'controladoria_op';

  overlay.id = 'modal-decisao-pai';
  overlay.querySelector('.modal').innerHTML = `
    <div class="modal-header">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="font-mono text-xs" style="color:var(--accent)">${pai.numero || '—'}</span>
          ${badgeStatusPai(pai.status)}
          ${formalizacao ? '<span class="badge badge-pendente">Formalização</span>' : ''}
        </div>
        <h2>${pai.titulo}</h2>
      </div>
      <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div class="info-row">
        <div class="info-item"><span class="info-label">Empresa</span><span class="info-val">${pai.empresas?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Área/Setor</span><span class="info-val">${pai.setores?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Tipo</span><span class="info-val">${TIPO_INVESTIMENTO_LABELS[pai.tipo] || pai.tipo}</span></div>
        <div class="info-item"><span class="info-label">Solicitante</span><span class="info-val">${pai.solicitante?.nome || '—'}</span></div>
        <div class="info-item"><span class="info-label">Valor</span><span class="info-val">${fmtMoeda(pai.valor_total)}</span></div>
        <div class="info-item"><span class="info-label">Ano</span><span class="info-val">${pai.ano_calendario}</span></div>
        <div class="info-item"><span class="info-label">Enviado em</span><span class="info-val">${fmtDate(pai.enviado_em)}</span></div>
        <div class="info-item"><span class="info-label">Reserva expira</span><span class="info-val">${fmtDate(pai.reserva_expira_em)}</span></div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Descrição</div>
        <p style="color:var(--text2);line-height:1.7;font-size:13px">${pai.descricao}</p>
      </div>

      <div class="form-section">
        <div class="form-section-title">Linhas de verba vinculadas</div>
        <table><thead><tr><th>Linha</th><th class="text-right">Valor</th></tr></thead><tbody>
          ${vinculos.map(v => `<tr><td>${v.linhas_plano?.descricao || '—'}</td><td class="text-right">${fmtMoeda(v.valor)}</td></tr>`).join('')}
        </tbody></table>
      </div>

      <div class="form-section">
        <div class="form-section-title">Composição</div>
        <table><thead><tr><th>Aplicação</th><th class="text-right">Valor</th></tr></thead><tbody>
          ${itens.map(i => `<tr><td>${i.aplicacao}</td><td class="text-right">${fmtMoeda(i.valor)}</td></tr>`).join('')}
        </tbody></table>
      </div>

      <div class="form-section">
        <div class="form-section-title">Anexos</div>
        <div class="file-list">
          ${anexos.length === 0 ? '<div class="text-xs text-muted">Nenhum anexo.</div>' : anexos.map(a => `
            <div class="file-item"><span>📎</span><span class="file-item-name">${a.nome_arquivo}</span><span class="text-xs text-muted">${a.tipo}</span>
              <a href="#" onclick="downloadAnexo('${a.storage_path}','anexos-chamados','${a.nome_arquivo}');return false;" style="color:var(--accent);font-size:12px">↓</a></div>`).join('')}
        </div>
      </div>

      ${formalizacao ? `
      <div class="form-section">
        <div class="form-section-title">Formalização</div>
        <div class="field"><label>Código no MRP *</label><input type="text" id="pai-codigo-mrp" placeholder="ex.: OI-2026-0451"></div>
      </div>` : ''}

      <div class="form-section">
        <div class="form-section-title">Observação${formalizacao ? ' (opcional)' : ' — obrigatória para devolver ou reprovar'}</div>
        <textarea id="decisao-observacao" rows="3" placeholder="Explique sua decisão..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      ${formalizacao ? `
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="confirmarFormalizacao('${paiId}')">Formalizar</button>
      ` : `
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        ${podeReprovar ? `<button class="btn btn-danger" onclick="confirmarDecisao('${paiId}','${etapaAtual}','reprovado')">Reprovar</button>` : ''}
        <button class="btn btn-warning" onclick="confirmarDecisao('${paiId}','${etapaAtual}','devolvido')">Devolver p/ ajuste</button>
        <button class="btn btn-primary" onclick="confirmarDecisao('${paiId}','${etapaAtual}','aprovado')">Aprovar</button>
      `}
    </div>`;
}

export async function confirmarDecisao(paiId, etapa, decisao) {
  const observacao = document.getElementById('decisao-observacao').value.trim();
  if ((decisao === 'devolvido' || decisao === 'reprovado') && !observacao) {
    toast('Explique o motivo para devolver ou reprovar', 'error');
    return;
  }
  await registrarDecisao(paiId, etapa, decisao, observacao);
  document.getElementById('modal-decisao-pai')?.remove();
}

async function registrarDecisao(paiId, etapa, decisao, observacao) {
  const { data: pai, error: erroPai } = await sb.from('pais').select('status').eq('id', paiId).single();
  if (erroPai || !pai) { toast('Erro ao carregar PAI: ' + (erroPai?.message || ''), 'error'); return; }

  const { data: passo } = await sb.from('passos_aprovacao').select('*')
    .eq('pai_id', paiId).eq('etapa', etapa).eq('decisao', 'pendente')
    .order('ordem', { ascending: false }).limit(1).maybeSingle();
  if (!passo) { toast('Este PAI não está mais pendente nesta etapa', 'error'); return; }

  const { error: erroPasso } = await sb.from('passos_aprovacao').update({
    decisao, observacao: observacao || null, decidido_em: new Date().toISOString(), responsavel_id: currentUser.id
  }).eq('id', passo.id);
  if (erroPasso) { toast('Erro ao registrar decisão: ' + erroPasso.message, 'error'); return; }

  let novoStatus = pai.status;
  let proximaEtapa = null;

  if (decisao === 'devolvido') novoStatus = 'devolvido';
  else if (decisao === 'reprovado') novoStatus = 'reprovado';
  else if (decisao === 'aprovado') {
    if (etapa === 'controladoria_op') proximaEtapa = 'aprovador';
    else if (etapa === 'aprovador') proximaEtapa = 'diretor';
    else if (etapa === 'diretor') { novoStatus = 'aprovado'; proximaEtapa = 'controladoria_op'; }
  }

  const { error: erroStatus } = await sb.from('pais').update({ status: novoStatus }).eq('id', paiId);
  if (erroStatus) { toast('Erro ao atualizar status do PAI: ' + erroStatus.message, 'error'); return; }

  if (proximaEtapa) {
    await sb.from('passos_aprovacao').insert({ pai_id: paiId, ordem: passo.ordem + 1, etapa: proximaEtapa, decisao: 'pendente' });
  }

  await sb.from('historico_pai').insert({
    pai_id: paiId, usuario_id: currentUser.id, de_status: pai.status, para_status: novoStatus,
    observacao: observacao || `${ETAPA_LABELS[etapa]}: ${DECISAO_LABELS[decisao]}`,
    criado_em: new Date().toISOString()
  });

  toast('Decisão registrada');
  if (aoAtualizar) await aoAtualizar();
}

export async function confirmarFormalizacao(paiId) {
  const codigoMrp = document.getElementById('pai-codigo-mrp').value.trim();
  if (!codigoMrp) { toast('Informe o código do investimento no MRP', 'error'); return; }
  const observacao = document.getElementById('decisao-observacao').value.trim();

  const { data: passo } = await sb.from('passos_aprovacao').select('*')
    .eq('pai_id', paiId).eq('etapa', 'controladoria_op').eq('decisao', 'pendente')
    .order('ordem', { ascending: false }).limit(1).maybeSingle();
  if (!passo) { toast('Este PAI não está mais pendente de formalização', 'error'); return; }

  const { error: erroPasso } = await sb.from('passos_aprovacao').update({
    decisao: 'aprovado', observacao: observacao || null, decidido_em: new Date().toISOString(), responsavel_id: currentUser.id
  }).eq('id', passo.id);
  if (erroPasso) { toast('Erro ao registrar formalização: ' + erroPasso.message, 'error'); return; }

  const { error: erroPai } = await sb.from('pais').update({ status: 'formalizado', mrp_codigo: codigoMrp }).eq('id', paiId);
  if (erroPai) { toast('Erro ao formalizar PAI: ' + erroPai.message, 'error'); return; }

  await sb.from('historico_pai').insert({
    pai_id: paiId, usuario_id: currentUser.id, de_status: 'aprovado', para_status: 'formalizado',
    observacao: observacao || `Formalizado no MRP: ${codigoMrp}`, criado_em: new Date().toISOString()
  });

  document.getElementById('modal-decisao-pai')?.remove();
  toast('PAI formalizado com sucesso');
  if (aoAtualizar) await aoAtualizar();
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, {
  abrirDetalhePai, confirmarDecisao, confirmarFormalizacao
});
