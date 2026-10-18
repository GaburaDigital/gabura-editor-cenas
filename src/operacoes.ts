// Tudo o que muda a cena: adicionar e apagar faixas, blocos, atores e cenas; mover pelo gizmo;
// encadear as falas. Cada operação guarda o "antes" para o Ctrl+Z.

import { biblioteca, duracaoFala } from './arquivos';
import { cena, estado, guardarParaDesfazer, mudou } from './estado';
import { abrirJanela, aviso, confirmar, el } from './dom';
import { itensDe } from './linha_tempo';
import { NOME_TIPO, novoId, type Ator, type Cena, type Faixa, type TipoFaixa, type Vec3 } from './modelo';
import { duracaoItem, falasDa, poseAtor, poseJogador } from './tocador';
import { desfazerUltimo } from './estado';

const CORES = ['#4fd6d0', '#8fd651', '#8a5cf0', '#ff7a6b', '#ffd166', '#b9c2c8'];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const v3 = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

function nomeModelo(m: string): string { return m.replace(/\.glb$/i, '').replace(/_/g, ' '); }

export function novaCena(): Cena {
  return { id: 'cena_nova', nome: 'Cena nova', duracao: 20, fundo: '#0a141c', jogador: { pos: [0, 0, 0], rotY: 0 }, cenario: [], atores: [], faixas: [] };
}

export function adicionarAtor(modelo: string): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  const base = modelo.replace(/\.glb$/i, '').replace(/_(escala|leve)$/, '');
  let id = base, n = 2;
  while (c.atores.some((a) => a.id === id) || c.cenario.some((o) => o.id === id)) id = `${base}_${n++}`;
  const j = poseJogador(c, estado.tempo);
  const a: Ator = {
    id, nome: nomeModelo(base), modelo, cor: CORES[c.atores.length % CORES.length],
    personagem: Object.keys(estado.pacote?.personagens ?? {}).find((p) => base.startsWith(p)),
    holograma: false, falarAutomatico: true,
    pos: [r3(j.pos[0]), 0, r3(j.pos[2] - 2)], rotY: 0, escala: 1, visivel: true,
  };
  c.atores.push(a);
  estado.atorSel = id; estado.selecao = null;
  mudou();
}

export function adicionarCenario(modelo: string): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  const base = modelo.replace(/\.glb$/i, '');
  let id = base, n = 2;
  while (c.atores.some((a) => a.id === id) || c.cenario.some((o) => o.id === id)) id = `${base}_${n++}`;
  c.cenario.push({ id, modelo, pos: [0, 0, 0], rotY: 0, escala: 1 });
  estado.atorSel = id; estado.selecao = null;
  mudou();
}

/** Coloca uma fala na faixa de falas, no instante da linha vermelha. */
export function adicionarFala(fala: string, t = estado.tempo): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  let f = c.faixas.find((x) => x.tipo === 'fala') as Extract<Faixa, { tipo: 'fala' }> | undefined;
  if (!f) { f = { id: novoId('falas'), nome: 'Falas', tipo: 'fala', blocos: [] }; c.faixas.push(f); }
  const b = { t: r3(t), fala };
  f.blocos.push(b); f.blocos.sort((x, y) => x.t - y.t);
  c.duracao = Math.max(c.duracao, r3(t + duracaoFala(fala) + 1));
  estado.selecao = { faixa: f.id, indice: f.blocos.indexOf(b) };
  mudou();
}

export function adicionarSom(arquivo: string, t = estado.tempo): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  let f = c.faixas.find((x) => x.tipo === 'som') as Extract<Faixa, { tipo: 'som' }> | undefined;
  if (!f) { f = { id: novoId('som'), nome: 'Som e música', tipo: 'som', blocos: [] }; c.faixas.push(f); }
  const b = { t: r3(t), dur: 5, arquivo, volume: 1, loop: false };
  f.blocos.push(b); f.blocos.sort((x, y) => x.t - y.t);
  estado.selecao = { faixa: f.id, indice: f.blocos.indexOf(b) };
  mudou();
}

