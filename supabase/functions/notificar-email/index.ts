// Edge Function: notificar-email
// Sistema de Gestão de Engenharia — Grupo Pirineus
// Dispara e-mails a cada mudança de status de chamado e a cada novo comentário.
// Gatilhos:
//   - INSERT em chamados            -> evento "solicitacao"
//   - UPDATE em chamados (status)   -> evento = novo status
//   - INSERT em comentarios_chamado -> evento "comentario"
//
// Etapa 9 (mundo Investimentos) acrescenta, no MESMO arquivo/função (mesma
// URL, mesmo Bearer, mesmo remetente Gmail — nada do fluxo de chamados
// acima foi alterado):
//   - UPDATE em pais (mudança de status)      -> solicitante (e Controladoria
//     Contábil, quando entra concluido_solicitante)
//   - INSERT em passos_aprovacao (passo novo) -> titular da fila daquele
//     papel/etapa (via alcada_por_setor) + solicitante, quando o passo
//     anterior foi concluído (crítica/superintendente)
//   - INSERT em passos_aumento (passo novo)   -> titular da fila daquele
//     papel/etapa do aumento
//   - UPDATE em aumentos_verba (mudança de status) -> solicitante do aumento
//   - INSERT em usuarios (cadastro novo)      -> master(es)
//   - UPDATE em usuarios (ativo vira true)    -> o próprio usuário
//   - INSERT em atribuicoes (primeira atribuição da pessoa) -> o próprio
//     usuário (cobre o caminho real de "liberar acesso" nesta base, que é
//     dar a primeira atribuição — não necessariamente mexer em usuarios.ativo)
//   - CRON "aviso_vencimento_pai" (chamado pela função de banco
//     verificar_vencimento_pai, não por trigger de tabela) -> Controladoria
//     Contábil, quando previsao_conclusao se aproxima/vence

import nodemailer from 'npm:nodemailer@6.9.10'
import { createClient } from 'npm:@supabase/supabase-js@2'

// --- Clientes e configuração ---------------------------------------------

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS na porta 587
  auth: {
    user: Deno.env.get('GMAIL_USER')!,
    pass: Deno.env.get('GMAIL_PASS')!,
  },
})

const FROM = `"Engenharia Grupo Pirineus" <${Deno.env.get('GMAIL_USER')}>`
const BASE_URL = 'https://engenharia-pirineus.vercel.app'

// Título (cabeçalho) e emoji por evento
const LABEL: Record<string, string> = {
  solicitacao: 'Novo chamado aberto',
  aprovacao: 'Chamado aprovado',
  atribuicao: 'Chamado atribuído',
  execucao: 'Chamado em execução',
  revisao: 'Chamado em revisão',
  concluido: 'Chamado concluído',
  rejeitado: 'Chamado rejeitado',
  correcao: 'Chamado em correção',
  comentario: 'Novo comentário no chamado',
}
const EMOJI: Record<string, string> = {
  solicitacao: '📩', aprovacao: '✅', atribuicao: '👷', execucao: '🔧',
  revisao: '🔍', concluido: '🎉', rejeitado: '❌', correcao: '↩️', comentario: '💬',
}

// Frase explicativa por evento (texto que aparece em destaque no corpo do e-mail).
// atribuicao é tratada à parte, pois injeta o nome do engenheiro.
const MENSAGEM: Record<string, string> = {
  solicitacao: 'Um novo chamado foi aberto e aguarda sua análise para aprovação ou recusa.',
  aprovacao: 'Seu chamado foi aprovado. Em breve será atribuído a um engenheiro responsável.',
  execucao: 'O chamado entrou em execução e está sendo desenvolvido pelo engenheiro responsável.',
  revisao: 'O projeto foi finalizado pelo engenheiro e aguarda a sua revisão. Acesse o sistema para aprovar ou solicitar ajustes.',
  concluido: 'Este chamado foi concluído e encerrado. Nenhuma ação adicional é necessária.',
  rejeitado: 'Seu chamado foi recusado. Veja o motivo abaixo.',
  correcao: 'Este chamado retornou para correção. Verifique os ajustes solicitados e retome o desenvolvimento.',
  comentario: 'Há uma nova mensagem no chat deste chamado.',
}

