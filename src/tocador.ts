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

interface Estado { clipe: string; inicio: number; tempo: number; loop: boolean; fala?: BlocoFala; }

// ---------- respiros: trechos sem voz dentro de uma fala ----------
export const LIMIAR_SILENCIO = 0.08;  // volume (0 a 1) abaixo do qual é silêncio
export const RESPIRO_MINIMO = 0.25;   // pausas menores não trocam nada (o personagem não fica tremendo)
export const ANTECIPA = 0.1;          // o gesto volta um pouco antes da voz, como quem toma ar para falar
export const TROCA_RESPIRO = 0.2;     // transição entre falar_corpo e falar_respiro

const cacheRespiros = new Map<string, [number, number][]>();
/** Respiros achados pela curva de volume da fala (segundos desde o começo da fala). */
export function respirosAuto(fala: string): [number, number][] {
  const cv = biblioteca.curvas.get(fala);
  if (!cv) return [];
  const chave = fala + ':' + cv.valores.length;
  const pronto = cacheRespiros.get(chave);
  if (pronto) return pronto;
  const q = cv.quadros_por_segundo, v = cv.valores;
  const fimFala = duracaoFala(fala);
  const lista: [number, number][] = [];
  let ini = -1;
  for (let i = 0; i <= v.length; i++) {
    const silencio = i < v.length && v[i] < LIMIAR_SILENCIO;
    if (silencio && ini < 0) ini = i;
    if (!silencio && ini >= 0) {
      const a = ini / q, z = i >= v.length ? fimFala : i / q;
      const fim = i >= v.length ? z : z - ANTECIPA; // no fim da fala não precisa antecipar
      if (z - a >= RESPIRO_MINIMO && fim - a >= 0.15) lista.push([+a.toFixed(3), +fim.toFixed(3)]);
      ini = -1;
    }
  }
  cacheRespiros.set(chave, lista);
  return lista;
}
export function respirosDe(b: BlocoFala): [number, number][] { return b.respiros ?? respirosAuto(b.fala); }

/** Quanto do corpo está em "respiro" (0 = gesto de fala, 1 = respiro), com transição suave. */
export function pesoRespiro(b: BlocoFala, tl: number): number {
  let p = 0;
  for (const [a, z] of respirosDe(b)) {
    const entra = Math.min(1, Math.max(0, (tl - a) / TROCA_RESPIRO));
    const sai = Math.min(1, Math.max(0, (z + TROCA_RESPIRO / 2 - tl) / TROCA_RESPIRO));
    p = Math.max(p, Math.min(entra, sai));
  }
  return suave(p);
}

/** Qual clipe o ator está tocando em t: bloco de animação > fala (gesto/respiro) > clipe inicial. */
function estadoClipe(c: Cena, a: Ator, t: number, clipes: string[]): Estado {
  const blocos = c.faixas.flatMap((f) => (f.tipo === 'animacao' && f.alvo === a.id ? f.blocos : []));
  const ativo = [...blocos].reverse().find((b) => t >= b.t && t < b.t + b.dur);
  if (ativo) return { clipe: ativo.clipe, inicio: ativo.t, tempo: t - ativo.t, loop: ativo.loop };
  const fins = blocos.filter((b) => b.t + b.dur <= t).map((b) => b.t + b.dur);
  const corpo = clipes.includes('falar_corpo');
  if (a.falarAutomatico !== false && (corpo || clipes.includes('falar'))) {
    for (const b of falasDa(c)) {
      if (atorDaFala(c, b)?.id !== a.id) continue;
      const fim = b.t + duracaoFala(b.fala);
      if (t >= b.t && t < fim) return { clipe: corpo ? 'falar_corpo' : 'falar', inicio: b.t, tempo: t - b.t, loop: true, fala: b };
      if (fim <= t) fins.push(fim);
    }
  }
  const base = baseDo(a, clipes);
  return { clipe: base, inicio: fins.length ? Math.max(...fins) : -1e9, tempo: t, loop: true };
}
const baseDo = (a: Ator, clipes: string[]) => (a.animacao && clipes.includes(a.animacao) ? a.animacao : clipes.includes('idle') ? 'idle' : clipes[0] ?? '');

/** Um estado vira camadas: na fala, o gesto e o respiro tocam juntos no mesmo ritmo e só muda o peso. */
function expandir(e: Estado, peso: number, a: Ator, clipes: string[], t: number): Camada[] {
  if (!e.fala) return [{ clipe: e.clipe, tempo: e.tempo, peso, loop: e.loop }];
  const p = pesoRespiro(e.fala, e.tempo);
  const respiro = e.clipe === 'falar_corpo' && clipes.includes('falar_respiro')
    ? { clipe: 'falar_respiro', tempo: e.tempo }
    : { clipe: baseDo(a, clipes), tempo: t }; // modelo antigo: no respiro volta ao clipe parado
  const out: Camada[] = [];
  if (p < 1) out.push({ clipe: e.clipe, tempo: e.tempo, peso: peso * (1 - p), loop: true });
  if (p > 0 && respiro.clipe) out.push({ clipe: respiro.clipe, tempo: respiro.tempo, peso: peso * p, loop: true });
  return out;
}

