// Estado do editor: pacote aberto, cena atual, seleção, tempo e o histórico para desfazer.
// Funciona como um "autoload" da Godot: um lugar só que todas as partes consultam.

import { salvarConfig } from './arquivos';
import type { Cena, Pacote } from './modelo';

export type Modo = 'editar' | 'simular';
export interface Selecao { faixa: string; indice: number; }

export const estado = {
  pacote: null as Pacote | null,
  cenaId: '',
  tempo: 0,
  tocando: false,
  modo: 'editar' as Modo,
  selecao: null as Selecao | null,
  atorSel: '' as string,
  zoom: 22,              // pixels por segundo na linha do tempo
  aguardando: null as null | { texto: string; faixa: string; indice: number },
  liberados: new Set<string>(), // "aguardar" já cumpridos nesta passada (faixa:indice)
};

export function cena(): Cena | null {
  return estado.pacote?.cenas.find((c) => c.id === estado.cenaId) ?? null;
}

type Ouvinte = (oQue: 'tudo' | 'tempo') => void;
const ouvintes = new Set<Ouvinte>();
export function aoMudar(f: Ouvinte): void { ouvintes.add(f); }
export function avisar(oQue: 'tudo' | 'tempo' = 'tudo'): void { ouvintes.forEach((f) => f(oQue)); }

// ---------- histórico (Ctrl+Z / Ctrl+Y) ----------
const desfazer: string[] = [];
const refazer: string[] = [];
let ultimo = '';

/** Chame ANTES de mudar a cena: guarda como ela estava. */
export function guardarParaDesfazer(): void {
  if (!estado.pacote) return;
  const agora = JSON.stringify(estado.pacote);
  if (agora === ultimo) return;
  desfazer.push(agora);
  if (desfazer.length > 100) desfazer.shift();
  refazer.length = 0;
  ultimo = agora;
}

/** Chame DEPOIS de mudar: salva no navegador e redesenha. */
let salvarDepois: number | undefined;
export function mudou(): void {
  ultimo = '';
  window.clearTimeout(salvarDepois);
  salvarDepois = window.setTimeout(() => { if (estado.pacote) void salvarConfig('pacote', estado.pacote); }, 300);
  avisar('tudo');
}

export function desfazerUltimo(): boolean {
  const antes = desfazer.pop();
  if (!antes || !estado.pacote) return false;
  refazer.push(JSON.stringify(estado.pacote));
  estado.pacote = JSON.parse(antes) as Pacote;
  estado.selecao = null;
  mudou();
  return true;
}

export function refazerUltimo(): boolean {
  const depois = refazer.pop();
  if (!depois || !estado.pacote) return false;
  desfazer.push(JSON.stringify(estado.pacote));
  estado.pacote = JSON.parse(depois) as Pacote;
  estado.selecao = null;
  mudou();
  return true;
}