// --- Helpers (genéricos — usados por chamados e por investimentos) --------

function ok(msg: string) {
  return new Response(JSON.stringify({ ok: true, msg }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function flagAtivo(evento: string): Promise<boolean> {
  const { data } = await supabase
    .from('config_notificacoes')
    .select('ativo')
    .eq('evento', evento)
    .single()
  return data?.ativo ?? true
}

async function emailsDosGestores(): Promise<string[]> {
  const { data } = await supabase
    .from('usuarios')
    .select('email')
    .in('perfil', ['gestor', 'gestor_master'])
    .eq('ativo', true)
  return (data ?? []).map((u) => u.email).filter(Boolean)
}

async function emailPorId(id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await supabase
    .from('usuarios').select('email').eq('id', id).single()
  return data?.email ?? null
}

// Busca o NOME do usuário (usado na frase da atribuição).
async function nomePorId(id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await supabase
    .from('usuarios').select('nome').eq('id', id).single()
  return data?.nome ?? null
}

function montarHtml(opts: {
  titulo: string
  codigo: string
  cabecalho: string
  emoji: string
  mensagem?: string   // frase explicativa em destaque (logo abaixo do cabeçalho)
  corpoExtra?: string // conteúdo injetado (motivo da recusa, texto do comentário)
}): string {
  const { titulo, codigo, cabecalho, emoji, mensagem, corpoExtra } = opts
  const blocoMensagem = mensagem
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(mensagem)}</p>`
    : ''
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#0d9488;color:#fff;padding:20px 24px">
      <div style="font-size:14px;opacity:.85;margin-bottom:4px">Engenharia Grupo Pirineus</div>
      <div style="font-size:20px;font-weight:700">${emoji} ${escapeHtml(cabecalho)}</div>
    </div>
    <div style="padding:24px">
      ${blocoMensagem}
      <p style="margin:0 0 8px;color:#475569;font-size:13px">Chamado</p>
      <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0f172a">${escapeHtml(codigo)}</p>
      <p style="margin:0 0 20px;font-size:15px;color:#334155">${escapeHtml(titulo)}</p>
      ${corpoExtra ?? ''}
      <a href="${BASE_URL}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Abrir o sistema</a>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Localize o chamado <strong>${escapeHtml(codigo)}</strong> na sua lista após entrar.</p>
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#94a3b8;text-align:center">
      Mensagem automática do Sistema de Gestão de Engenharia — não responda a este e-mail.
    </div>
  </div>`
}

async function enviar(destinatarios: (string | null)[], assunto: string, html: string) {
  const unicos = [...new Set(destinatarios.filter((e): e is string => !!e))]
  if (unicos.length === 0) return
  await transport.sendMail({ from: FROM, to: unicos.join(', '), subject: assunto, html })
}

async function destinatariosPorStatus(evento: string, ch: any): Promise<(string | null)[]> {
  switch (evento) {
    case 'solicitacao': return await emailsDosGestores()
    case 'aprovacao': return [await emailPorId(ch.solicitante_id)]
    case 'atribuicao': return [await emailPorId(ch.engenheiro_id), await emailPorId(ch.solicitante_id)]
    case 'execucao': return [await emailPorId(ch.engenheiro_id), await emailPorId(ch.solicitante_id)]
    case 'revisao': return [await emailPorId(ch.solicitante_id)]
    case 'concluido': return [await emailPorId(ch.solicitante_id), ...(await emailsDosGestores())]
    case 'rejeitado': return [await emailPorId(ch.solicitante_id)]
    case 'correcao': return [await emailPorId(ch.engenheiro_id)]
    default: return []
  }
}

// Monta a frase explicativa do evento.
// Para atribuicao, injeta o nome do engenheiro (com fallback se estiver vazio).
async function textoDoEvento(evento: string, ch: any): Promise<string> {
  if (evento === 'atribuicao') {
    const nome = await nomePorId(ch.engenheiro_id)
    return nome
      ? `O chamado foi atribuído ao engenheiro ${nome} e o desenvolvimento será iniciado em breve.`
      : 'O chamado foi atribuído a um engenheiro e o desenvolvimento será iniciado em breve.'
  }
  return MENSAGEM[evento] ?? ''
}

// ═══════════════════════════════════════════════════════════════════════
// ETAPA 9 · INVESTIMENTOS — helpers e template próprios
// (nada acima desta seção foi alterado em relação ao fluxo de Chamados)
// ═══════════════════════════════════════════════════════════════════════

// Título/emoji/mensagem por status do PAI (transições notificáveis ao solicitante).
const LABEL_PAI_STATUS: Record<string, string> = {
  aprovado: 'PAI aprovado',
  devolvido: 'PAI devolvido para ajuste',
  reprovado: 'PAI reprovado',
  formalizado: 'PAI formalizado',
  concluido_solicitante: 'PAI aguardando encerramento',
  encerrado: 'PAI encerrado',
}
const EMOJI_PAI_STATUS: Record<string, string> = {
  aprovado: '✅', devolvido: '↩️', reprovado: '❌', formalizado: '📄',
  concluido_solicitante: '📥', encerrado: '🏁',
}
const MENSAGEM_PAI_STATUS: Record<string, string> = {
  aprovado: 'Seu PAI foi aprovado pelo Diretor da área e segue para formalização.',
  devolvido: 'Seu PAI foi devolvido para ajustes. Acesse o sistema para ver o motivo e reenviar.',
  reprovado: 'Seu PAI foi reprovado. Acesse o sistema para ver o motivo.',
  formalizado: 'Seu PAI foi formalizado e a verba está liberada para execução.',
  encerrado: 'Seu PAI foi encerrado pela Controladoria Contábil.',
}

// Título/emoji/mensagem por status do aumento de verba (ao solicitante).
const LABEL_AUM_STATUS: Record<string, string> = {
  aprovado: 'Aumento de verba aprovado',
  devolvido: 'Aumento de verba devolvido para ajuste',
  reprovado: 'Aumento de verba reprovado',
}
const EMOJI_AUM_STATUS: Record<string, string> = { aprovado: '✅', devolvido: '↩️', reprovado: '❌' }
const MENSAGEM_AUM_STATUS: Record<string, string> = {
  aprovado: 'Seu aumento de verba foi aprovado — o teto da área já foi elevado.',
  devolvido: 'Seu aumento de verba foi devolvido para ajustes.',
  reprovado: 'Seu aumento de verba foi reprovado.',
}

function montarHtmlPAI(opts: {
  numero?: string
  titulo?: string
  cabecalho: string
  emoji: string
  mensagem: string
}): string {
  const { numero, titulo, cabecalho, emoji, mensagem } = opts
  const blocoNumero = numero
    ? `<p style="margin:0 0 8px;color:#475569;font-size:13px">PAI/AUM nº</p>
       <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0f172a">${escapeHtml(numero)}</p>`
    : ''
  const blocoTitulo = titulo
    ? `<p style="margin:0 0 20px;font-size:15px;color:#334155">${escapeHtml(titulo)}</p>`
    : ''
  const blocoRodapeNumero = numero
    ? `<p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Localize o <strong>${escapeHtml(numero)}</strong> na sua lista após entrar.</p>`
    : ''
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#1e3a5f;color:#fff;padding:20px 24px">
      <div style="font-size:14px;opacity:.85;margin-bottom:4px">Investimentos — Grupo Pirineus</div>
      <div style="font-size:20px;font-weight:700">${emoji} ${escapeHtml(cabecalho)}</div>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(mensagem)}</p>
      ${blocoNumero}
      ${blocoTitulo}
      <a href="${BASE_URL}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Abrir o sistema</a>
      ${blocoRodapeNumero}
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#94a3b8;text-align:center">
      Mensagem automática do Sistema de Gestão de Engenharia — não responda a este e-mail.
    </div>
  </div>`
}

async function emailsMasters(): Promise<string[]> {
  const { data } = await supabase.from('atribuicoes').select('usuario_id').eq('papel', 'master')
  const ids = [...new Set((data ?? []).map((a: any) => a.usuario_id))]
  const emails = await Promise.all(ids.map((id: string) => emailPorId(id)))
  return emails.filter((e): e is string => !!e)
}

// Papéis "de back-office" (sem escopo de empresa/setor): controladoria_op,
// controladoria_contabil, diretor_ceo. Ignora escopo de propósito, mesmo
// critério de tem_papel() usado no app.
async function emailsPorPapelGlobal(papel: string): Promise<string[]> {
  const { data } = await supabase.from('atribuicoes').select('usuario_id').eq('mundo', 'investimentos').eq('papel', papel)
  const ids = [...new Set((data ?? []).map((a: any) => a.usuario_id))]
  const emails = await Promise.all(ids.map((id: string) => emailPorId(id)))
  return emails.filter((e): e is string => !!e)
}

// Superintendente/Diretor da área (alçada por unidade — empresa+setor).
async function emailsAlcada(coluna: 'responsavel_id' | 'diretor_id', empresaId: string, setorId: string): Promise<string[]> {
  const { data } = await supabase
    .from('alcada_por_setor').select(coluna)
    .eq('empresa_id', empresaId).eq('setor_id', setorId)
  const ids = [...new Set((data ?? []).map((r: any) => r[coluna]).filter(Boolean))]
  const emails = await Promise.all(ids.map((id: string) => emailPorId(id)))
  return emails.filter((e): e is string => !!e)
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const { type, table, record, old_record } = await req.json()

    // ===== NOVO COMENTÁRIO =====
    if (table === 'comentarios_chamado' && type === 'INSERT') {
      if (!(await flagAtivo('comentario'))) return ok('comentario: flag desativada')

      const { data: ch } = await supabase
        .from('chamados')
        .select('codigo, titulo, solicitante_id, engenheiro_id')
        .eq('id', record.chamado_id)
        .single()
      if (!ch) return ok('chamado não encontrado')

      const autorEmail = await emailPorId(record.usuario_id)
      const dest = [
        await emailPorId(ch.solicitante_id),
        await emailPorId(ch.engenheiro_id),
        ...(await emailsDosGestores()),
      ].filter((e) => e && e !== autorEmail) // não notifica quem escreveu

      const html = montarHtml({
        titulo: ch.titulo,
        codigo: ch.codigo,
        cabecalho: LABEL.comentario,
        emoji: EMOJI.comentario,
        mensagem: MENSAGEM.comentario,
        corpoExtra: `<div style="background:#f1f5f9;border-left:3px solid #0d9488;padding:12px 16px;border-radius:6px;margin:0 0 20px;color:#334155;font-size:14px">${escapeHtml(record.mensagem ?? '')}</div>`,
      })
      await enviar(dest, `${EMOJI.comentario} Novo comentário — ${ch.codigo}`, html)
      return ok('comentário notificado')
    }

    // ===== CHAMADOS (criação ou mudança de status) =====
    if (table === 'chamados') {
      let evento: string | null = null
      if (type === 'INSERT') {
        evento = 'solicitacao'
      } else if (type === 'UPDATE') {
        if (old_record?.status === record.status) return ok('status inalterado')
        evento = record.status
      }
      if (!evento || !LABEL[evento]) return ok('sem evento notificável')
      if (!(await flagAtivo(evento))) return ok(`${evento}: flag desativada`)

      const dest = await destinatariosPorStatus(evento, record)
      const mensagem = await textoDoEvento(evento, record)
      const corpoExtra =
        evento === 'rejeitado' && record.motivo_rejeicao
          ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:12px 16px;border-radius:6px;margin:0 0 20px;color:#991b1b;font-size:14px"><strong>Motivo:</strong> ${escapeHtml(record.motivo_rejeicao)}</div>`
          : undefined

      const html = montarHtml({
        titulo: record.titulo,
        codigo: record.codigo,
        cabecalho: LABEL[evento],
        emoji: EMOJI[evento],
        mensagem,
        corpoExtra,
      })
      await enviar(dest, `${EMOJI[evento]} ${LABEL[evento]} — ${record.codigo}`, html)
      return ok(`${evento} notificado`)
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · PAI — mudança de status (crítica/superintendente não
    // mudam pais.status, por isso são tratadas no bloco passos_aprovacao
    // abaixo; aqui cuidamos de aprovado/devolvido/reprovado/formalizado/
    // concluido_solicitante/encerrado).
    // ═══════════════════════════════════════════════════════════════
    if (table === 'pais') {
      if (type !== 'UPDATE') return ok('pais: evento ignorado (insert)')
      if (!old_record || old_record.status === record.status) return ok('pais: status inalterado')

      const status = record.status as string

      // concluido_solicitante: não é notificação ao solicitante — é a
      // entrada na fila da Controladoria Contábil (mesma régua das outras
      // filas de aprovação, só que sem tabela de passos própria).
      if (status === 'concluido_solicitante') {
        if (!(await flagAtivo('pai_fila_encerramento'))) return ok('pai_fila_encerramento: flag desativada')
        const dest = await emailsPorPapelGlobal('controladoria_contabil')
        const html = montarHtmlPAI({
          numero: record.numero, titulo: record.titulo,
          cabecalho: 'PAI aguarda encerramento', emoji: '📥',
          mensagem: `O PAI ${record.numero} teve a conclusão indicada pelo solicitante e aguarda encerramento.`,
        })
        await enviar(dest, `📥 PAI aguarda encerramento — ${record.numero}`, html)
        return ok('pai_fila_encerramento notificado')
      }

      const mensagem = MENSAGEM_PAI_STATUS[status]
      if (!mensagem) return ok('pais: status sem notificação')
      if (!(await flagAtivo(`pai_${status}`))) return ok(`pai_${status}: flag desativada`)

      const html = montarHtmlPAI({
        numero: record.numero, titulo: record.titulo,
        cabecalho: LABEL_PAI_STATUS[status] ?? status, emoji: EMOJI_PAI_STATUS[status] ?? '📄',
        mensagem,
      })
      await enviar([await emailPorId(record.solicitante_id)], `${EMOJI_PAI_STATUS[status] ?? '📄'} ${LABEL_PAI_STATUS[status] ?? status} — ${record.numero}`, html)
      return ok(`pai_${status} notificado`)
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · PAI — novo passo pendente (fila) + conclusão do passo
    // anterior (crítica/superintendente). A reentrada em controladoria_op
    // para FORMALIZAÇÃO (ordem > 1) não repete a notificação de "aprovado"
    // ao solicitante — essa já saiu pelo bloco `pais` acima.
    // ═══════════════════════════════════════════════════════════════
    if (table === 'passos_aprovacao' && type === 'INSERT') {
      const { data: pai } = await supabase.from('pais')
        .select('numero,titulo,empresa_id,setor_id,solicitante_id').eq('id', record.pai_id).single()
      if (!pai) return ok('passos_aprovacao: PAI não encontrado')

      const etapa = record.etapa as string
      const ehFormalizacao = etapa === 'controladoria_op' && record.ordem > 1

      const flagFila = ehFormalizacao ? 'pai_fila_formalizacao' : `pai_fila_${etapa}`
      if (await flagAtivo(flagFila)) {
        let dest: string[] = []
        if (etapa === 'controladoria_op') dest = await emailsPorPapelGlobal('controladoria_op')
        else if (etapa === 'aprovador') dest = await emailsAlcada('responsavel_id', pai.empresa_id, pai.setor_id)
        else if (etapa === 'diretor') dest = await emailsAlcada('diretor_id', pai.empresa_id, pai.setor_id)

        const cabecalho = ehFormalizacao ? 'PAI aguarda formalização' : 'PAI aguarda sua aprovação'
        const html = montarHtmlPAI({
          numero: pai.numero, titulo: pai.titulo, cabecalho, emoji: '📥',
          mensagem: ehFormalizacao
            ? `O PAI ${pai.numero} foi aprovado e aguarda formalização.`
            : `O PAI ${pai.numero} está aguardando sua aprovação.`,
        })
        await enviar(dest, `📥 ${cabecalho} — ${pai.numero}`, html)
      }

      // Passo anterior concluído (só crítica -> superintendente e
      // superintendente -> diretor; a aprovação do diretor já notifica o
      // solicitante via `pais` status=aprovado, então não duplica aqui).
      if (record.ordem > 1 && !ehFormalizacao) {
        const flagPasso = etapa === 'aprovador' ? 'pai_critica_ok' : 'pai_aprovador_ok'
        if (await flagAtivo(flagPasso)) {
          const cabecalho = etapa === 'aprovador' ? 'Crítica concluída' : 'Aprovação do Superintendente concluída'
          const mensagem = etapa === 'aprovador'
            ? `A crítica da Controladoria Operacional do PAI ${pai.numero} foi concluída. Segue para o Superintendente.`
            : `A aprovação do Superintendente do PAI ${pai.numero} foi concluída. Segue para o Diretor.`
          const html = montarHtmlPAI({ numero: pai.numero, titulo: pai.titulo, cabecalho, emoji: '✅', mensagem })
          await enviar([await emailPorId(pai.solicitante_id)], `✅ ${cabecalho} — ${pai.numero}`, html)
        }
      }

      return ok('passos_aprovacao notificado')
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · AUMENTO DE VERBA — novo passo pendente (fila).
    // ═══════════════════════════════════════════════════════════════
    if (table === 'passos_aumento' && type === 'INSERT') {
      const { data: aum } = await supabase.from('aumentos_verba')
        .select('numero,valor,empresa_id,setor_id').eq('id', record.aumento_id).single()
      if (!aum) return ok('passos_aumento: aumento não encontrado')

      const etapa = record.etapa as string
      const flagFila = `aum_fila_${etapa}`
      if (!(await flagAtivo(flagFila))) return ok(`${flagFila}: flag desativada`)

      let dest: string[] = []
      if (etapa === 'controladoria_op') dest = await emailsPorPapelGlobal('controladoria_op')
      else if (etapa === 'aprovador') dest = await emailsAlcada('responsavel_id', aum.empresa_id, aum.setor_id)
      else if (etapa === 'diretor') dest = await emailsAlcada('diretor_id', aum.empresa_id, aum.setor_id)
      else if (etapa === 'diretor_ceo') dest = await emailsPorPapelGlobal('diretor_ceo')

      const html = montarHtmlPAI({
        numero: aum.numero, cabecalho: 'Aumento de verba aguarda sua aprovação', emoji: '📥',
        mensagem: `O aumento de verba ${aum.numero} está aguardando sua aprovação.`,
      })
      await enviar(dest, `📥 Aumento de verba aguarda aprovação — ${aum.numero}`, html)
      return ok('passos_aumento notificado')
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · AUMENTO DE VERBA — decisão final / devolução / reprovação
    // (a aprovação final, com ou sem colapso do passo 4, sempre passa por
    // aqui: aplicar_efeito_aumento grava status='aprovado' em aumentos_verba).
    // ═══════════════════════════════════════════════════════════════
    if (table === 'aumentos_verba') {
      if (type !== 'UPDATE') return ok('aumentos_verba: evento ignorado')
      if (!old_record || old_record.status === record.status) return ok('aumentos_verba: status inalterado')

      const status = record.status as string
      const mensagem = MENSAGEM_AUM_STATUS[status]
      if (!mensagem) return ok('aumentos_verba: status sem notificação')
      if (!(await flagAtivo(`aum_${status}`))) return ok(`aum_${status}: flag desativada`)

      const html = montarHtmlPAI({
        numero: record.numero, cabecalho: LABEL_AUM_STATUS[status] ?? status, emoji: EMOJI_AUM_STATUS[status] ?? '📄',
        mensagem,
      })
      await enviar([await emailPorId(record.solicitante_id)], `${EMOJI_AUM_STATUS[status] ?? '📄'} ${LABEL_AUM_STATUS[status] ?? status} — ${record.numero}`, html)
      return ok(`aum_${status} notificado`)
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · CADASTRO E ACESSO
    // ═══════════════════════════════════════════════════════════════
    if (table === 'usuarios') {
      if (type === 'INSERT') {
        if (!(await flagAtivo('usuario_pendente'))) return ok('usuario_pendente: flag desativada')
        const html = montarHtmlPAI({
          cabecalho: 'Novo cadastro aguardando liberação', emoji: '🆕',
          mensagem: `${record.nome ?? record.email} (${record.email}) se cadastrou e aguarda liberação de acesso.`,
        })
        await enviar(await emailsMasters(), `🆕 Novo cadastro aguardando liberação — ${record.nome ?? record.email}`, html)
        return ok('usuario pendente notificado')
      }
      if (type === 'UPDATE') {
        const foiDesbloqueado = old_record?.ativo === false && record.ativo === true
        if (!foiDesbloqueado) return ok('usuarios: sem liberação de acesso nesta atualização')
        if (!(await flagAtivo('usuario_liberado'))) return ok('usuario_liberado: flag desativada')
        const html = montarHtmlPAI({ cabecalho: 'Acesso liberado', emoji: '🔓', mensagem: 'Seu acesso ao sistema foi liberado. Você já pode entrar.' })
        await enviar([record.email], '🔓 Acesso liberado', html)
        return ok('usuario liberado notificado')
      }
      return ok('usuarios: evento ignorado')
    }

    // Primeira atribuição de uma pessoa (o caminho real de "liberar acesso"
    // nesta base — a maioria dos usuários nasce com ativo=true e ganha
    // acesso ao receber a primeira linha em atribuicoes, não por um UPDATE
    // em usuarios.ativo).
    if (table === 'atribuicoes' && type === 'INSERT') {
      if (record.papel === 'master') return ok('atribuicoes: master, sem notificação')
      const { count } = await supabase.from('atribuicoes').select('id', { count: 'exact', head: true }).eq('usuario_id', record.usuario_id)
      if ((count ?? 0) > 1) return ok('atribuicoes: não é a primeira atribuição')
      if (!(await flagAtivo('usuario_liberado'))) return ok('usuario_liberado: flag desativada')
      const email = await emailPorId(record.usuario_id)
      if (!email) return ok('atribuicoes: usuário sem e-mail')
      const html = montarHtmlPAI({ cabecalho: 'Acesso liberado', emoji: '🔓', mensagem: 'Seu acesso ao sistema foi liberado. Você já pode entrar.' })
      await enviar([email], '🔓 Acesso liberado', html)
      return ok('primeira atribuição notificada')
    }

    // ═══════════════════════════════════════════════════════════════
    // ETAPA 9 · AVISO DE VENCIMENTO (chamado pela função de banco
    // verificar_vencimento_pai, via pg_cron ou agendador externo — não é
    // um trigger de tabela, por isso "table" é um nome sintético).
    // ═══════════════════════════════════════════════════════════════
    if (table === 'aviso_vencimento_pai' && type === 'CRON') {
      if (!(await flagAtivo('pai_vencimento'))) return ok('pai_vencimento: flag desativada')
      const dest = await emailsPorPapelGlobal('controladoria_contabil')
      const venceu = new Date(record.previsao_conclusao) <= new Date()
      const html = montarHtmlPAI({
        numero: record.numero, titulo: record.titulo,
        cabecalho: venceu ? 'PAI com prazo vencido' : 'PAI com prazo se aproximando', emoji: '⏰',
        mensagem: venceu
          ? `O PAI ${record.numero} venceu o prazo previsto (${record.previsao_conclusao}) e ainda não foi encerrado.`
          : `O PAI ${record.numero} tem previsão de conclusão em ${record.previsao_conclusao} e ainda não foi encerrado.`,
      })
      await enviar(dest, `⏰ ${venceu ? 'PAI com prazo vencido' : 'PAI com prazo se aproximando'} — ${record.numero}`, html)
      return ok('aviso_vencimento_pai notificado')
    }

    return ok('tabela ignorada')
  } catch (e) {
    return new Response(JSON.stringify({ erro: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