/** Camadas de animação com a transição suave (como o crossfade de 0,25 s da galeria). */
export function camadasEm(c: Cena, a: Ator, t: number, clipes: string[]): Camada[] {
  const agora = estadoClipe(c, a, t, clipes);
  if (!agora.clipe) return [];
  const passou = t - agora.inicio;
  if (passou >= TRANSICAO_CLIPE) return expandir(agora, 1, a, clipes, t);
  const antes = estadoClipe(c, a, agora.inicio - 1e-4, clipes);
  if (!antes.clipe || (antes.clipe === agora.clipe && !antes.fala && !agora.fala)) return expandir(agora, 1, a, clipes, t);
  const k = passou / TRANSICAO_CLIPE;
  return [...expandir({ ...antes, tempo: antes.tempo + passou }, 1 - k, a, clipes, t), ...expandir(agora, k, a, clipes, t)];
}

/** Boca guiada pela voz: abertura de 0 a 1 e o tempo dentro da fala (para o desenho das barras).
 *  null = ninguém falando (a boca fica fechada). */
export function bocaEm(c: Cena, a: Ator, t: number): { abertura: number; tempo: number } | null {
  if (a.falarAutomatico === false) return null;
  for (const b of falasDa(c)) {
    if (t < b.t || t >= b.t + duracaoFala(b.fala) || atorDaFala(c, b)?.id !== a.id) continue;
    const tl = t - b.t;
    const nivel = nivelSuave(b.fala, tl + 0.03); // a boca adianta um quadro: parece mais natural
    // volume normalizado; cada modelo ajusta a curva (envelope abre por sílaba, barras ficam mais vivas)
    const abre = Math.min(1, Math.max(0, (nivel - LIMIAR_SILENCIO) / 0.9));
    return { abertura: abre * (1 - pesoRespiro(b, tl)), tempo: tl };
  }
  return null;
}

/** Volume da curva interpolado entre os quadros (30 por segundo), sem degraus. */
function nivelSuave(fala: string, tl: number): number {
  const cv = biblioteca.curvas.get(fala);
  if (!cv) return 0;
  const x = tl * cv.quadros_por_segundo;
  const i = Math.floor(x), f = x - i;
  const v = (k: number) => (k >= 0 && k < cv.valores.length ? cv.valores[k] : 0);
  return v(i) * (1 - f) + v(i + 1) * f;
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
interface Tocando { fonte: AudioBufferSourceNode; ganho: GainNode; musica: boolean; volume: number; relogio?: boolean; }
let tocando: Tocando[] = [];

/** Começa o som da cena a partir de t0 (o relógio do áudio manda no tempo). */
export function tocarSom(c: Cena, t0: number): number {
  pararSom();
  const ctx = contextoAudio();
  const agora = ctx.currentTime + 0.05;
  const agendar = (buf: AudioBuffer, inicio: number, volume: number, musica: boolean, loop = false, fim?: number, relogio = false) => {
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
    tocando.push({ fonte, ganho, musica, volume, relogio });
  };
  for (const b of falasDa(c)) { const buf = bufferPronto(b.fala); if (buf) agendar(buf, b.t, 1, false, false, undefined, !!atorDaFala(c, b)?.relogio); }
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

/** Voz de quem está no relógio: normal quando o jogador olha, mais baixa quando não olha. */
export const VOLUME_RELOGIO_SEM_OLHAR = 0.4;
export function volumeDoRelogio(olhando: boolean): void {
  const ctx = contextoAudio();
  for (const s of tocando) if (s.relogio) s.ganho.gain.setTargetAtTime(s.volume * (olhando ? 1 : VOLUME_RELOGIO_SEM_OLHAR), ctx.currentTime, 0.08);
}

/** Toca uma fala solta (lista de falas por evento). Devolve false se o áudio não está no editor. */
let soltaAtual: AudioBufferSourceNode | null = null;
export function ouvirFala(id: string): boolean {
  const buf = bufferPronto(id);
  try { soltaAtual?.stop(); } catch { /* já parou */ }
  if (!buf) return false;
  const ctx = contextoAudio();
  const fonte = ctx.createBufferSource(); fonte.buffer = buf; fonte.connect(ctx.destination); fonte.start();
  soltaAtual = fonte;
  return true;
}

export function somFalta(arquivo: string): boolean { return !biblioteca.audios.has(arquivo); }
