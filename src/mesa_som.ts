// Mesa de som: volume de cada grupo (Músicas, Efeitos, Vozes), de cada som e quanto a música
// abaixa quando alguém fala. Os valores ficam no pacote de cenas (campo "mixagem") e o jogo usa os mesmos.
// Analogia Godot: é como os "Audio Buses" (Master, Música, Efeitos) com o volume de cada AudioStreamPlayer.

import { biblioteca, prepararFalas, salvarConfig } from './arquivos';
import { abrirJanela, aviso, el } from './dom';
import { estado, guardarParaDesfazer } from './estado';
import type { GrupoSom, Mixagem } from './modelo';
import * as tocador from './tocador';

const NOME_GRUPO: Record<GrupoSom, string> = { musica: 'Músicas', efeitos: 'Efeitos', vozes: 'Vozes' };
const pct = (v: number) => `${Math.round(v * 100)}%`;

function mixagem(): Mixagem | null {
  const p = estado.pacote; if (!p) return null;
  p.mixagem ??= { grupos: { musica: 1, efeitos: 1, vozes: 1 }, abaixar_musica: tocador.ABAIXAR_PADRAO, sons: {}, por_evento: [] };
  return p.mixagem;
}

// salva sem redesenhar a tela inteira (arrastar o controle fica leve)
let salvar = 0;
function guardar(): void {
  tocador.reaplicarVolumes();
  window.clearTimeout(salvar);
  salvar = window.setTimeout(() => { if (estado.pacote) void salvarConfig('pacote', estado.pacote); }, 400);
}

/** Controle deslizante de 0 a 100% com o número ao lado. */
function deslizante(rotulo: string, valor: number, max: number, mudar: (v: number) => void, dica = ''): HTMLElement {
  const num = el('span', { class: 'mesa-num' }, pct(valor));
  const r = el('input', { type: 'range', min: '0', max: String(Math.round(max * 100)), step: '1', value: String(Math.round(valor * 100)), 'aria-label': rotulo });
  r.addEventListener('pointerdown', () => guardarParaDesfazer());
  r.addEventListener('input', () => { const v = Number(r.value) / 100; num.textContent = pct(v); mudar(v); guardar(); });
  return el('label', { class: 'mesa-linha', title: dica }, el('span', { class: 'mesa-rotulo' }, rotulo), r, num);
}

export async function abrirMesaDeSom(): Promise<void> {
  const m = mixagem();
  if (!m) return;
  // decodifica todos os sons da biblioteca para dar para ouvir na hora
  const sons = [...biblioteca.audios.keys()].filter((k) => /^(mus|sfx)_/.test(k));
  await prepararFalas(sons);
  const nomes = new Set([...sons, ...Object.keys(m.sons)]);
  const lista = [...nomes].sort();
  const eventosDe = (id: string) => m.por_evento.filter((e) => e.som === id).map((e) => e.evento + (e.loop ? ' (loop)' : ''));

  const linhaSom = (id: string) => {
    const s = m.sons[id] ?? (m.sons[id] = { volume: tocador.grupoDe(id) === 'musica' ? 0.18 : 0.4, grupo: tocador.grupoDe(id) });
    const tem = biblioteca.audios.has(id);
    const ouvir = el('button', { class: 'bt mini', type: 'button', title: 'Ouvir no volume da mesa', disabled: !tem,
      onclick: () => { if (!tocador.ouvirSom(id)) aviso('Este som ainda não está no editor.', 'info'); } }, '▶');
    const ev = eventosDe(id);
    return el('div', { class: 'mesa-som' + (tem ? '' : ' falta') },
      ouvir,
      el('div', { class: 'mesa-nome' }, el('code', {}, id),
        el('small', {}, [s.descricao, ev.length ? 'evento: ' + ev.join(', ') : '', tem ? '' : 'arquivo não encontrado'].filter(Boolean).join(' · '))),
      deslizante('', s.volume, 1, (v) => { s.volume = v; }));
  };
  const grupo = (g: GrupoSom, dica: string) => {
    const ids = lista.filter((id) => (m.sons[id]?.grupo ?? tocador.grupoDe(id)) === g);
    return el('section', { class: 'mesa-grupo' },
      el('h4', {}, NOME_GRUPO[g]), el('p', { class: 'nota' }, dica),
      ...ids.map(linhaSom));
  };

  const corpo = el('div', { class: 'modal-corpo mesa' },
    el('h3', {}, 'Mesa de som'),
    el('p', { class: 'nota' }, 'O volume final de cada som = volume do som × volume do grupo. No jogo, o jogador muda os grupos pelo menu (Música, Efeitos, Vozes). Tudo fica guardado no pacote: exporte as cenas e mande para o Claude.'),
    el('section', { class: 'mesa-grupo geral' },
      el('h4', {}, 'Geral'),
      deslizante('Músicas', m.grupos.musica, 1, (v) => { m.grupos.musica = v; }),
      deslizante('Efeitos', m.grupos.efeitos, 1, (v) => { m.grupos.efeitos = v; }),
      deslizante('Vozes', m.grupos.vozes, 1, (v) => { m.grupos.vozes = v; }),
      deslizante('Música quando alguém fala', m.abaixar_musica, 1, (v) => { m.abaixar_musica = v; }, 'Quanto a música fica enquanto alguém fala (100% = não abaixa)')),
    grupo('musica', 'Regra do autor: trilhas entre 15% e 20%.'),
    grupo('efeitos', 'Regra do autor: efeitos entre 35% e 50%; os agudos ou insistentes ficam perto de 35%.'),
    el('div', { class: 'modal-bts' }, el('button', { class: 'bt lima', type: 'button', onclick: () => j.fechar() }, 'Fechar')));
  const j = abrirJanela(corpo);
}