/** Duplo clique numa pista: cria um item com valores razoáveis para aquele tipo. */
export function novoItem(f: Faixa, t: number): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  let novo: { t: number } & Record<string, unknown>;
  switch (f.tipo) {
    case 'mover': {
      const p = f.alvo === 'jogador' ? poseJogador(c, t) : poseAtor(c, c.atores.find((a) => a.id === f.alvo) ?? { pos: [0, 0, 0], rotY: 0, escala: 1 } as Ator, t);
      novo = { t, pos: v3(p.pos), rotY: r3(p.rotY), escala: r3(p.escala), curva: 'linear' }; f.chaves.push(novo as never); break;
    }
    case 'visivel': {
      const ant = [...f.chaves].reverse().find((k) => k.t <= t);
      novo = { t, visivel: ant ? !ant.visivel : false }; f.chaves.push(novo as never); break;
    }
    case 'animacao': novo = { t, dur: 2, clipe: 'atencao', loop: false }; f.blocos.push(novo as never); break;
    case 'fala': {
      const usadas = new Set(falasDa(c).map((b) => b.fala));
      const livre = [...biblioteca.falas.keys()].find((id) => !usadas.has(id)) ?? [...biblioteca.falas.keys()][0];
      if (!livre) { aviso('Nenhuma fala na biblioteca. Arraste o ZIP da dublagem para o editor.', 'erro'); return; }
      novo = { t, fala: livre }; f.blocos.push(novo as never); break;
    }
    case 'som': novo = { t, dur: 5, arquivo: 'mus_nova', volume: 1, loop: true }; f.blocos.push(novo as never); break;
    case 'seta': novo = { t, dur: 3, alvo: c.atores[0]?.id ?? c.cenario[0]?.id ?? '' }; f.blocos.push(novo as never); break;
    case 'aguardar': novo = { t, condicao: { tipo: 'manual', texto: 'O jogador faz algo' } }; f.blocos.push(novo as never); break;
    case 'evento': novo = { t, nome: 'evento_novo' }; f.blocos.push(novo as never); break;
  }
  itensDe(f).sort((a, b) => a.t - b.t);
  estado.selecao = { faixa: f.id, indice: itensDe(f).indexOf(novo) };
  mudou();
}

/** Janela para escolher o tipo e o alvo da faixa nova. */
export function janelaNovaFaixa(): void {
  const c = cena(); if (!c) return;
  const tipos = Object.keys(NOME_TIPO) as TipoFaixa[];
  const selTipo = el('select', { class: 'campo', id: 'nf-tipo' }, tipos.map((t) => el('option', { value: t }, NOME_TIPO[t])));
  const alvos = [['jogador', 'Jogador'], ...c.atores.map((a) => [a.id, a.nome]), ...c.cenario.map((o) => [o.id, o.id + ' (cenário)'])];
  const selAlvo = el('select', { class: 'campo', id: 'nf-alvo' }, alvos.map(([v, n]) => el('option', { value: v }, n)));
  const linhaAlvo = el('div', { class: 'campo-linha' }, el('label', { for: 'nf-alvo', class: 'rotulo' }, 'Em quem'), selAlvo);
  const atualizar = () => { linhaAlvo.hidden = !['mover', 'animacao', 'visivel'].includes(selTipo.value); };
  selTipo.addEventListener('change', atualizar); atualizar();
  const criar = el('button', { class: 'bt lima', type: 'submit' }, 'Criar faixa');
  const cancelar = el('button', { class: 'bt', type: 'button' }, 'Cancelar');
  const form = el('form', { class: 'modal-corpo' }, el('h3', {}, 'Nova faixa'),
    el('div', { class: 'campo-linha' }, el('label', { for: 'nf-tipo', class: 'rotulo' }, 'Tipo'), selTipo), linhaAlvo,
    el('div', { class: 'modal-bts' }, cancelar, criar));
  const j = abrirJanela(form);
  cancelar.onclick = () => j.fechar();
  form.addEventListener('submit', (e) => {
    e.preventDefault(); j.fechar();
    const tipo = selTipo.value as TipoFaixa;
    const alvo = selAlvo.value;
    const nomeAlvo = alvos.find(([v]) => v === alvo)?.[1] ?? alvo;
    guardarParaDesfazer();
    const id = novoId(tipo);
    const nome = ['mover', 'animacao', 'visivel'].includes(tipo) ? `${nomeAlvo} · ${NOME_TIPO[tipo].toLowerCase()}` : NOME_TIPO[tipo];
    const f = (tipo === 'mover' ? { id, nome, tipo, alvo, chaves: [] }
      : tipo === 'visivel' ? { id, nome, tipo, alvo, chaves: [] }
        : tipo === 'animacao' ? { id, nome, tipo, alvo, blocos: [] }
          : { id, nome, tipo, blocos: [] }) as Faixa;
    c.faixas.push(f);
    estado.selecao = { faixa: id, indice: -1 };
    mudou();
    aviso('Faixa criada. Dê dois cliques na pista para adicionar o primeiro item.', 'ok');
  });
}

export async function apagarFaixa(f: Faixa): Promise<void> {
  const c = cena(); if (!c) return;
  const n = itensDe(f).length;
  if (n && !await confirmar('Apagar faixa?', `A faixa "${f.nome}" tem ${n} ${n === 1 ? 'item' : 'itens'}. Dá para desfazer com Ctrl+Z.`)) return;
  guardarParaDesfazer();
  c.faixas = c.faixas.filter((x) => x !== f);
  estado.selecao = null;
  mudou();
}

