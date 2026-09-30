import { sb } from '../shared/supabase.js';
import { toast, fmtDateTime } from '../shared/ui.js';
import { usuarioLogado } from '../shared/auth.js';

// ═══════════════════════════════════════════════════
// ADMINISTRAÇÃO — Configurações (só isMaster(), RLS garante a escrita)
// Página guarda-chuva para configurações gerais do sistema — subseções
// "Prazos de Comunicação" (Etapa 20, movida da aba "Unidades e Setores"
// para cá na Etapa 20b, ganhando item próprio no menu) e "Chamados:
// Revisão" (Etapa 21). Pensada
// para receber mais subseções abaixo no futuro, cada uma seu próprio
// "table-card", sem precisar de item de menu novo a cada uma.
// ═══════════════════════════════════════════════════

export async function renderConfiguracoes() {
  document.getElementById('topbar-title').textContent = 'Administração · Configurações';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('page-content').innerHTML = `
    <h2 style="font-size:20px;margin:0 0 20px">Configurações</h2>
    <div id="config-prazos-comunicacao"><div class="loading"><div class="spinner"></div> Carregando...</div></div>
    <div id="config-revisao-chamados" style="margin-top:20px"><div class="loading"><div class="spinner"></div> Carregando...</div></div>`;
  await Promise.all([montarPrazosComunicacao(), montarRevisaoChamados()]);
}

// ═══════════════════════════════════════════════════
// SUBSEÇÃO · PRAZOS DE COMUNICAÇÃO (Etapa 20) — linha única em
// config_prazos, lida por verificar_aprovacoes_pendentes() (Etapa 19) e
// verificar_vencimento_pai() (Etapa 9) em vez das constantes fixas de
// antes. RLS já garante que só master grava; DEFAULTS_PRAZOS aqui só é um
// fallback de exibição caso a linha ainda não exista.
// ═══════════════════════════════════════════════════
const DEFAULTS_PRAZOS = { dias_lembrete_aprovador: 2, dias_escalonamento_master: 4, intervalo_repeticao_dias: 2, dias_aviso_vencimento: 7, atualizado_em: null };

