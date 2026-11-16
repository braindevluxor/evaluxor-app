---
version: 1
slug: "src-pages-concursopublico-tsx"
primary_target: "src/pages/ConcursoPublico.tsx"
related_targets: ["src/lib/data/granCosecha.ts","supabase/schema.sql"]
---

# Concurso Gran Cosecha Luxor — landing pública

## Scope

Modo: **Persuade**. Ruta nueva dentro de la PVA (candidato `/concurso`), pública sin login, compartible por WhatsApp/mural. Superficie dentro del mundo EvaLuxor establecido (PRODUCT.md, sin DESIGN.md aún).

## Audience & job

Colaborador de la cadena que llega sin contexto: entender qué es el concurso, qué gana, cuándo cierra y cómo entrar. **Acción:** «Presentá tu proyecto» (llevar a la app a crear el proyecto). **Prueba:** posiciones en vivo y proyectos reales leídos de Supabase.

## Content & constraints

- Secciones pedidas: bases y reglamento, calendario del trimestre, premios, proyectos participantes (ficha + historial de avance), posiciones, ganadores anteriores, jurado, cómo participar, FAQ.
- Todo en vivo desde Supabase: exige lectura pública (RLS `anon`) sobre `gran_cosecha_proyecto`/`gran_cosecha_bitacora` y tablas nuevas para el contenido editorial, con editor en la app para LÍDER/JUEZ.
- Tono festivo y competitivo. Identidad inicial: assets EvaLuxor reales de `public/` + azul `#0B2545`; logo y colores propios del concurso llegarán después (reemplazo de assets, no de composición).
- Contenido real del trimestre (fechas, bases, premios, jurado): pendiente de entrega del usuario; mientras tanto, contenido de ejemplo marcado.

## Direction contract

### THESIS

La vitrina de premios convierte el «qué gano» en el primer viewport: el concurso se ofrece por su recompensa, y la prueba de que está vivo —posiciones en vivo, pegada debajo— evita el hero de titular genérico sobre fila de tarjetas.

### OWN-WORLD

Navy EvaLuxor `#0B2545` a campo completo (nav, panel de la vitrina), fondo claro `#F8FAFC`, ámbar de premio `#F59E0B`/`#D97706` como tinta de acción, verde `#16A34A` sólo para avance; Archivo black para display y sans regular para cuerpo; tarjetas blancas de borde fino, chips pastel del sistema. Sin segundo acento compitiendo.

### STORY

El visitante ve qué se gana (vitrina), entiende que el concurso corre ahora (T4 2026 + posiciones en vivo) y actúa: «Presentá tu proyecto».

### FIRST VIEWPORT

Nav navy con marca EvaLuxor e isotipo real; hero 1.15/0.85 — izquierda: eyebrow «Concurso trimestral de proyectos · T4 2026», H1 «Gran Cosecha Luxor» a ~96px, subcopy, CTA ámbar «Presentá tu proyecto» + secundario «Ver bases»; derecha: panel navy con vitrina de tres placas (oro al centro, elevada). Franja blanca inferior «Posiciones en vivo» con tres barras y porcentajes. Peek «Cómo funciona →» al pie del viewport.

### FORM

«La vitrina de premios» — posición 4 de la lista ordenada por resonancia (la carta repartida que salió); semilla `f55c8a84`.

### FINISH

unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions

- Path exacto de la ruta pública y cómo se coloca fuera del `RequireAuth` de `App.tsx`.
- Comp fotográfico: saldo de imagen insuficiente; el boceto aprobado `.impeccable/mocks/decision/premios.html` queda como referencia de composición hasta recargar saldo (nunca regenerarlo desde cero: el slot es `premios.png`).
- Contenido real del trimestre pendiente; hasta entonces, ejemplo marcado.
