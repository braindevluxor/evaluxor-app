/**
 * Biblioteca de procesos de evaluación.
 * Documentación de cada KPI desde la recolección de la información hasta la
 * presentación de resultados, interpretación y proyección. Contenido alineado
 * con el comportamiento real de la app (EvaluarSucursal, scoring, dashboard).
 */

export type FaseId = 'recoleccion' | 'procesamiento' | 'resultados' | 'interpretacion' | 'proyeccion'

export const FASES: { id: FaseId; etiqueta: string; icono: string }[] = [
  { id: 'recoleccion', etiqueta: 'Recolección', icono: 'clipboard-check' },
  { id: 'procesamiento', etiqueta: 'Procesamiento', icono: 'calculator' },
  { id: 'resultados', etiqueta: 'Resultados', icono: 'presentation' },
  { id: 'interpretacion', etiqueta: 'Interpretación', icono: 'lightbulb' },
  { id: 'proyeccion', etiqueta: 'Proyección', icono: 'trending-up' }
]

export interface EtapaDoc {
  id: FaseId
  titulo: string
  resumen: string
  puntos: string[]
}

export interface BloqueDoc {
  titulo: string
  items: string[]
}

export interface FaseDoc {
  etiqueta: string
  objetivo: string
  bloques: BloqueDoc[]
}

export interface UmbralDoc {
  hasta: number | null
  etiqueta: string
  color: 'rojo' | 'ambar' | 'verde'
  significado: string
}

export interface KpiDoc {
  id: string
  nombre: string
  icono: string
  descripcion: string
  formula?: string
  unidad?: string
  umbrales?: UmbralDoc[]
  fases: Record<FaseId, FaseDoc>
}

/* ------------------------- Guía general por etapa ------------------------- */

export const ETAPAS: EtapaDoc[] = [
  {
    id: 'recoleccion',
    titulo: 'Recolección de la información',
    resumen: 'La visita a la sucursal: abrir la evaluación y registrar todo de punta a punta.',
    puntos: [
      'Autorización de especialidades de trabajo (asignación) y programación de la evaluación.',
      'Checklist por módulo: se responde cada ítem marcando las opciones; los de tipo RANGO exigen un valor numérico igual o mayor al mínimo aceptable.',
      'Evidencias: se adjuntan fotos por ítem u opción para respaldar el cumplimiento o el incumplimiento.',
      'Conciliación de inventario: se escanea el producto, se carga la cantidad física y el sistema reporta la teórica (soh) y el precio base.',
      'Colaboradores y unidades: se listan personas/unidades y se marcan las condiciones que apliquen.'
    ]
  },
  {
    id: 'procesamiento',
    titulo: 'Procesamiento',
    resumen: 'Cómo se convierte lo registrado en puntaje: pesos, proporciones y exclusiones.',
    puntos: [
      'Cada ítem puntuable aporta su peso multiplicado por su nivel de cumplimiento (0 a 1).',
      'Ítems sin responder no puntúan: se excluyen del cálculo en lugar de contar como falla.',
      'Checklist con puntos por opción usa modo proporcional: fracción de puntos obtenidos.',
      'Secciones ponderadas (CONTENEDOR con puntaje) agrupan a sus hijos y promedian su cumplimiento.',
      'Cuando un ítem tiene responsables, su peso se reparte en partes iguales entre quienes participan.'
    ]
  },
  {
    id: 'resultados',
    titulo: 'Presentación de resultados',
    resumen: 'Dónde se ven los números: dashboard, medidores, ranking y PDF.',
    puntos: [
      'Barra de KPIs con cumplimiento global, completadas, cobertura e ítems incumplidos.',
      'Medidor global y medidores por módulo con escala de color.',
      'Pódium de sucursales y gráfico de ponderación por sucursal y módulo.',
      'Reporte PDF por evaluación: puntaje por módulo, incumplimientos por responsable y evidencias.'
    ]
  },
  {
    id: 'interpretacion',
    titulo: 'Interpretación',
    resumen: 'Qué significa cada número y color para priorizar acciones.',
    puntos: [
      'Umbrales: menos de 60 % en riesgo (rojo), 60–79 % con oportunidad (ámbar), 80 % o más fortaleza (verde).',
      'Módulos fuertes y débiles de cada sucursal: la comparación entre módulos muestra dónde actuar primero.',
      'Incumplimientos por responsable: se agrupan los ítems fallados por quien los debe corregir.',
      'Siempre contrastar con evidencias (fotos y conciliación) antes de emitir un juicio.'
    ]
  },
  {
    id: 'proyeccion',
    titulo: 'Proyección',
    resumen: 'Tendencias y comparativas para planear la mejora.',
    puntos: [
      'Historial por sucursal/módulo: detectar mejora o caída entre períodos.',
      'Comparativas por evaluador, mes o sucursal para filtrar sesgos de medición.',
      'Fijar metas de cumplimiento por módulo y dar seguimiento en el siguiente ciclo.',
      'Reincidencias de un mismo ítem: priorizar el plan de acción del responsable.'
    ]
  }
]

