#!/usr/bin/env python3
"""Fala sincronizada com a voz: acrescenta clipes a um personagem .glb SEM mexer no que já existe.

O que entra no arquivo:
- `falar`         continua igual (modelo completo, com a boca). Nada que já usa o modelo quebra.
- `falar_corpo`   o mesmo `falar`, sem os ossos da boca: gestos, cabeça, sobrancelhas.
- `falar_respiro` o `falar_corpo` com 35% da intensidade, em volta da pose média do `falar`
                  (braços e cabeça ficam no mesmo lugar; só o movimento fica menor).
                  Mesma duração e mesmo ritmo do `falar_corpo`, para a troca entre os dois ser suave.
- `extras.gabura_fala` na cena: quais ossos são a boca, fechada e aberta, e como movê-los pela voz.
    modo "envelope": a boca abre conforme o volume (Gabura, gato, Gojo, Fred).
    modo "padrao":   o desenho do `falar` continua (barras de LED do MetalgabuTRON),
                     multiplicado pelo volume: em silêncio fica tudo parado.

Uso:  python3 adicionar_fala_sincronizada.py entrada.glb saida.glb [--intensidade 0.35]
"""
import argparse
import json
import re
import struct
import sys

import numpy as np

BOCA = re.compile(r'^(boca(_\d+)?|bigode_[LR]|led)$')  # ossos que seguem a voz
NUM_COMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def ler_glb(caminho):
    b = open(caminho, 'rb').read()
    if b[:4] != b'glTF':
        sys.exit(f'{caminho} não é um .glb')
    tam_json = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + tam_json])
    resto = b[20 + tam_json:]
    tam_bin = struct.unpack('<I', resto[:4])[0]
    return j, bytearray(resto[8:8 + tam_bin])


def gravar_glb(caminho, j, binario):
    while len(binario) % 4:
        binario.append(0)
    j['buffers'][0]['byteLength'] = len(binario)
    texto = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    texto += b' ' * ((4 - len(texto) % 4) % 4)
    total = 12 + 8 + len(texto) + 8 + len(binario)
    with open(caminho, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(texto), b'JSON')); f.write(texto)
        f.write(struct.pack('<I4s', len(binario), b'BIN\x00')); f.write(binario)


def ler_acessor(j, binario, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    if a['componentType'] != 5126 or bv.get('byteStride'):
        sys.exit('acessor de animação em formato inesperado (esperado float sem stride)')
    n = NUM_COMP[a['type']]
    ini = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bytes(binario[ini:ini + a['count'] * n * 4]), dtype='<f4').reshape(a['count'], n).copy()


