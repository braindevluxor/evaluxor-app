"""Genera el SQL de importación del Tabulador de paquetes desde el Excel.

Lee el archivo `TABULADOR ESTRCII LUXOR` de Talento Humano (dos hojas:
OFICINA y SUCURSALES) y escribe un SQL listo para el SQL Editor de
Supabase que:

  1. REEMPLAZA los datos de `bono_tabulador_paquete` (DELETE + INSERT):
     el tabulador es una foto del Excel — no se mezcla con lo anterior.
  2. Actualiza la fila única de `bono_tabulador_config` con la fecha del
     archivo, las tasas del encabezado y las ETIQUETAS de cada columna
     por hoja (la pantalla las usa para rotular el detalle).

Uso (requiere openpyxl):

    python scripts/generar_tabulador_paquetes.py "C:\\ruta\\TABULADOR....xlsx" [salida.sql]

La salida por defecto es `C:\\Users\\NOVA\\Desktop\\sql-tabulador-paquetes.sql`.

Las columnas EXPLÍCITAS del esquema (codigo, cargo, departamento,
dependencia, plantilla, salario, paquete) salen como columnas propias; TODO
lo demás va a `componentes` (jsonb) con una clave normalizada —así una hoja
puede traer columnas que la otra no tiene, y un ajuste del Excel puede
agregar o quitar columnas sin tocar el esquema—.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

# Las hojas y la fila de encabezado de CADA una (OFICINA tiene una fila de
# info extra arriba que SUCURSALES no tiene).
HOJAS = {"OFICINA": 3, "SUCURSALES": 4}

# Lo que el esquema guarda como columna propia: la normalización del
# encabezado tiene que caer en éstas para que la tabla principal pueda
# buscar y ordenar por ellas.
COLUMNAS_PROPIAS = {
    "codigos": "codigo",
    "codigo": "codigo",
    "cargo": "cargo",
    "departamento": "departamento",
    "dpto": "departamento",
    "dependencia": "dependencia",
    "depedencia": "dependencia",  # typo real del Excel (hoja SUCURSALES)
    "dedepencia": "dependencia",  # otra variante vista en archivos viejos
    "plantilla_propuesta": "plantilla",
    "salario": "salario",
    "salario_bs": "salario",
    "paquete_aprobado": "paquete",
    "paquete_aprobado_nomin": "paquete",  # encabezado truncado (versión vieja)
    "paquete_aprobado_nomina": "paquete",  # encabezado real de la hoja OFICINA
}

# Columnas basura del archivo (sobras de fórmulas, sin encabezado).
IGNORAR = re.compile(r"^columna\d*$", re.I)


def clave(encabezado: str) -> str:
    """`DÓLARES\nBONO ASISTENCIA` → `dolares_bono_asistencia`."""
    texto = unicodedata.normalize("NFKD", str(encabezado))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r"[^a-zA-Z0-9]+", "_", texto.lower()).strip("_")
    return texto


def numero(valor):
    """El valor tal cual si es número; `None` si está vacío."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return valor
    return None


def leer_libro(ruta: Path):
    wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
    filas = []       # dicts listos para INSERT
    columnas = []    # [{hoja, key, etiqueta}] para el config
    meta = {"fecha": None, "tasa_cambio": None, "tasa_cupon": None}

    for hoja, fila_enc in HOJAS.items():
        ws = wb[hoja]
        filas_hoja = list(ws.iter_rows(min_row=1, values_only=True))

        # Encabezado del archivo: fecha, tasa de cambio y tasa de cupón
        # viven en las dos primeras filas, etiqueta al lado del valor.
        for fila in filas_hoja[:2]:
            for i, celda in enumerate(fila):
                if celda is None:
                    continue
                etiqueta = str(celda).strip().upper()
                siguiente = fila[i + 1] if i + 1 < len(fila) else None
                if etiqueta.startswith("TASA CUP") and isinstance(siguiente, (int, float)):
                    meta["tasa_cupon"] = siguiente
                elif etiqueta == "TASA DE CAMBIO" and isinstance(siguiente, (int, float)):
                    meta["tasa_cambio"] = siguiente
                elif meta["fecha"] is None and hasattr(celda, "date"):
                    meta["fecha"] = celda.date()

        encabezados = filas_hoja[fila_enc - 1]
        vistos = set()
        for fila in filas_hoja[fila_enc:]:
            codigo = fila[0]
            if codigo is None or not str(codigo).strip():
                continue  # filas de formato o vacías
            registro = {
                "hoja": hoja,
                "codigo": str(codigo).strip(),
                "cargo": "",
                "departamento": "",
                "dependencia": "",
                "plantilla": None,
                "salario": None,
                "paquete": None,
                "componentes": {},
            }
            for i, enc in enumerate(encabezados):
                if enc is None or not str(enc).strip():
                    continue
                k = clave(enc)
                if not k or IGNORAR.match(k):
                    continue
                valor = fila[i] if i < len(fila) else None
                propia = COLUMNAS_PROPIAS.get(k)
                if propia in ("codigo", "cargo", "departamento", "dependencia"):
                    if valor is not None and str(valor).strip():
                        # El código ya se leyó de la primera columna.
                        if propia != "codigo":
                            registro[propia] = str(valor).strip()
                    continue
                if propia in ("plantilla", "salario", "paquete"):
                    registro[propia] = numero(valor)
                    continue
                # Componente: sólo se anota si trae valor.
                if valor is None or (isinstance(valor, str) and not valor.strip()):
                    continue
                if k not in vistos:
                    vistos.add(k)
                registro["componentes"][k] = (
                    valor if isinstance(valor, (int, float)) else str(valor).strip()
                )
            # El encabezado se registra UNA vez por hoja y clave.
            for k in sorted(registro["componentes"]):
                if not any(c["hoja"] == hoja and c["key"] == k for c in columnas):
                    original = next(
                        str(e) for e in encabezados
                        if e is not None and clave(e) == k
                    )
                    columnas.append(
                        {"hoja": hoja, "key": k, "etiqueta": re.sub(r"\s+", " ", original)}
                    )
            filas.append(registro)

    wb.close()
    return filas, columnas, meta


