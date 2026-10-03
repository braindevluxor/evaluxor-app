import { colaboradorCumple, opcionesAplicablesColaborador, type ColaboradorItem } from '../scoring'

/**
 * Estado de la lista de colaboradores de un ítem de tipo LISTA_COLABORADORES.
 *
 * Son tres problemas concretos los que resuelve, y los tres tienen la misma
 * raíz: el listado de trabajadores se identifica por DNI y ese DNI es lo único
 * estable. El nombre cambia (se casa, le cambian el apellido), el rol cambia, y
 * el `branch_id` es de la API de trabajadores y no del catálogo propio. El DNI
 * no cambia nunca.
 */

/** Lee texto de un jsonb sin confiar en que venga como string. */
function txt(valor: unknown): string {
  return typeof valor === 'string' ? valor : valor == null ? '' : String(valor)
}

/** Lee un número de un jsonb. NaN y 0 cuentan como "no hay". */
function num(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

function listaDeTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.map((v) => txt(v)).filter((v) => v.length > 0)
}

function mapaDeListas(valor: unknown): Record<string, string[]> | undefined {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined
  const salida: Record<string, string[]> = {}
  for (const [clave, lista] of Object.entries(valor as Record<string, unknown>)) {
    const items = listaDeTexto(lista)
    if (items.length) salida[clave] = items
  }
  return Object.keys(salida).length ? salida : undefined
}

/**
 * Lee la lista de colaboradores venga de donde venga: el `valor` jsonb del
 * servidor, un `ValorListaColaboradores` del código, o una versión vieja con
 * menos campos. Descarta lo que no tiene DNI, porque sin DNI no hay forma de
 * saber si es el mismo trabajador al refrescar la lista.
 */
export function normalizarListaColaboradores(valor: unknown): ColaboradorItem[] {
  const crudo = Array.isArray(valor)
    ? valor
    : valor && typeof valor === 'object'
      ? (valor as { colaboradores?: unknown }).colaboradores
      : null
  if (!Array.isArray(crudo)) return []
  const salida: ColaboradorItem[] = []
  for (const entrada of crudo) {
    if (!entrada || typeof entrada !== 'object') continue
    const e = entrada as Record<string, unknown>
    const dni = num(e.dni)
    if (dni <= 0) continue
    const rol = txt(e.role_id)
    salida.push({
      dni,
      nationality: txt(e.nationality),
      name: txt(e.name),
      lastname: txt(e.lastname),
      role_id: rol || undefined,
      role_name: txt(e.role_name),
      branch_id: num(e.branch_id) || undefined,
      branch_name: txt(e.branch_name),
      admission_date: txt(e.admission_date) || null,
      active: e.active !== false,
      aplica: e.aplica !== false,
      selected: listaDeTexto(e.selected),
      noAplica: listaDeTexto(e.noAplica),
      responsablesPorOpcion: mapaDeListas(e.responsablesPorOpcion)
    })
  }
  return salida
}

/**
 * ¿Este trabajador tiene algo que se perdería si desaparece de la lista?
 *
 * No es lo mismo uno que nunca se tocó (recién cargado, sin marcar nada) que
 * uno que el evaluador revisó o que marcó como "no aplica" a propósito. Solo
 * el segundo merece una pregunta antes de descartarlo.
 *
 * Cuenta `noAplica` por la misma razón que `aplica: false`: excluir un check es
 * una decisión del evaluador, y si se pierde en silencio el próximo que cargue
 * la lista lo encuentra sin excluir y el puntaje se mueve sin que nadie lo haya
 * decidido.
 */
export function tieneTrabajoRegistrado(c: ColaboradorItem): boolean {
  return (
    (c.selected ?? []).length > 0 ||
    (c.noAplica ?? []).length > 0 ||
    c.aplica === false ||
    Object.keys(c.responsablesPorOpcion ?? {}).length > 0
  )
}

/**
 * Refresca el listado sin pisar lo que ya se revisó.
 *
 * EL ERROR QUE ARREGLA
 * --------------------
 * Antes el botón reemplazaba la lista entera por la que devuelve la API, y
 * todos los trabajadores volvían con las casillas vacías. Con diez personas en
 * la tienda y seis ya revisadas, un apretón sin querer obligaba a arrancar de
 * cero. Por eso la fusión es por DNI y no por posición: la posición en la lista
 * no significa nada, el DNI sí.
 *
 * LA DIVISIÓN DE MANDOS
 * ---------------------
 * De cada trabajador se toma lo de cada lado, porque los dos lados mandan en
 * cosas distintas y por eso no se puede elegir uno solo:
 *
 *   · De la API: quién está realmente en la tienda ahora. Si alguien cambió de
 *     apellido o de rol, la lista tiene que mostrarlo; la API es la fuente de
 *     verdad de eso.
 *   · De la lista ya cargada: lo que el evaluador marcó. Eso es trabajo humano
 *     y no se tira abajo porque la API volvió.
 *
 * Lo que la API no trae nunca: si el trabajador estaba excluido a propósito, qué
 * checks le marcaron y qué responsables le asignó el evaluador a cada check
 * incumplido. Eso sale de la lista ya cargada, y por eso los dos lados se
 * mezclan en lugar de elegir uno.
 */