/** Apaga o item selecionado (com aviso para desfazer). */
export function apagarSelecionado(): void {
  const c = cena(); const s = estado.selecao;
  if (!c || !s || s.indice < 0) return;
  const f = c.faixas.find((x) => x.id === s.faixa);
  if (!f) return;
  guardarParaDesfazer();
  itensDe(f).splice(s.indice, 1);
  estado.selecao = null;
  mudou();
  aviso('Item apagado.', 'info', { texto: 'Desfazer', acao: () => desfazerUltimo() });
}

export async function apagarAtor(id: string): Promise<void> {
  const c = cena(); if (!c) return;
  const usado = c.faixas.filter((f) => ('alvo' in f && f.alvo === id)).length;
  if (!await confirmar('Apagar da cena?', `"${id}" sai da cena${usado ? ` junto com ${usado} faixa(s) dele` : ''}. Dá para desfazer com Ctrl+Z.`)) return;
  guardarParaDesfazer();
  c.atores = c.atores.filter((a) => a.id !== id);
  c.cenario = c.cenario.filter((o) => o.id !== id);
  c.faixas = c.faixas.filter((f) => !('alvo' in f && f.alvo === id));
  estado.atorSel = ''; estado.selecao = null;
  mudou();
}

/** O gizmo da janela 3D soltou: grava a posição.
 *  Se a coisa tem faixa "mover", cria ou atualiza o ponto-chave no instante atual; senão muda a posição inicial. */
export function gravarPosicao(id: string, pos: Vec3, rotY: number, escala: number): void {
  const c = cena(); if (!c) return;
  guardarParaDesfazer();
  const t = r3(estado.tempo);
  const faixa = c.faixas.find((f) => f.tipo === 'mover' && f.alvo === id) as Extract<Faixa, { tipo: 'mover' }> | undefined;
  const pose = { pos: v3(pos), rotY: r3(rotY), escala: r3(escala) };
  if (faixa) {
    const perto = faixa.chaves.find((k) => Math.abs(k.t - t) < 0.06);
    if (perto) Object.assign(perto, pose);
    else { faixa.chaves.push({ t, ...pose, curva: 'linear' }); faixa.chaves.sort((a, b) => a.t - b.t); }
    const k = faixa.chaves.find((x) => Math.abs(x.t - t) < 0.06)!;
    estado.selecao = { faixa: faixa.id, indice: faixa.chaves.indexOf(k) };
    aviso(perto ? `Ponto-chave em ${t.toFixed(2).replace('.', ',')} s atualizado.` : `Ponto-chave novo em ${t.toFixed(2).replace('.', ',')} s.`, 'ok');
  } else if (id === 'jogador') {
    c.jogador.pos = pose.pos; c.jogador.rotY = pose.rotY;
  } else {
    const a = c.atores.find((x) => x.id === id) ?? c.cenario.find((x) => x.id === id);
    if (a) { a.pos = pose.pos; a.rotY = pose.rotY; a.escala = pose.escala; }
  }
  mudou();
}

/** Encadear: cada fala começa "pausa" segundos depois da anterior acabar.
 *  Tudo o que vem depois de cada fala (hologramas, setas, eventos) anda junto. */
export function encadearFalas(pausa: number): void {
  const c = cena(); if (!c) return;
  const f = c.faixas.find((x) => x.tipo === 'fala') as Extract<Faixa, { tipo: 'fala' }> | undefined;
  if (!f || f.blocos.length < 2) return;
  guardarParaDesfazer();
  for (let i = 1; i < f.blocos.length; i++) {
    const ant = f.blocos[i - 1];
    const quer = r3(ant.t + duracaoFala(ant.fala) + pausa);
    const atual = f.blocos[i].t;
    const delta = quer - atual;
    if (Math.abs(delta) < 1e-4) continue;
    // empurra tudo o que começa em "atual" ou depois (menos o que já foi encadeado)
    const limite = atual - 0.6; // pega também o holograma que surge um pouco antes da fala
    for (const fx of c.faixas) for (const it of itensDe(fx)) {
      if (fx === f) { if (f.blocos.indexOf(it as never) >= i) it.t = r3(it.t + delta); }
      else if (it.t >= limite) it.t = r3(it.t + delta);
    }
    c.duracao = r3(Math.max(1, c.duracao + delta));
  }
  mudou();
  aviso(`Falas encadeadas com ${String(pausa).replace('.', ',')} s entre elas.`, 'ok', { texto: 'Desfazer', acao: () => desfazerUltimo() });
}

/** Ajusta a duração da cena ao último item (mais uma folga). */
export function ajustarDuracao(): void {
  const c = cena(); if (!c) return;
  let fim = 0;
  for (const f of c.faixas) itensDe(f).forEach((it, i) => { fim = Math.max(fim, it.t + duracaoItem(f, i)); });
  guardarParaDesfazer();
  c.duracao = r3(fim + 0.5);
  mudou();
}
