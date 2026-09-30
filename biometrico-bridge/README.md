# EvaLuxor · Puente biométrico (Anviz D100)

App de escritorio que pone los **marcajes (fichajes)** del lector biométrico
**Anviz D100** donde la web de EvaLuxor (sección **Proyectos → Biométrico D100**)
los puede leer y subir a **Supabase**.

```
┌──────────────┐  USB   ┌────────────────────┐  HTTP loopback  ┌──────────────┐
│  Anviz D100  │ ─────► │  Puente (esta app) │ ──────────────► │  EvaLuxor    │
│              │        │  http://127.0.0.1:8787                │  (web/PWA)   │
│  + software  │        │  lee data/*.csv     │                  └──────┬───────┘
│    de PC ────┼───────►│                    │                         Supabase
└──────────────┘        └────────────────────┘
```

---

## Lo que se comprobó en la PC con el D100 enchufado

Esto no es teoría: se consultó el administrador de dispositivos de la máquina
donde está conectado el equipo. Lo que Windows ve es:

| Lo que se buscó | Resultado |
| ---------------- | --------- |
| Puerto serie del equipo | No aparece (el `COM3` es la Intel AMT, de la placa, no del lector) |
| Placa de red del equipo (RNDIS) | No aparece: el D100 no se enchufa como adaptador de red |
| Interfaz de datos USB | `USBSTOR\CDROM&VEN_FINGER&PROD_MODULE` — un **CD-ROM virtual** |
| Interfaz USB compuesta | `USB\VID_C0F4&PID_10F5` con dos teclados (HID) |
| Software de Anviz instalado | No hay ninguno en la máquina |

**Conclusión:** el D100 conectado por USB **no es un canal de datos**. Se presenta
como un CD-ROM virtual, que es exactamente para donde se monta el instalador del
software de Anviz. Por ese USB no se pueden leer marcajes, y no es una
limitación del puente sino del modo en que el equipo se conecta.

Los marcajes salen del **software de PC de Anviz** (AnvizTime / BioAccess /
Anviz F2): ese programa sí habla con el equipo y deja bajar el reporte.

---

## Cómo obtener los marcajes

### 1. Instalar el software de Anviz

Va en el CD-ROM virtual que monta el propio D100 al conectarlo por USB
(también se descarga del sitio de Anviz). Es el que se comunica con el equipo.

### 2. Exportar el reporte

Desde el software de Anviz, exportá el reporte de marcajes como CSV/texto y
guardalo en:

```
biometrico-bridge/data/
```

El lector es tolerante: entiende separador `;` `,` tab o `|`, con o sin
encabezado, en español o inglés, y fechas en ISO, `DD/MM/AAAA HH:mm` o epoch.
Lo que no reconoce como tipo (entrada/salida) queda como `OTRO` y la web lo
clasifica por jornada (impar = entrada, par = salida).

Un archivo con `DNI;fecha;tipo` alcanza:

```csv
1712345678;30/09/2026 08:05;ENTRADA
1712345678;30/09/2026 12:30;SALIDA
```

Si el software exporta un `.xlsx`, guardalo como CSV (o exportá a CSV directo):
el puente no lee hojas de cálculo.

### 3. Levantar el puente y sincronizar

```bash
cd biometrico-bridge
npm start
```

Y en EvaLuxor: **Proyectos → Biométrico D100 → Comprobar** y después
**Sincronizar marcajes**.

---

## Comandos

```bash
npm start                  # modo real (default): lee data/ y consulta el USB
MODO=demo npm start        # datos de ejemplo, sin el equipo

# Windows PowerShell:
$env:MODO='demo'; npm start
```

## API del puente

| Ruta              | Respuesta                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| `GET /health`     | `{ ok, nombre, version, modo }`                                           |
| `GET /dispositivo`| `{ conectado, modelo, transporte, transporteEtiqueta, sirve, mensaje }`   |
| `GET /marcajes`   | `{ marcajes: [{ dni, fecha, tipo }], origen }` — filtros `?desde=&hasta=`  |
| `GET /origen`     | de qué archivo salió cada lote de marcajes                                |

`sirve` es la clave: dice si **por ese transporte** se pueden leer marcajes.
Con el D100 por USB viene `false`, y la pantalla lo muestra como «Por USB no se
leen» en vez de prometer una sincronización que no va a traer datos.

## Modo demo

`MODO=demo` genera marcajes de ejemplo de los últimos 4 días. Sirve para probar
el flujo completo (web → puente → Supabase → listado) sin el equipo. No se
confunde con el equipo real: `/dispositivo` lo dice (`transporte: "demo"`).

## Reconocer otro lector

Las firmas de detection están en `lib/usb.js` (`FIRMAS_POR_DEFECTO`) y se pueden
ampliar sin tocar código creando `data/dispositivo.json`:

```json
[
  { "id": "mi-lector", "vid": "1234", "pid": "5678", "modelo": "Lector X", "transporte": "puerto-serie" }
]
```

Transportes: `puerto-serie` y `red` permiten leer marcajes; `cdrom-virtual`,
`teclado-hid` y `usb-compuesto` no.

## Estructura

```
biometrico-bridge/
├── server.js             # Servidor HTTP local (loopback :8787)
├── lib/
│   ├── usb.js            # Detección real del lector en Windows
│   ├── archivos.js       # Lector tolerante de las exportaciones
│   ├── anviz-d100.js     # Driver: estado del equipo + marcajes
│   └── demo.js           # Marcajes de ejemplo (MODO=demo)
├── data/
│   ├── marcajes.csv      # Acá va el reporte exportado del software de Anviz
│   └── dispositivo.json  # Opcional: firmas de otros lectores
└── README.md
```

> El puente solo escucha en `127.0.0.1`: los marcajes no quedan expuestos a la red.