export function combinarPorDni(
  actuales: ColaboradorItem[],
  frescos: ColaboradorItem[]
): { colaboradores: ColaboradorItem[]; perdidos: ColaboradorItem[] } {
  const porDni = new Map<number, ColaboradorItem>()
  for (const c of actuales) if (c.dni > 0) porDni.set(c.dni, c)

  const colaboradores: ColaboradorItem[] = []
  const presentes = new Set<number>()

  for (const f of frescos) {
    if (f.dni <= 0) {
      // Sin DNI no hay forma de saber si ya estaba: se pasa tal cual. Puede
      // quedar duplicado, pero es preferible a fusionar dos personas distintas
      // en una y perder las respuestas de una de ellas.
      colaboradores.push(f)
      continue
    }
    presentes.add(f.dni)
    const previo = porDni.get(f.dni)
    colaboradores.push(previo ? { ...f, ...respuestasDe(previo) } : f)
  }

  // Los que ya no están en la API (renunciaron, cambiaron de tienda). Solo se
  // devuelven los que tenían algo revisado: de los demás no hay nada que perder.
  const perdidos = actuales.filter(
    (c) => c.dni > 0 && !presentes.has(c.dni) && tieneTrabajoRegistrado(c)
  )

  return { colaboradores, perdidos }
}

/** Lo que se conserva de un trabajador al refrescar: lo que escribió el evaluador. */
function respuestasDe(previo: ColaboradorItem): Partial<ColaboradorItem> {
  return {
    aplica: previo.aplica,
    selected: [...(previo.selected ?? [])],
    noAplica: previo.noAplica?.length ? [...previo.noAplica] : undefined,
    responsablesPorOpcion: previo.responsablesPorOpcion
      ? { ...previo.responsablesPorOpcion }
      : undefined
  }
}

/**
 * Qué trabajadores ya estaban completos y con qué estado, para no volver a
 * revisar lo que ya salió bien.
 *
 * LAS REGLAS, Y POR QUÉ SON ESTAS
 * ------------------------------
 * 1. Gana la evaluación MÁS RECIENTE en la que apareció. Si en la última estaba
 *    incompleto y en la anterior completo, se lo vuelve a mostrar: si lewentó la
 *    falla hacia atrás en el tiempo, el problema sigue ahí y esconderlo sería
 *    dejarlo pasar. Por eso el recorrido es de la más nueva a la más vieja y
 *    cada DNI se toma una sola vez.
 * 2. Dentro de una misma evaluación, tiene que estar completo en TODAS las
 *    listas donde aparece. Un ítem repetible genera una lista por registro, y
 *    que cumpla en un registro y no en otro no es estar completo.
 * 3. Solo se considera a quien tenía al menos un check aplicable. Un
 *    trabajador al que el evaluador le marcó "no aplica" en todo no es que
 *    "cumplió": es que no se lo evaluó, y esconderlo lo haría desaparecer de
 *    la revisión sin que nadie lo haya decidido.
 *
 * Se devuelve el estado previo, no solo el DNI, porque ese estado es el que se
 * vuelve a cargar en la lista nueva: si solo se ocultara de la pantalla y se lo
 * dejara con las casillas vacías, el tablero lo contaría como incumplido.
 */
export function estadosCompletosAnteriores(
  evaluaciones: { fecha: string; listas: ColaboradorItem[][] }[],
  idsChecks: readonly string[]
): Map<number, ColaboradorItem> {
  const vistos = new Set<number>()
  const salida = new Map<number, ColaboradorItem>()
  // `opcionesAplicablesColaborador` y `colaboradorCumple` trabajan con objetos
  // `{ id }`, pero acá lo único que importa es el id: quién estaba completo no
  // depende de la etiqueta ni de los puntos del check.
  const opciones = idsChecks.map((id) => ({ id }))

  for (const ev of evaluaciones) {
    const porDni = new Map<number, { completo: boolean; estado: ColaboradorItem }>()

    for (const lista of ev.listas) {
      for (const c of lista) {
        if (c.dni <= 0 || !c.aplica) continue
        if (opcionesAplicablesColaborador(c, opciones).length === 0) continue
        const completo = colaboradorCumple(c, opciones)
        const previo = porDni.get(c.dni)
        porDni.set(c.dni, {
          completo: previo ? previo.completo && completo : completo,
          estado: previo ? previo.estado : c
        })
      }
    }

    for (const [dni, info] of porDni) {
      if (vistos.has(dni)) continue
      vistos.add(dni)
      if (info.completo) salida.set(dni, info.estado)
    }
  }

  return salida
}

/**
 * Carga en la lista nueva el estado que el trabajador tenía en la evaluación
 * anterior.
 *
 * Es lo que mantiene el número del tablero igual. Si al que ya salió bien se lo
 * oculta de la pantalla pero se lo deja con las casillas vacías, el ítem lo
 * cuenta como incumplido y la evaluación de la tienda se cae entera por un
 * trabajador que nadie revisó. La lista se acorta para trabajar más rápido; los
 * números no se mueven.
 */
export function aplicarHistorial(
  frescos: ColaboradorItem[],
  historial: Map<number, ColaboradorItem>
): ColaboradorItem[] {
  if (!historial.size) return frescos
  return frescos.map((f) => {
    const previo = f.dni > 0 ? historial.get(f.dni) : undefined
    return previo ? { ...f, ...respuestasDe(previo) } : f
  })
}