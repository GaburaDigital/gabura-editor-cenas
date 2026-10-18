// Arquivos que você arrasta para o editor: modelos (.glb), dublagem (ZIP do estúdio ou .ogg soltos),
// pacotes de cenas (.json ou .zip). Tudo fica guardado no navegador (IndexedDB) e funciona offline.

import { unzipSync, strFromU8 } from 'fflate';
import { normalizarPacote, type Pacote } from './modelo';

export interface InfoFala { id: string; personagem: string; texto: string; duracao: number; }
export interface Curva { quadros_por_segundo: number; valores: number[]; }

const NOME_BANCO = 'gabura_editor_cenas';
let bancoAberto: Promise<IDBDatabase> | null = null;
function banco(): Promise<IDBDatabase> {
  bancoAberto ??= new Promise((ok, erro) => {
    const req = indexedDB.open(NOME_BANCO, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('arquivos');
      req.result.createObjectStore('config');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
  return bancoAberto;
}
function pedir<T>(loja: string, modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return banco().then((db) => new Promise<T>((ok, erro) => {
    const tx = db.transaction(loja, modo);
    const r = f(tx.objectStore(loja));
    tx.oncomplete = () => ok(r.result as T);
    tx.onerror = () => erro(tx.error);
  }));
}

/** Biblioteca em memória (espelho do que está no IndexedDB). */
export const biblioteca = {
  modelos: new Map<string, ArrayBuffer>(),
  audios: new Map<string, ArrayBuffer>(),  // chave: id da fala ou nome do som (sem extensão)
  curvas: new Map<string, Curva>(),
  falas: new Map<string, InfoFala>(),
};

const salvarArquivo = (nome: string, dados: ArrayBuffer | string) => pedir('arquivos', 'readwrite', (s) => s.put(dados, nome));
export const salvarConfig = (chave: string, v: unknown) => pedir('config', 'readwrite', (s) => s.put(v, chave));
export const lerConfig = <T>(chave: string) => pedir<T | undefined>('config', 'readonly', (s) => s.get(chave));

const semExt = (n: string) => n.replace(/^.*\//, '').replace(/\.(ogg|wav|mp3|glb|json)$/i, '').replace(/\.curva$/i, '');
const copia = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

/** Coloca um arquivo na biblioteca (e no banco). Devolve o que entrou, para o aviso na tela. */
async function guardar(nome: string, dados: Uint8Array): Promise<string | null> {
  const base = nome.replace(/^.*\//, '');
  if (/\.glb$/i.test(base)) {
    biblioteca.modelos.set(base, copia(dados));
    await salvarArquivo('modelo:' + base, copia(dados));
    return 'modelo';
  }
  if (/\.curva\.json$/i.test(base)) {
    const c = JSON.parse(strFromU8(dados)) as Curva;
    biblioteca.curvas.set(semExt(base), c);
    await salvarArquivo('curva:' + semExt(base), JSON.stringify(c));
    return 'curva';
  }
  if (/\.(ogg|wav|mp3)$/i.test(base)) {
    biblioteca.audios.set(semExt(base), copia(dados));
    await salvarArquivo('audio:' + semExt(base), copia(dados));
    return 'audio';
  }
  if (/^falas\.json$/i.test(base)) {
    const d = JSON.parse(strFromU8(dados)) as { falas: InfoFala[] };
    for (const f of d.falas) biblioteca.falas.set(f.id, { id: f.id, personagem: f.personagem, texto: f.texto, duracao: f.duracao });
    await salvarArquivo('falas', JSON.stringify([...biblioteca.falas.values()]));
    return 'roteiro';
  }
  return null;
}

export interface ResultadoImportacao { modelos: number; audios: number; falas: number; pacote: Pacote | null; ignorados: string[]; }

/** Lê os arquivos soltos ou ZIPs que você arrastou. */
export async function importar(arquivos: File[]): Promise<ResultadoImportacao> {
  const r: ResultadoImportacao = { modelos: 0, audios: 0, falas: 0, pacote: null, ignorados: [] };
  const conta = (tipo: string | null, nome: string) => {
    if (tipo === 'modelo') r.modelos++;
    else if (tipo === 'audio') r.audios++;
    else if (tipo === 'roteiro') r.falas = biblioteca.falas.size;
    else if (tipo === null && !/\/$/.test(nome) && !/\.(vtt|txt|wav)$/i.test(nome)) r.ignorados.push(nome);
  };
  for (const arq of arquivos) {
    const bytes = new Uint8Array(await arq.arrayBuffer());
    if (/\.zip$/i.test(arq.name)) {
      const dentro = unzipSync(bytes, {
        // os WAV de fontes_de_arte não são usados pelo editor: não precisa abrir
        filter: (f) => !/fontes_de_arte\//.test(f.name),
      });
      for (const [nome, dados] of Object.entries(dentro)) {
        if (/(^|\/)cenas?[^/]*\.json$/i.test(nome) && !/curva/.test(nome)) { r.pacote = lerPacote(dados); continue; }
        conta(await guardar(nome, dados), nome);
      }
    } else if (/\.json$/i.test(arq.name) && !/curva|^falas\.json$/i.test(arq.name)) {
      r.pacote = lerPacote(bytes);
    } else {
      conta(await guardar(arq.name, bytes), arq.name);
    }
  }
  return r;
}

function lerPacote(bytes: Uint8Array): Pacote {
  return normalizarPacote(JSON.parse(strFromU8(bytes)) as Pacote);
}

/** Recarrega a biblioteca do banco ao abrir o editor. */
export async function carregarBiblioteca(): Promise<void> {
  const chaves = await pedir<IDBValidKey[]>('arquivos', 'readonly', (s) => s.getAllKeys());
  for (const k of chaves) {
    const nome = String(k);
    const v = await pedir<ArrayBuffer | string>('arquivos', 'readonly', (s) => s.get(k));
    if (nome.startsWith('modelo:')) biblioteca.modelos.set(nome.slice(7), v as ArrayBuffer);
    else if (nome.startsWith('audio:')) biblioteca.audios.set(nome.slice(6), v as ArrayBuffer);
    else if (nome.startsWith('curva:')) biblioteca.curvas.set(nome.slice(6), JSON.parse(v as string) as Curva);
    else if (nome === 'falas') for (const f of JSON.parse(v as string) as InfoFala[]) biblioteca.falas.set(f.id, f);
  }
}

/** Apaga todos os arquivos guardados (as cenas ficam). */
export async function limparBiblioteca(): Promise<void> {
  await pedir('arquivos', 'readwrite', (s) => s.clear());
  biblioteca.modelos.clear(); biblioteca.audios.clear(); biblioteca.curvas.clear(); biblioteca.falas.clear();
}

// ---------- áudio ----------
let ctxAudio: AudioContext | null = null;
const decodificados = new Map<string, AudioBuffer>();
export function contextoAudio(): AudioContext {
  ctxAudio ??= new AudioContext();
  void ctxAudio.resume();
  return ctxAudio;
}
/** Decodifica (uma vez) e devolve o áudio de uma fala ou som. */
export async function bufferAudio(id: string): Promise<AudioBuffer | null> {
  if (decodificados.has(id)) return decodificados.get(id)!;
  const b = biblioteca.audios.get(id);
  if (!b) return null;
  const buf = await contextoAudio().decodeAudioData(b.slice(0));
  decodificados.set(id, buf);
  return buf;
}

/** Áudio já decodificado (para tocar sem esperar). */
export function bufferPronto(id: string): AudioBuffer | null { return decodificados.get(id) ?? null; }

/** Duração de uma fala: do áudio decodificado, senão do falas.json. */
export function duracaoFala(id: string): number {
  return decodificados.get(id)?.duration ?? biblioteca.falas.get(id)?.duracao ?? 3;
}

/** Decodifica todas as falas usadas, para as durações ficarem exatas. */
export async function prepararFalas(ids: string[]): Promise<void> {
  for (const id of ids) { try { await bufferAudio(id); } catch { /* áudio com problema: usa a duração do falas.json */ } }
}
