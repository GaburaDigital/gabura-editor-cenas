// O "tocador de cenas": calcula como a cena está num instante qualquer (posições, animações, falas,
// seta, legenda) e toca o som. É o mesmo cálculo que o jogo vai fazer no Quest.

import { biblioteca, bufferPronto, contextoAudio, duracaoFala } from './arquivos';
import type { Ator, BlocoFala, Cena, ChaveMover, Faixa, Vec3 } from './modelo';
import type { Camada } from './mundo';

export const TRANSICAO_CLIPE = 0.25; // segundos de mistura entre um clipe e outro

const suave = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngulo(a: number, b: number, k: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (Math.abs(d) < 1e-9) d = 0;
  return a + d * k;
}

export interface Pose { pos: Vec3; rotY: number; escala: number; }

/** Posição num instante, pelos pontos-chave. Antes do primeiro e depois do último, fica parado. */
export function poseEm(chaves: ChaveMover[], t: number, padrao: Pose): Pose {
  if (!chaves.length) return padrao;
  if (t <= chaves[0].t) return chaves[0];
  const ult = chaves[chaves.length - 1];
  if (t >= ult.t) return ult;
  let i = 0;
  while (i < chaves.length - 2 && chaves[i + 1].t <= t) i++;
  const a = chaves[i], b = chaves[i + 1];
  let k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  if (a.curva === 'suave') k = suave(k);
  return {
    pos: [lerp(a.pos[0], b.pos[0], k), lerp(a.pos[1], b.pos[1], k), lerp(a.pos[2], b.pos[2], k)],
    rotY: lerpAngulo(a.rotY, b.rotY, k),
    escala: lerp(a.escala, b.escala, k),
  };
}

/** Quem fala num bloco de fala: o ator escolhido, ou o ator do mesmo personagem da gravação. */
export function atorDaFala(c: Cena, b: BlocoFala): Ator | undefined {
  if (b.ator) return c.atores.find((a) => a.id === b.ator);
  const p = biblioteca.falas.get(b.fala)?.personagem ?? b.fala.split('_').slice(1, -1).join('_');
  return c.atores.find((a) => a.personagem === p);
}

export function falasDa(c: Cena): BlocoFala[] {
  return c.faixas.flatMap((f) => (f.tipo === 'fala' ? f.blocos : []));
}

interface Estado { clipe: string; inicio: number; tempo: number; loop: boolean; }

/** Qual clipe o ator está tocando em t: bloco de animação > "falar" automático > clipe inicial. */
function estadoClipe(c: Cena, a: Ator, t: number, clipes: string[]): Estado {
  const blocos = c.faixas.flatMap((f) => (f.tipo === 'animacao' && f.alvo === a.id ? f.blocos : []));
  const ativo = [...blocos].reverse().find((b) => t >= b.t && t < b.t + b.dur);
  if (ativo) return { clipe: ativo.clipe, inicio: ativo.t, tempo: t - ativo.t, loop: ativo.loop };
  const fins = blocos.filter((b) => b.t + b.dur <= t).map((b) => b.t + b.dur);
  if (a.falarAutomatico !== false && clipes.includes('falar')) {
    for (const b of falasDa(c)) {
      if (atorDaFala(c, b)?.id !== a.id) continue;
      const fim = b.t + duracaoFala(b.fala);
      if (t >= b.t && t < fim) return { clipe: 'falar', inicio: b.t, tempo: t - b.t, loop: true };
      if (fim <= t) fins.push(fim);
    }
  }
  const base = a.animacao && clipes.includes(a.animacao) ? a.animacao : clipes.includes('idle') ? 'idle' : clipes[0] ?? '';
  return { clipe: base, inicio: fins.length ? Math.max(...fins) : -1e9, tempo: t, loop: true };
}

/** Camadas de animação com a transição suave (como o crossfade de 0,25 s da galeria). */
export function camadasEm(c: Cena, a: Ator, t: number, clipes: string[]): Camada[] {
  const agora = estadoClipe(c, a, t, clipes);
  if (!agora.clipe) return [];
  const passou = t - agora.inicio;
  if (passou >= TRANSICAO_CLIPE) return [{ clipe: agora.clipe, tempo: agora.tempo, peso: 1, loop: agora.loop }];
  const antes = estadoClipe(c, a, agora.inicio - 1e-4, clipes);
  if (!antes.clipe || antes.clipe === agora.clipe) return [{ clipe: agora.clipe, tempo: agora.tempo, peso: 1, loop: agora.loop }];
  const k = passou / TRANSICAO_CLIPE;
  return [
    { clipe: antes.clipe, tempo: antes.tempo + passou, peso: 1 - k, loop: antes.loop },
    { clipe: agora.clipe, tempo: agora.tempo, peso: k, loop: agora.loop },
  ];
}

export function visivelEm(c: Cena, a: Ator, t: number): boolean {
  let v = a.visivel;
  for (const f of c.faixas) {
    if (f.tipo !== 'visivel' || f.alvo !== a.id) continue;
    for (const k of f.chaves) if (k.t <= t) v = k.visivel;
  }
  return v;
}