/* ------------------------------ KPIs ------------------------------ */

export const KPIS: KpiDoc[] = [
  {
    id: 'cumplimiento-global',
    nombre: 'Cumplimiento global',
    icono: 'target',
    descripcion: 'Porcentaje de cumplimiento de todos los ítems puntuables de las evaluaciones del período y filtros seleccionados (global).',
    formula: 'Σ (peso del ítem × proporción de cumplimiento) ÷ Σ de pesos × 100',
    umbrales: [
      { hasta: 60, etiqueta: 'Menos de 60 %', color: 'rojo', significado: 'En riesgo: prioridad de intervención.' },
      { hasta: 80, etiqueta: '60 – 79 %', color: 'ambar', significado: 'Con oportunidad de mejora.' },
      { hasta: null, etiqueta: '80 % o más', color: 'verde', significado: 'Fortaleza: mantener y estandarizar.' }
    ],
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Registrar todas las áreas con la misma rigurosidad para que el global sea representativo.',
        bloques: [
          {
            titulo: 'Durante la visita',
            items: [
              'Completar cada módulo de principio a fin: un módulo a medias distorsiona el global.',
              'Marcar las opciones realmente verificadas; no "aprobar por defecto" ítems no revisados.',
              'Registrar evidencia fotográfica en los ítems críticos (orden, limpieza, vigencia, seguridad).'
            ]
          },
          {
            titulo: 'Errores comunes',
            items: [
              'Cerrar con ítems sin responder: esos ítems se excluyen y el global puede quedar inflado.',
              'No registrar las piezas incumplidas: un ítem incumplido sin foto pierde fuerza en la conciliación.'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Agregar el puntaje de todos los módulos con sus pesos reales.',
        bloques: [
          {
            titulo: 'Reglas de agregación',
            items: [
              'Ítem que cumple aporta peso × 1; no cumple aporta peso × 0.',
              'Checklist con puntos por opción aporta peso × proporción de puntos obtenidos.',
              'Secciones con puntaje ponderan como grupo a sus hijos; los hijos no se cuentan por separado.',
              'Ítems sin respuesta y muestras informativas quedan fuera del cálculo.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Mostrar el resultado agregado como medidor y KPI de cabecera.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Medidor global en el dashboard (escala 0–100 con color según umbral).',
              'Primer valor de la barra de KPIs: "Cumplimiento global".',
              'El mismo número, desglosado por módulo, aparece en el PDF de cada evaluación.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Leer el número en contexto, no aislado.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Menos de 60 %: hay fallas generalizadas; conviene abrir plan correctivo por módulo.',
              '60–79 %: base razonable con oportunidades puntuales identificables por módulo.',
              '80 % o más: desempeño sólido; vigilar que no existan ítems sin responder que lo inflen.'
            ]
          },
          {
            titulo: 'Precauciones',
            items: [
              'Comparar siempre contra la cobertura: pocas sucursales evaluadas dan un global poco confiable.',
              'Revisar si una sucursal arrastra el promedio hacia abajo (ver ranking y ponderación).'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Seguir la tendencia y fijar metas.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Comparar el global entre períodos en Historial para distinguir mejora real de más cobertura.',
              'Comparativas por mes permiten detectar meses atípicos (vacaciones, inventarios).',
              'Fijar meta de cumplimiento global para el trimestre y desglosarla por módulo.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'cumplimiento-modulo',
    nombre: 'Cumplimiento por módulo',
    icono: 'layout-grid',
    descripcion: 'Puntaje agregado de cada módulo (área evaluada): recepción, salas, caja, seguridad, recursos humanos, entre otros.',
    formula: 'Σ (peso del ítem del módulo × proporción) ÷ Σ de pesos del módulo × 100',
    umbrales: [
      { hasta: 60, etiqueta: 'Menos de 60 %', color: 'rojo', significado: 'Área crítica para esa sucursal.' },
      { hasta: 80, etiqueta: '60 – 79 %', color: 'ambar', significado: 'Área con aspectos a corregir.' },
      { hasta: null, etiqueta: '80 % o más', color: 'verde', significado: 'Área en buen estado.' }
    ],
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Aislar la evaluación de cada área para que su puntaje refleje solo ese módulo.',
        bloques: [
          {
            titulo: 'Momento de recoger',
            items: [
              'Atender los ítems del módulo en el área correspondiente; no responder de memoria.',
              'En conciliación y listados, verificar contra el sistema (soh, precios, colaboradores) y anotar discrepancias.',
              'Si el área no existe en esa sucursal, dejarla sin responder (se excluye) en lugar de "aprobar".'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Calcular por separado cada módulo con las mismas reglas de peso y proporción.',
        bloques: [
          {
            titulo: 'Especificidad',
            items: [
              'Cada módulo se puntúa con sus propios ítems y pesos; no se mezclan entre sí.',
              'Secciones ponderadas dentro del módulo agrupan hijos (p. ej. "Salas" con hijos por sala).',
              'El filtro por módulo en el dashboard recalcula solo con los ítems de ese módulo.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Exponer un medidor por módulo y el peso relativo de cada uno.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Medidores de módulo (tiles con nombre a 2 líneas y escala de color).',
              'Gráfico de ponderación por sucursal y módulo: la barra translúcida muestra el promedio de los módulos no nulos por sucursal.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Ubicar qué áreas tiran el resultado hacia abajo.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Un módulo en rojo explica por sí solo gran parte de la brecha del global.',
              'Comparar el mismo módulo entre sucursales: diferencia grande indica falta de estándar.',
              'La ponderación por sucursal y módulo muestra qué áreas concentran el cumplimiento y cuáles no.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Priorizar módulos para el siguiente ciclo.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Historial por módulo: verificar si un plan de acción bajó el puntaje de un módulo en ámbar.',
              'Fijar meta por módulo (p. ej. subir "Almacén" de 65 a 80 %) y medir en la próxima visita.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'cobertura-sucursales',
    nombre: 'Cobertura de sucursales',
    icono: 'store',
    descripcion: 'Porcentaje de sucursales que tienen evaluación completada dentro del período y filtros.',
    formula: 'Sucursales con evaluación completada ÷ sucursales activas × 100',
    unidad: '%',
    umbrales: [
      { hasta: 60, etiqueta: 'Menos de 60 %', color: 'rojo', significado: 'Cobertura insuficiente para concluir.' },
      { hasta: 80, etiqueta: '60 – 79 %', color: 'ambar', significado: 'Cobertura parcial: faltan sucursales clave.' },
      { hasta: null, etiqueta: '80 % o más', color: 'verde', significado: 'Visión confiable de la red.' }
    ],
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Garantizar que la visita llegue a todas las sucursales del alcance.',
        bloques: [
          {
            titulo: 'Plan de visitas',
            items: [
              'Verificar en la lista de sucursales el estado ACTIVA de cada una antes de programar.',
              'Programar las evaluaciones para no concentrar la medición en un puñado de sucursales.',
              'Priorizar las sucursales sin medición reciente cuando haya limitación de tiempo.'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Contar correctamente qué es "cubierta".',
        bloques: [
          {
            titulo: 'Reglas de conteo',
            items: [
              'Una sucursal cuenta como cubierta cuando su evaluación quedó completada en el período.',
              'Evaluaciones en borrador o programadas no suman cobertura.',
              'El denominador son las sucursales activas del registro.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Mostrar el avance de cobertura en la barra de KPIs.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Tercer valor de la barra de KPIs: "Cobertura de sucursales".',
              'Complementa al historial: cada evaluación completada aumenta la cobertura.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'No concluir sobre una muestra pequeña.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Cobertura por debajo de 60 %: el cumplimiento global no debe tomarse como diagnóstico.',
              'Cobertura alta con global bajo: el problema es real y generalizado en la red.',
              'Diferenciar sucursales nunca evaluadas de sucursales que faltan en el período.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Cerrar la brecha de sucursales sin medir.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Programar con antelación el calendario mensual de visitas.',
              'En Comparativas, agrupar por sucursal para ver cuáles quedaron fuera del período.',
              'Fijar meta de cobertura (p. ej. ≥ 90 %) antes de emitir informes gerenciales.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'evaluaciones-completadas',
    nombre: 'Evaluaciones completadas',
    icono: 'check-circle-2',
    descripcion: 'Cantidad de evaluaciones cerradas en el período. Es el insumo base de todos los demás indicadores.',
    formula: 'Cantidad de evaluaciones con estado completado (no borrador ni programadas)',
    unidad: 'cantidad',
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Llevar cada evaluación desde programada hasta completada.',
        bloques: [
          {
            titulo: 'Ciclo de vida',
            items: [
              'Programación: el Líder asigna evaluador y sucursal.',
              'En curso: el evaluador responde módulos y guarda borrador (en línea u offline).',
              'Completada: se responde el último ítem y la evaluación queda cerrada.',
              'Conciliación (cuando aplica): el Líder ajusta discrepancias antes de dar por válido.'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Contar solo evaluaciones válidas.',
        bloques: [
          {
            titulo: 'Reglas de conteo',
            items: [
              'Solo las evaluaciones con estado completado suman para los resultados.',
              'Las abiertas y las programadas aparecen en el historial como pendientes.',
              'Una evaluación con conciliación pendiente se muestra para revisión del Líder.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Exponer el volumen en la barra de KPIs y el historial.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Segundo valor de la barra de KPIs: "Evaluaciones completadas".',
              'El historial lista programación, seguimiento y cierre con su estado.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Detectar cuellos de botella en el flujo.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Muchas programadas y pocas completadas: revisar asignación o capacidad de los evaluadores.',
              'Evaluaciones abiertas hace tiempo: falta de cierre o pendientes de conciliación.',
              'El ritmo de completadas por semana es el mejor pronóstico del cierre mensual.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Asegurar el volumen antes del cierre de período.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Revisar semanalmente las evaluaciones abiertas y reasignar si hace falta.',
              'Usar Comparativas por evaluador para balancear la carga entre el equipo.',
              'Definir cuántas evaluaciones se necesitan por mes para sostener la cobertura.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'items-incumplidos',
    nombre: 'Ítems incumplidos',
    icono: 'alert-triangle',
    descripcion: 'Cantidad de ítems que resultaron incumplidos, y su distribución por responsable para orientar las acciones.',
    formula: 'Ítems con cumplimiento = 0 (checkbox, cumple/no cumple, checklists sin puntos, conciliación y listados)',
    unidad: 'cantidad',
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Registrar el incumplimiento con precisión y evidencia.',
        bloques: [
          {
            titulo: 'Durante la visita',
            items: [
              'Marcar como incumplido solo lo verificado; si no se pudo revisar, dejar sin responder.',
              'Adjuntar foto del hallazgo: la evidencia respalda la corrección del responsable.',
              'En conciliación, anotar también discrepancias de precio base y sincronización cuando apliquen.'
            ]
          },
          {
            titulo: 'Errores comunes',
            items: [
              'Usar opciones informativas como si fueran incumplimientos (no puntúan).',
              'Dejar sin responder ítems incumplidos: se excluyen y el indicador pierde información.'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Contar fallas y agruparlas por responsable.',
        bloques: [
          {
            titulo: 'Reglas',
            items: [
              'Un ítem incumple cuando su valor binario es 0 o su proporción de checklist no llega a 1.',
              'Los incumplimientos se suman por responsable según los checks asignados en la configuración.',
              'Un mismo ítem puede sumar a varios responsables cuando las opciones falladas tienen responsables distintos.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Visibilizar la cantidad y a quién corresponden.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Cuarto valor de la barra de KPIs: "Ítems incumplidos".',
              'En el PDF de la evaluación: tabla de incumplimientos por responsable.',
              'Los medidores muestran el peso en puntos perdidos por módulo.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Convertir la lista de fallas en acciones asignadas.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Un responsable con muchas incidencias concentra el plan de acción.',
              'Ítems que se repiten entre sucursales indican fallas de proceso, no de una sucursal.',
              'Incumplimientos sin evidencia son difíciles de sostener en la conciliación.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Medir la reducción de reincidencias.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Comparar los mismos ítems entre períodos para medir la efectividad del plan.',
              'Priorizar los ítems con mayor peso perdido (no solo la cantidad).',
              'Reincidencia en tres períodos consecutivos: escalar el caso al responsable del área.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'ranking-sucursales',
    nombre: 'Ranking y ponderación de sucursales',
    icono: 'award',
    descripcion: 'Orden de las sucursales por su cumplimiento global y el desglose por módulo (ponderación por sucursal y módulo).',
    formula: 'Posición según cumplimiento agregado; ponderación = promedio de los módulos no nulos de la sucursal',
    umbrales: [
      { hasta: 60, etiqueta: 'Menos de 60 %', color: 'rojo', significado: 'Último tramo: intervención prioritaria.' },
      { hasta: 80, etiqueta: '60 – 79 %', color: 'ambar', significado: 'Tramo intermedio del ranking.' },
      { hasta: null, etiqueta: '80 % o más', color: 'verde', significado: 'Tramo alto: referentes.' }
    ],
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Mantener el mismo estándar de medición entre sucursales para que el ranking sea justo.',
        bloques: [
          {
            titulo: 'Durante el ciclo',
            items: [
              'Aplicar los mismos módulos e ítems en todas las sucursales del comparativo.',
              'Documentar cualquier diferencia (sucursal sin área) en vez de aprobar por defecto.',
              'Revisar que todas las sucursales del ranking tengan evaluación del mismo período.'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Agregar por sucursal y desglosar por módulo.',
        bloques: [
          {
            titulo: 'Reglas',
            items: [
              'El cumplimiento de cada sucursal se agrega con sus propios pesos.',
              'El gráfico de ponderación promedia los módulos con respuesta (no nulos) por sucursal.',
              'Sucursales sin evaluación quedan fuera; la cobertura indica cuánto falta.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Exponer el pódium y el mapa por módulo.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'Pódium del dashboard con las mejores sucursales del período.',
              'Gráfico "Ponderación por sucursal y módulo": columnas por sucursal y una barra translúcida con el promedio por módulo de cada sucursal.',
              'El hover de la leyenda resalta la comparación entre sucursales.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Comparar entre sucursales, no solo de arriba hacia abajo.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              'Una sucursal baja en un módulo específico revela su área débil, aunque el ranking global la posicione arriba.',
              'Dos sucursales con global similar pueden diferir mucho por módulo: mirar la ponderación.',
              'El pódium refleja el período; no debe leerse como ránking definitivo sin cobertura completa.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Replicar lo que hacen las sucursales referentes.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Identificar la brecha de cada sucursal con la líder por módulo.',
              'Historial por sucursal: verificar si los planes correctivos suben posiciones.',
              'Fijar meta: que toda sucursal supere 80 % global en el próximo ciclo.'
            ]
          }
        ]
      }
    }
  },
  {
    id: 'conciliacion-inventario',
    nombre: 'Conciliación de inventario',
    icono: 'scan-barcode',
    descripcion: 'Proceso de recolección de inventario: escanear productos, comparar la cantidad teórica (soh) contra la física y detectar discrepancias.',
    formula: 'Por producto: menor ÷ mayor × 100 (tasa de coincidencia). Global: productos sin coincidir ÷ escaneados × 100 (0 % = todo concilia)',
    umbrales: [
      { hasta: 5, etiqueta: '0 %', color: 'verde', significado: 'Todo concilia: inventario confiable.' },
      { hasta: 100, etiqueta: 'Hasta 100 %', color: 'rojo', significado: 'Porcentaje de productos con diferencia: mientras más alto, mayor el descontrol.' }
    ],
    fases: {
      recoleccion: {
        etiqueta: 'Recolección',
        objetivo: 'Capturar las diferencias entre lo que dice el sistema y lo que hay en góndola/bodega.',
        bloques: [
          {
            titulo: 'Cómo se registra',
            items: [
              'Se escanea el código del producto con la cámara; el sistema devuelve la cantidad teórica (soh) y el precio base (finalBase).',
              'Se carga la cantidad física contada en el punto.',
              'Si el escaneo no responde (sin conexión), el ítem se devuelve sin puntuar, no se aprueba.',
              'Se puede adjuntar foto del producto como evidencia de la diferencia.'
            ]
          },
          {
            titulo: 'Errores comunes',
            items: [
              'Cargar la física igual a la teórica sin contar realmente.',
              'Ignorar productos sin sincronización reciente (lastSync viejo): el soh puede estar desactualizado.',
              'Contar unidades incompletas (no contar cajas cerradas).'
            ]
          }
        ]
      },
      procesamiento: {
        etiqueta: 'Procesamiento',
        objetivo: 'Calcular la tasa de coincidencia por producto y global.',
        bloques: [
          {
            titulo: 'Reglas',
            items: [
              'Por producto: menor ÷ mayor × 100; si no hay teórica o física, el producto no puntúa.',
              'Global: tasa de productos sin coincidir (física ≠ teórica) sobre el total escaneado válido.',
              'El ítem de conciliación cumple solo si todos los productos escaneados coinciden.'
            ]
          }
        ]
      },
      resultados: {
        etiqueta: 'Resultados',
        objetivo: 'Exponer la conciliación dentro del módulo y en el PDF.',
        bloques: [
          {
            titulo: 'Dónde se ve',
            items: [
              'La sección de conciliación del flujo de evaluación muestra producto por producto con soh, física y precio base.',
              'El PDF del detalle incluye la síntesis de diferencias de inventario.',
              'El puntaje del módulo incorpora la conciliación con su peso configurado.'
            ]
          }
        ]
      },
      interpretacion: {
        etiqueta: 'Interpretación',
        objetivo: 'Diagnosticar el control de inventario.',
        bloques: [
          {
            titulo: 'Lectura',
            items: [
              '0 % de productos sin coincidir: inventario sano.',
              'Diferencias puntuales: revisar mermas, reposiciones sin registrar o caducidad.',
              'Problema con el soh del sistema: evaluar la calidad de la última sincronización del producto.'
            ]
          }
        ]
      },
      proyeccion: {
        etiqueta: 'Proyección',
        objetivo: 'Reducir divergencias entre sistema y físico.',
        bloques: [
          {
            titulo: 'Seguimiento',
            items: [
              'Revisar los SKU que repiten diferencia en cada ciclo: plan de ajuste de inventario.',
              'Comparar la tasa global entre períodos para medir el control.',
              'Coordinar con el responsable del área cuando la diferencia exceda un umbral de tolerancia.'
            ]
          }
        ]
      }
    }
  }
]