def esc(texto: str) -> str:
    return str(texto).replace("'", "''")


def sql_literal(valor) -> str:
    if valor is None:
        return "null"
    if isinstance(valor, (int, float)):
        return repr(valor)
    return f"'{esc(valor)}'"


def bloque_esquema(ruta_schema: Path) -> str:
    """Extrae el bloque `bono-tabulador.sql` del schema consolidado.

    Mismo criterio que `bloqueSql` (src/lib/supabaseSql.ts): desde la marca
    `Archivo consolidado:` hasta la siguiente cabecera `###`. Así el SQL
    generado sale AUTOCONTENIDO —esquema + datos en un solo pegado— sin
    duplicar la definición de las tablas en dos lugares.
    """
    if not ruta_schema.exists():
        return ""
    capturando = cabecera = False
    partes: list[str] = []
    for linea in ruta_schema.read_text(encoding="utf-8").splitlines():
        if "Archivo consolidado: bono-tabulador.sql" in linea:
            capturando = True
            continue
        if not capturando:
            continue
        if "###########################################################################" in linea:
            if cabecera:
                break
            cabecera = True
            continue
        if cabecera:
            partes.append(linea)
    if not cabecera:
        raise SystemExit(f"schema.sql no trae el bloque bono-tabulador.sql: {ruta_schema}")
    return "\n".join(partes)


def generar(ruta: Path, salida: Path) -> None:
    filas, columnas, meta = leer_libro(ruta)
    if not filas:
        raise SystemExit("El Excel no trae filas de datos: revisá el archivo.")

    esquema = bloque_esquema(Path(__file__).resolve().parent.parent / "supabase" / "schema.sql")
    lineas = [
        "-- ==========================================================================",
        "-- PEGAR EN EL SQL EDITOR DE SUPABASE — TABULADOR DE PAQUETES",
        f"-- Generado desde: {ruta.name}",
        f"-- Filas: {len(filas)} — primero crea/actualiza el esquema (bloque",
        "-- bono-tabulador.sql de supabase/schema.sql, incluido abajo) y después",
        "-- REEMPLAZA los datos (DELETE + INSERT): el tabulador es una foto del",
        "-- Excel, no se mezcla con lo anterior.",
        "-- ==========================================================================",
        "",
        esquema,
        "",
        "delete from public.bono_tabulador_paquete;",
        "",
    ]

    cfg = {
        "columnas": columnas,
        "fecha_archivo": meta["fecha"].isoformat() if meta["fecha"] else None,
        "tasa_cambio": meta["tasa_cambio"],
        "tasa_cupon": meta["tasa_cupon"],
    }
    lineas += [
        "insert into public.bono_tabulador_config",
        "  (id, columnas, fecha_archivo, tasa_cambio, tasa_cupon, actualizado_en)",
        f"  values (true, '{esc(json.dumps(cfg['columnas'], ensure_ascii=False))}'::jsonb,"
        f" {sql_literal(cfg['fecha_archivo'])},"
        f" {sql_literal(cfg['tasa_cambio'])}, {sql_literal(cfg['tasa_cupon'])}, now())",
        "  on conflict (id) do update set",
        "    columnas = excluded.columnas,",
        "    fecha_archivo = excluded.fecha_archivo,",
        "    tasa_cambio = excluded.tasa_cambio,",
        "    tasa_cupon = excluded.tasa_cupon,",
        "    actualizado_en = now();",
        "",
    ]

    # INSERTs en tandas:195 filas caben en pocas sentencias y el SQL Editor
    # no se queja con archivos de este tamaño.
    TAM = 50
    for inicio in range(0, len(filas), TAM):
        lote = filas[inicio : inicio + TAM]
        lineas.append(
            "insert into public.bono_tabulador_paquete"
            " (hoja, codigo, cargo, departamento, dependencia, plantilla, salario, paquete, componentes)"
            " values"
        )
        for j, f in enumerate(lote):
            comp = json.dumps(f["componentes"], ensure_ascii=False)
            valores = (
                f"('{f['hoja']}', '{esc(f['codigo'])}', '{esc(f['cargo'])}',"
                f" '{esc(f['departamento'])}', '{esc(f['dependencia'])}',"
                f" {sql_literal(f['plantilla'])}, {sql_literal(f['salario'])},"
                f" {sql_literal(f['paquete'])}, '{esc(comp)}'::jsonb)"
            )
            lineas.append(valores + ("," if j < len(lote) - 1 else ";"))
        lineas.append("")

    salida.write_text("\n".join(lineas), encoding="utf-8")
    print(f"OK: {salida} — {len(filas)} filas, {len(columnas)} etiquetas de columna.")
    print(
        f"    fecha={cfg['fecha_archivo']} tasa_cambio={cfg['tasa_cambio']}"
        f" tasa_cupon={cfg['tasa_cupon']}"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    origen = Path(sys.argv[1])
    if not origen.exists():
        raise SystemExit(f"No existe: {origen}")
    destino = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else Path(r"C:\Users\NOVA\Desktop\sql-tabulador-paquetes.sql")
    )
    generar(origen, destino)