export function poseAtor(c: Cena, a: Ator, t: number): Pose {
  const f = c.faixas.find((x) => x.tipo === 'mover' && x.alvo === a.id) as Extract<Faixa, { tipo: 'mover' }> | undefined;
  return poseEm(f?.chaves ?? [], t, a);
}

export function poseJogador(c: Cena, t: number): Pose {
  const f = c.faixas.find((x) => x.tipo === 'mover' && x.alvo === 'jogador') as Extract<Faixa, { tipo: 'mover' }> | undefined;
  return poseEm(f?.chaves ?? [], t, { pos: c.jogador.pos, rotY: c.jogador.rotY, escala: 1 });
}

/** A fala que está tocando em t (a que começou por último), para a legenda e o brilho. */
export function falasAtivas(c: Cena, t: number): BlocoFala[] {
  return falasDa(c).filter((b) => t >= b.t && t < b.t + duracaoFala(b.fala)).sort((x, y) => x.t - y.t);
}

export function nivelVoz(fala: string, tLocal: number): number {
  const cv = biblioteca.curvas.get(fala);
  if (!cv) return 0;
  const i = Math.floor(tLocal * cv.quadros_por_segundo);
  return i >= 0 && i < cv.valores.length ? cv.valores[i] : 0;
}

export function legendaEm(c: Cena, personagens: Record<string, string>, t: number): { quem: string; texto: string } | null {
  const ativas = falasAtivas(c, t);
  const b = ativas[ativas.length - 1];
  if (!b) return null;
  const info = biblioteca.falas.get(b.fala);
  const p = info?.personagem ?? atorDaFala(c, b)?.personagem ?? '';
  return { quem: personagens[p] ?? atorDaFala(c, b)?.nome ?? p, texto: info?.texto ?? `(${b.fala})` };
}

export function setaEm(c: Cena, t: number): string | null {
  for (const f of c.faixas) if (f.tipo === 'seta') for (const b of f.blocos) if (t >= b.t && t < b.t + b.dur) return b.alvo;
  return null;
}

/** Duração de qualquer item da linha do tempo (as falas usam a duração do áudio). */
export function duracaoItem(f: Faixa, i: number): number {
  switch (f.tipo) {
    case 'fala': return duracaoFala(f.blocos[i].fala);
    case 'animacao': case 'som': case 'seta': return f.blocos[i].dur;
    default: return 0;
  }
}

// ---------- som: falas e músicas agendadas no relógio do áudio ----------
interface Tocando { fonte: AudioBufferSourceNode; ganho: GainNode; musica: boolean; volume: number; }
let tocando: Tocando[] = [];

/** Começa o som da cena a partir de t0 (o relógio do áudio manda no tempo). */
export function tocarSom(c: Cena, t0: number): number {
  pararSom();
  const ctx = contextoAudio();
  const agora = ctx.currentTime + 0.05;
  const agendar = (buf: AudioBuffer, inicio: number, volume: number, musica: boolean, loop = false, fim?: number) => {
    const dentro = t0 - inicio;
    if (!loop && dentro >= buf.duration) return;
    if (fim !== undefined && t0 >= fim) return;
    const fonte = ctx.createBufferSource(); fonte.buffer = buf; fonte.loop = loop;
    const ganho = ctx.createGain(); ganho.gain.value = volume;
    fonte.connect(ganho).connect(ctx.destination);
    const quando = agora + Math.max(0, inicio - t0);
    const offset = Math.max(0, dentro);
    fonte.start(quando, loop ? offset % buf.duration : offset);
    if (fim !== undefined) fonte.stop(agora + (fim - t0));
    tocando.push({ fonte, ganho, musica, volume });
  };
  for (const b of falasDa(c)) { const buf = bufferPronto(b.fala); if (buf) agendar(buf, b.t, 1, false); }
  for (const f of c.faixas) {
    if (f.tipo !== 'som') continue;
    for (const b of f.blocos) {
      const buf = bufferPronto(b.arquivo);
      if (buf) agendar(buf, b.t, b.volume, /^mus/i.test(b.arquivo), b.loop, b.t + b.dur);
    }
  }
  return agora; // instante do relógio do áudio em que t0 acontece
}

export function pararSom(): void {
  for (const s of tocando) { try { s.fonte.stop(); } catch { /* já parou */ } s.fonte.disconnect(); }
  tocando = [];
}

/** A música abaixa sozinha enquanto alguém fala. */
export function abaixarMusica(alguemFalando: boolean): void {
  const ctx = contextoAudio();
  for (const s of tocando) if (s.musica) s.ganho.gain.setTargetAtTime(s.volume * (alguemFalando ? 0.35 : 1), ctx.currentTime, 0.15);
}

export function somFalta(arquivo: string): boolean { return !biblioteca.audios.has(arquivo); }