async function montarPrazosComunicacao() {
  const conteudo = document.getElementById('config-prazos-comunicacao');
  const { data: cfg, error } = await sb.from('config_prazos').select('*').eq('id', 1).maybeSingle();
  if (error) { toast('Erro ao carregar prazos de comunicação: ' + error.message, 'error'); return; }
  const v = cfg || DEFAULTS_PRAZOS;

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Prazos de Comunicação</div>
      </div>
      <div style="padding:20px;max-width:560px">
        <p class="text-sm text-muted" style="margin-bottom:20px">Controla quando o sistema manda lembrete de aprovação parada, escalona ao master e avisa que o prazo de uma obra está vencendo. Vale para PAI e Aumento de Verba.</p>

        <div class="field">
          <label>Lembrete ao aprovador (dias sem decisão)</label>
          <input type="number" min="1" step="1" id="prazo-lembrete" value="${v.dias_lembrete_aprovador}">
          <div class="text-xs text-muted" style="margin-top:4px">Depois de quantos dias parado no passo pendente avisamos quem precisa decidir (Superintendente, Diretor, Controladoria...).</div>
        </div>

        <div class="field">
          <label>Escalonamento ao master (dias sem decisão)</label>
          <input type="number" min="1" step="1" id="prazo-escalonamento" value="${v.dias_escalonamento_master}">
          <div class="text-xs text-muted" style="margin-top:4px">Se ainda ninguém decidiu depois desse tanto de dias, avisamos o(s) administrador(es) master. Precisa ser maior que o lembrete acima.</div>
        </div>

        <div class="field">
          <label>Repetir aviso a cada (dias)</label>
          <input type="number" min="1" step="1" id="prazo-intervalo" value="${v.intervalo_repeticao_dias}">
          <div class="text-xs text-muted" style="margin-top:4px">Intervalo mínimo entre um lembrete/escalonamento e o próximo, para o mesmo item — evita mandar e-mail todo dia enquanto ele continua parado.</div>
        </div>

        <div class="field">
          <label>Aviso de vencimento da obra (dias antes)</label>
          <input type="number" min="1" step="1" id="prazo-vencimento" value="${v.dias_aviso_vencimento}">
          <div class="text-xs text-muted" style="margin-top:4px">Quantos dias antes da previsão de conclusão avisamos a Controladoria Contábil que o prazo está chegando (e segue avisando nesse mesmo intervalo até o PAI ser encerrado).</div>
        </div>

        <div id="prazos-erro" class="text-xs" style="color:var(--red);min-height:16px;margin-bottom:4px"></div>
        <button class="btn btn-primary btn-sm" onclick="salvarPrazosComunicacao()">Salvar</button>
        ${v.atualizado_em ? `<div class="text-xs text-muted" style="margin-top:10px">Última atualização em ${fmtDateTime(v.atualizado_em)}</div>` : ''}
      </div>
    </div>`;
}

export async function salvarPrazosComunicacao() {
  const erroEl = document.getElementById('prazos-erro');
  erroEl.textContent = '';

  const lembrete = parseInt(document.getElementById('prazo-lembrete').value, 10);
  const escalonamento = parseInt(document.getElementById('prazo-escalonamento').value, 10);
  const intervalo = parseInt(document.getElementById('prazo-intervalo').value, 10);
  const vencimento = parseInt(document.getElementById('prazo-vencimento').value, 10);

  if ([lembrete, escalonamento, intervalo, vencimento].some(n => !Number.isInteger(n) || n <= 0)) {
    erroEl.textContent = 'Todos os prazos precisam ser números inteiros maiores que zero.';
    return;
  }
  if (escalonamento <= lembrete) {
    erroEl.textContent = 'O escalonamento ao master precisa ser maior que o lembrete ao aprovador.';
    return;
  }

  const { error } = await sb.from('config_prazos').update({
    dias_lembrete_aprovador: lembrete, dias_escalonamento_master: escalonamento,
    intervalo_repeticao_dias: intervalo, dias_aviso_vencimento: vencimento,
    atualizado_em: new Date().toISOString(), atualizado_por: usuarioLogado?.id || null
  }).eq('id', 1);
  if (error) { erroEl.textContent = 'Erro ao salvar: ' + error.message; return; }

  toast('Prazos de comunicação salvos');
  montarPrazosComunicacao();
}

// ═══════════════════════════════════════════════════
// SUBSEÇÃO · CHAMADOS: REVISÃO (Etapa 21) — mesma linha/tabela/RLS da
// subseção acima (config_prazos, id=1), só com as duas colunas lidas por
// verificar_revisoes_pendentes(). Salvar aqui grava só essas duas colunas,
// sem tocar nos prazos de Investimentos. DEFAULTS_REVISAO é o mesmo default
// do banco (2/2), só para exibição se a linha/colunas ainda não existirem.
// ═══════════════════════════════════════════════════
const DEFAULTS_REVISAO = { dias_lembrete_revisao: 2, intervalo_lembrete_revisao_dias: 2 };

async function montarRevisaoChamados() {
  const conteudo = document.getElementById('config-revisao-chamados');
  const { data: cfg, error } = await sb.from('config_prazos').select('*').eq('id', 1).maybeSingle();
  if (error) { toast('Erro ao carregar prazos de revisão: ' + error.message, 'error'); return; }
  const v = {
    dias_lembrete_revisao: cfg?.dias_lembrete_revisao ?? DEFAULTS_REVISAO.dias_lembrete_revisao,
    intervalo_lembrete_revisao_dias: cfg?.intervalo_lembrete_revisao_dias ?? DEFAULTS_REVISAO.intervalo_lembrete_revisao_dias
  };

  conteudo.innerHTML = `
    <div class="table-card">
      <div class="table-header">
        <div class="table-title">Chamados: Revisão</div>
      </div>
      <div style="padding:20px;max-width:560px">
        <p class="text-sm text-muted" style="margin-bottom:20px">Controla a cobrança ao solicitante enquanto o chamado está em Revisão. O 1º lembrete vai só ao solicitante; a partir do 2º, o(s) gestor(es) recebem cópia. A cobrança para sozinha quando o chamado é concluído ou devolvido para correção.</p>

        <div class="field">
          <label>1º lembrete ao solicitante (dias em Revisão)</label>
          <input type="number" min="1" step="1" id="prazo-revisao-lembrete" value="${v.dias_lembrete_revisao}">
          <div class="text-xs text-muted" style="margin-top:4px">Depois de quantos dias em Revisão, sem o solicitante concluir ou pedir correção, mandamos o primeiro lembrete.</div>
        </div>

        <div class="field">
          <label>Repetir lembrete a cada (dias)</label>
          <input type="number" min="1" step="1" id="prazo-revisao-intervalo" value="${v.intervalo_lembrete_revisao_dias}">
          <div class="text-xs text-muted" style="margin-top:4px">Intervalo mínimo entre um lembrete e o próximo, para o mesmo chamado.</div>
        </div>

        <div id="revisao-erro" class="text-xs" style="color:var(--red);min-height:16px;margin-bottom:4px"></div>
        <button class="btn btn-primary btn-sm" onclick="salvarRevisaoChamados()">Salvar</button>
      </div>
    </div>`;
}

export async function salvarRevisaoChamados() {
  const erroEl = document.getElementById('revisao-erro');
  erroEl.textContent = '';

  const lembrete = parseInt(document.getElementById('prazo-revisao-lembrete').value, 10);
  const intervalo = parseInt(document.getElementById('prazo-revisao-intervalo').value, 10);

  if ([lembrete, intervalo].some(n => !Number.isInteger(n) || n <= 0)) {
    erroEl.textContent = 'Os dois prazos precisam ser números inteiros maiores que zero.';
    return;
  }

  const { error } = await sb.from('config_prazos').update({
    dias_lembrete_revisao: lembrete, intervalo_lembrete_revisao_dias: intervalo,
    atualizado_em: new Date().toISOString(), atualizado_por: usuarioLogado?.id || null
  }).eq('id', 1);
  if (error) { erroEl.textContent = 'Erro ao salvar: ' + error.message; return; }

  toast('Prazos de revisão dos chamados salvos');
  montarRevisaoChamados();
}

// Funções chamadas via atributos inline (onclick) precisam estar em window,
// pois módulos ES não expõem suas funções no escopo global automaticamente.
Object.assign(window, { salvarPrazosComunicacao, salvarRevisaoChamados });
