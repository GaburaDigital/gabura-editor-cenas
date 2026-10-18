// Ajudantes pequenos para montar a interface sem framework, e as janelas de confirmação e avisos.
type Filho = Node | string | number | null | undefined | false;
type Atributos = Record<string, unknown>;

/** Cria um elemento: h('button', { class: 'bt', onclick: f }, 'Gravar'). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Atributos = {}, ...filhos: (Filho | Filho[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : String(f));
  }
  return el;
}

/** Segundos como "3,8 s". */
export function seg(s: number): string {
  return s.toFixed(1).replace('.', ',') + ' s';
}

/** Baixa um arquivo gerado pelo app. */
export function baixar(dados: Uint8Array | string, nome: string, tipo: string): void {
  const blob = new Blob([typeof dados === 'string' ? dados : (dados as Uint8Array<ArrayBuffer>)], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Abre o seletor de arquivo e devolve os bytes. */
export function escolherArquivo(aceita: string): Promise<{ nome: string; bytes: Uint8Array } | null> {
  return new Promise((ok) => {
    const inp = el('input', { type: 'file', accept: aceita, style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return ok(null);
      ok({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    });
    inp.addEventListener('cancel', () => { inp.remove(); ok(null); });
    document.body.append(inp);
    inp.click();
  });
}

/** Esvazia um elemento. */
export function limpar(e: HTMLElement): void { e.replaceChildren(); }


function janela(conteudo: HTMLElement, aoFechar: () => void): { fechar: () => void } {
  const anterior = document.activeElement as HTMLElement | null;
  const fundo = el('div', { class: 'modal-fundo', role: 'presentation' });
  const caixa = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, conteudo);
  fundo.append(caixa);
  const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); aoFechar(); } };
  const fechar = () => { document.removeEventListener('keydown', tecla, true); fundo.remove(); anterior?.focus(); };
  document.addEventListener('keydown', tecla, true);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) { fechar(); aoFechar(); } });
  document.body.append(fundo);
  return { fechar };
}

/** Pergunta antes de fazer algo. Devolve true se confirmou. */
export function confirmar(titulo: string, texto: string, botaoSim = 'Apagar', perigo = true): Promise<boolean> {
  return new Promise((ok) => {
    const sim = el('button', { class: perigo ? 'bt perigo' : 'bt lima', type: 'button' }, botaoSim);
    const nao = el('button', { class: 'bt', type: 'button' }, 'Cancelar');
    const corpo = el('div', { class: 'modal-corpo' },
      el('h3', {}, titulo), el('p', {}, texto), el('div', { class: 'modal-bts' }, nao, sim));
    const j = janela(corpo, () => ok(false));
    sim.onclick = () => { j.fechar(); ok(true); };
    nao.onclick = () => { j.fechar(); ok(false); };
    nao.focus();
  });
}

/** Pede um texto (ex.: nome do preset). */
export function pedirTexto(titulo: string, rotulo: string, valor = ''): Promise<string | null> {
  return new Promise((ok) => {
    const campo = el('input', { id: 'campo-dialogo', class: 'campo', value: valor, type: 'text' });
    const sim = el('button', { class: 'bt lima', type: 'submit' }, 'Salvar');
    const nao = el('button', { class: 'bt', type: 'button' }, 'Cancelar');
    const form = el('form', { class: 'modal-corpo' },
      el('h3', {}, titulo), el('label', { for: 'campo-dialogo', class: 'rotulo' }, rotulo), campo, el('div', { class: 'modal-bts' }, nao, sim));
    const j = janela(form, () => ok(null));
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = campo.value.trim(); if (!v) return; j.fechar(); ok(v); });
    nao.onclick = () => { j.fechar(); ok(null); };
    campo.focus(); campo.select();
  });
}

/** Mostra um conteúdo qualquer numa janela (ex.: ajustes). */
export function abrirJanela(conteudo: HTMLElement): { fechar: () => void } {
  return janela(conteudo, () => {});
}

let caixaAvisos: HTMLElement | null = null;
/** Aviso rápido no canto da tela. */
export function aviso(texto: string, tipo: 'ok' | 'erro' | 'info' = 'info', botao?: { texto: string; acao: () => void }): void {
  if (!caixaAvisos) { caixaAvisos = el('div', { class: 'avisos', 'aria-live': 'polite' }); document.body.append(caixaAvisos); }
  const a = el('div', { class: 'aviso ' + tipo }, texto);
  if (botao) a.append(el('button', { class: 'bt mini', type: 'button', onclick: () => { botao.acao(); a.remove(); } }, botao.texto));
  caixaAvisos.append(a);
  setTimeout(() => a.remove(), tipo === 'erro' ? 7000 : botao ? 6000 : 3500);
}
