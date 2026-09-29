# EvaLuxor · Puente biométrico (Anviz D100 por USB)

App de escritorio que lee los **marcajes (fichajes)** del lector biométrico
**Anviz D100** conectado por **USB** y los expone por HTTP local para que la
web de EvaLuxor (sección **Proyectos → Biométrico D100**) los sincronice hacia
**Supabase**.

```
┌──────────────┐   USB   ┌────────────────────┐   HTTP (loopback)   ┌──────────────┐
│ Anviz D100   │ ──────► │  Puente (esta app) │ ──────────────────► │  EvaLuxor    │
│ (huella/ID)  │         │  http://127.0.0.1  │                     │  (web/PWA)   │
└──────────────┘         │  :8787             │                     └──────┬───────┘
                         └────────────────────┘                            │
                                                                      Supabase
```

## ¿Por qué una app de escritorio?

La PWA corre en el navegador, que **no puede acceder al protocolo USB
propietario** del D100 (el SDK de Anviz es una DLL nativa de Windows). El
puente es la pieza local que habla con el dispositivo; la web solo consulta su
API HTTP y guarda los marcajes en la nube.

## Requisitos

- Node.js **18 o superior**.
- (Opcional) Software de PC de Anviz o el SDK de Anviz para la lectura real.

## Cómo usar

1. Instalar dependencias (no tiene dependencias externas, pero inicializa):

   ```bash
   cd biometrico-bridge
   npm install
   ```

2. Iniciar el puente:

   ```bash
   npm start
   ```

   Sale escuchando en `http://127.0.0.1:8787`. Por defecto arranca en
   **modo demo (mock)** con marcajes de ejemplo para poder probar todo el flujo
   sin el dispositivo.

3. En EvaLuxor: **Proyectos → Biométrico D100 → Sincronizar marcajes**.
   La URL del puente ya viene configurada (`http://127.0.0.1:8787`), editable
   en la misma pantalla (solo LIDER).

> La web corre en HTTPS y el puente en HTTP de loopback: los navegadores
> modernos permiten llamadas a `127.0.0.1` desde contextos seguros, así que no
> hay problema de contenido mixto. El puente solo escucha en `127.0.0.1`.

## API del puente

| Ruta              | Respuesta                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| `GET /health`     | `{ ok, nombre, version, mock }`                                           |
| `GET /dispositivo`| `{ conectado, modelo, serial, mensaje }`                                  |
| `GET /marcajes`   | `{ marcajes: [{ dni, fecha, tipo }] }` — filtros `?desde=ISO&hasta=ISO`   |

Los `tipo` soportados son `ENTRADA`, `SALIDA` y `OTRO`. Si el dispositivo (o el
CSV) no clasifica, la web clasifica automáticamente por jornada (impares =
entrada, pares = salida).

## Lectura real del D100 (dejar de usar el mock)

1. **Obtener el SDK / exportar del software de Anviz**:

   - **Opción A · SDK de Anviz (BioSDK / GSDK)**: DLL nativa de Windows.
     Completar en `lib/anviz-d100.js` las funciones `leerDispositivoReal()` y
     `leerMarcajesReal()` usando bindings de Node (por ejemplo `koffi` o
     `ffi-napi`) hacia las funciones del SDK que devuelven estado, serial y
     eventos IN/OUT.
   - **Opción B · CSV**: en el software de PC de Anviz (Anviz F2 / Anviz Time),
     exportar el reporte de marcajes con el formato `dni;fecha;tipo`
     (`dni;fecha;tipo` con hora en ISO) y reemplazar `data/marcajes.csv`
     (que ya viene con un ejemplo).

2. Desactivar el mock:

   ```bash
   # Windows (PowerShell)
   $env:MOCK='0'; node server.js
   # Linux / macOS
   MOCK=0 node server.js
   ```

## Base de datos

Antes de usar la sección en producción, ejecutar en el SQL Editor de Supabase:

- `supabase/proyectos-biometrico.sql` (crea las tablas `proyectos` y
  `marcajes`, políticas RLS y el proyecto inicial del biométrico).

## Estructura

```
biometrico-bridge/
├── server.js             # Servidor HTTP local (loopback :8787)
├── lib/
│   └── anviz-d100.js     # Driver del D100 (mock + puntos de integración SDK)
├── data/
│   └── marcajes.csv      # Marcajes de ejemplo (o exportación real del software)
└── README.md
```