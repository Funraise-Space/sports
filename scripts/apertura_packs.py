import random
import pandas as pd

# ------------------------------
# CONFIGURACIÓN INICIAL
# ------------------------------
datos_deportistas = [
    (2,1000,'Bronce'), 
(3,1000,'Bronce'), 
(6,1000,'Bronce'), 
(8,1000,'Bronce'), 
(10,1000,'Bronce'), 
(11,1000,'Bronce'), 
(12,1000,'Plata'), 
(13,1000,'Bronce'), 
(14,1000,'Bronce'), 
(15,1000,'Bronce'), 
(17,1000,'Plata'), 
(18,1000,'Plata'), 
(21,50,'Premium'), 
(22,1000,'Bronce'), 
(25,1000,'Bronce'), 
(26,1000,'Bronce'), 
(27,1000,'Gold'), 
(30,1000,'Plata'), 
(31,1000,'Bronce'), 
(32,1000,'Plata'), 
(33,1000,'Bronce'), 
(34,1000,'Bronce'), 
(35,1000,'Bronce'), 
(38,1000,'Bronce'), 
(40,1000,'Bronce'), 
(41,1000,'Plata'), 
(44,1000,'Bronce'), 
(47,1000,'Bronce'), 
(48,1000,'Bronce'), 
(49,1000,'Bronce'), 
(50,1000,'Plata'), 
(51,1000,'Bronce'), 
(53,1000,'Plata'), 
(54,1000,'Plata'), 
(55,1000,'Bronce'), 
(56,1000,'Bronce'), 
(57,1000,'Bronce'), 
(59,200,'Plata'), 
(61,1000,'Bronce'), 
(62,1000,'Bronce'), 
(64,1000,'Premium'), 
(65,1000,'Bronce'), 
(66,1000,'Bronce'), 
(67,100,'Gold'), 
(68,1000,'Bronce'), 
(69,1000,'Bronce'), 
(70,1000,'Bronce'), 
(71,1000,'Plata'), 
(74,1000,'Bronce'), 
(75,1000,'Plata'), 
(76,1000,'Bronce'), 
(77,1000,'Bronce'), 
(78,1000,'Bronce'), 
(79,1000,'Gold'), 
(80,1000,'Bronce'), 
(81,1000,'Plata'), 
(82,1000,'Bronce'), 
(83,1000,'Bronce'), 
(84,1000,'Bronce'), 
(85,1000,'Bronce'), 
(86,1000,'Bronce'), 
(87,1000,'Bronce'), 
(88,1000,'Bronce'), 
(89,1000,'Bronce'), 
(90,1000,'Bronce'), 
(91,1000,'Bronce'), 
(92,1000,'Bronce'), 
(93,1000,'Plata'), 
(94,1000,'Plata'), 
(95,1000,'Bronce'), 
(96,1000,'Bronce'), 
(97,1000,'Bronce'), 
(98,1000,'Bronce'), 
(99,1000,'Plata'), 
(100,1000,'Bronce'), 
(101,1000,'Bronce'), 
(102,1000,'Bronce'), 
(103,1000,'Bronce'), 
(104,1000,'Bronce'), 
(105,1000,'Bronce'), 
(106,1000,'Bronce'), 
(107,1000,'Plata')
]

def seleccionar_token(stock_dict, usados_en_pack):
    """Elige un token aleatoriamente ponderado por su stock restante."""
    candidatos = [t for t, s in stock_dict.items() if s > 0 and t not in usados_en_pack]
    if not candidatos:
        return None
    total = sum(stock_dict[t] for t in candidatos)
    r = random.uniform(0, total)
    acum = 0
    for t in candidatos:
        acum += stock_dict[t]
        if r <= acum:
            return t
    return candidatos[-1]

def generar_pack(deportistas, tipo_pack):
    """
    Genera un pack de 5 tokens sin repetir.
    - 'estandar'  → puede tener hasta 5 Bronce.
    - 'elite'     → hasta 4 Bronce.
    - 'full_fun'  → hasta 3 Bronce.
    Si no encuentra un pack válido tras 20 intentos para elite/full_fun,
    devuelve None para que el llamador lo trate como estandar.
    """
    pack_size = 5
    if sum(info['stock'] for info in deportistas.values()) < pack_size:
        return None

    limites = {'estandar': 5, 'elite': 4, 'full_fun': 3}
    max_bronce = limites[tipo_pack]

    for _ in range(20):
        temp_stock = {t: info['stock'] for t, info in deportistas.items()}
        usados = set()
        pack = []

        for _ in range(pack_size):
            token = seleccionar_token(temp_stock, usados)
            if not token:
                break
            temp_stock[token] -= 1
            pack.append((token, deportistas[token]['rareza']))
            usados.add(token)

        if len(pack) < pack_size:
            return None

        bronces = sum(1 for _, r in pack if r == 'Bronce')
        if bronces <= max_bronce:
            # Acepta el pack y descuenta del stock real
            for t, _ in pack:
                deportistas[t]['stock'] -= 1
            return pack

    # No encontró pack válido tras 20 intentos
    return None

if __name__ == "__main__":
    # 1) Inicializar el bolillero
    deportistas = {
        t_id: {'stock': stock, 'rareza': rareza}
        for t_id, stock, rareza in datos_deportistas
    }

    # 2) Definir distribución de tipos (80% estandar, 10% elite, 10% full_fun)
    distribucion = ['estandar'] * 4 + ['elite'] * 3 + ['full_fun'] * 3

    resultados = []
    pack_num = 1

    # 3) Generar packs mientras haya al menos 5 tokens en stock
    while sum(info['stock'] for info in deportistas.values()) >= 5:
        tipo = random.choice(distribucion)
        # Intentar generar según el tipo elegido
        pack = generar_pack(deportistas, tipo)
        if pack is None and tipo in ('elite', 'full_fun'):
            # Fallback a estandar si no se pudo con elite o full_fun
            tipo = 'estandar'
            pack = generar_pack(deportistas, 'estandar')
        if pack is None:
            break  # ya no hay stock suficiente ni siquiera para estandar

        ids = [str(t) for t, _ in pack]
        resultados.append({
            'pack': f'pack#{pack_num}',
            'tipo': tipo,
            'id1': ids[0], 'id2': ids[1], 'id3': ids[2],
            'id4': ids[3], 'id5': ids[4],
        })
        pack_num += 1

    # 4) Exportar resultados a Excel
    df = pd.DataFrame(resultados)
    df.to_excel("resultado_packs.xlsx", index=False)

    print(f"Simulación completada. Total de packs: {pack_num - 1}")
    print("Archivo generado: resultado_packs.xlsx")