def novo_acessor(j, binario, dados, tipo):
    while len(binario) % 4:
        binario.append(0)
    ini = len(binario)
    bruto = np.ascontiguousarray(dados, dtype='<f4').tobytes()
    binario.extend(bruto)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': ini, 'byteLength': len(bruto)})
    j['accessors'].append({'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126, 'count': len(dados), 'type': tipo})
    return len(j['accessors']) - 1


def normalizar(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def media_quat(qs):
    q = qs.copy()
    q[(q @ q[0]) < 0] *= -1  # mesmo hemisfério antes de tirar a média
    return normalizar(q.mean(0))


def slerp(a, b, k):
    b = b.copy()
    d = b @ a
    b[d < 0] *= -1
    d = np.abs(d)
    out = np.empty_like(b)
    perto = d > 0.9995
    out[perto] = a + k * (b[perto] - a)
    th = np.arccos(np.clip(d[~perto], -1, 1))
    s = np.sin(th)
    out[~perto] = (np.sin((1 - k) * th) / s)[:, None] * a + (np.sin(k * th) / s)[:, None] * b[~perto]
    return normalizar(out)


def repouso(no, caminho):
    return np.array(no.get(caminho, {'rotation': [0, 0, 0, 1], 'translation': [0, 0, 0], 'scale': [1, 1, 1]}[caminho]), dtype=float)


def processar(entrada, saida, intensidade):
    j, binario = ler_glb(entrada)
    anims = {a['name']: a for a in j.get('animations', [])}
    if 'falar' not in anims:
        sys.exit(f'{entrada}: não tem o clipe "falar"')
    for nome in ('falar_corpo', 'falar_respiro'):
        if nome in anims:
            sys.exit(f'{entrada}: já tem "{nome}" (use o arquivo original)')
    falar, idle = anims['falar'], anims.get('idle')

    def valor_idle(no_i, caminho):
        """Pose da boca fechada: o que o idle usa (no começo); sem idle, a pose de repouso do nó."""
        if idle:
            for c in idle['channels']:
                if c['target']['node'] == no_i and c['target']['path'] == caminho:
                    return ler_acessor(j, binario, idle['samplers'][c['sampler']]['output'])[0].astype(float)
        return repouso(j['nodes'][no_i], caminho)

    corpo = {'name': 'falar_corpo', 'channels': [], 'samplers': []}
    respiro = {'name': 'falar_respiro', 'channels': [], 'samplers': []}
    boca = []
    for c in falar['channels']:
        no_i, caminho = c['target']['node'], c['target']['path']
        nome_no = j['nodes'][no_i].get('name', '')
        s = falar['samplers'][c['sampler']]
        if s.get('interpolation', 'LINEAR') == 'CUBICSPLINE':
            sys.exit('clipe com interpolação CUBICSPLINE não é suportado')
        valores = ler_acessor(j, binario, s['output']).astype(float)
        if BOCA.match(nome_no):
            fechado = valor_idle(no_i, caminho)
            if caminho == 'rotation':
                dist = 1 - np.abs(valores @ normalizar(fechado))
            else:
                dist = np.abs(valores - fechado).sum(1)
            if dist.max() < 1e-5:
                continue  # este canal não muda: não precisa seguir a voz
            boca.append({'no': nome_no, 'caminho': caminho, 'fechado': [round(float(x), 5) for x in fechado],
                         'aberto': [round(float(x), 5) for x in valores[int(dist.argmax())]]})
            continue
        # corpo: reaproveita os mesmos dados do falar
        corpo['samplers'].append(dict(s))
        corpo['channels'].append({'sampler': len(corpo['samplers']) - 1, 'target': dict(c['target'])})
        # respiro: menos intensidade em volta da pose média do falar (a pose não muda de lugar)
        if caminho == 'rotation':
            media = media_quat(normalizar(valores))
            novos = slerp(media, normalizar(valores), intensidade)
        else:
            media = valores.mean(0)
            novos = media + intensidade * (valores - media)
        saida_i = novo_acessor(j, binario, novos, {1: 'SCALAR', 3: 'VEC3', 4: 'VEC4'}[valores.shape[1]])
        respiro['samplers'].append({'input': s['input'], 'output': saida_i, 'interpolation': s.get('interpolation', 'LINEAR')})
        respiro['channels'].append({'sampler': len(respiro['samplers']) - 1, 'target': dict(c['target'])})

    if not boca:
        sys.exit(f'{entrada}: o "falar" não mexe em nenhum osso de boca (boca, boca_N, bigode_L/R, led)')
    # várias barras (boca_0, boca_1…) = desenho próprio, como o MetalgabuTRON: mantém o padrão do falar
    barras = sum(1 for x in boca if re.match(r'^boca_\d+$', x['no'])) >= 2
    for x in boca:
        x['modo'] = 'padrao' if barras else 'envelope'
    j['animations'] += [corpo, respiro]
    cena = j['scenes'][j.get('scene', 0)]
    cena.setdefault('extras', {})['gabura_fala'] = {
        'versao': 1, 'clipe_completo': 'falar', 'clipe_corpo': 'falar_corpo', 'clipe_respiro': 'falar_respiro',
        'intensidade_respiro': intensidade, 'boca': boca,
    }
    gravar_glb(saida, j, binario)
    return boca, len(corpo['channels'])


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('entrada'); ap.add_argument('saida')
    ap.add_argument('--intensidade', type=float, default=0.35, help='quanto do gesto fica no respiro (padrão 0.35)')
    a = ap.parse_args()
    boca, n = processar(a.entrada, a.saida, a.intensidade)
    print(f'{a.saida}: {n} canais de corpo; boca: ' + ', '.join(f"{x['no']}.{x['caminho']} ({x['modo']})" for x in boca))
