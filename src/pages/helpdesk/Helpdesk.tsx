import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PortalCabecera } from '../../components/PortalCabecera';
import { esEquipoTi, gestionaMesaAyuda } from '../../lib/roles';
import {
  listarTicketsHelpdesk,
  listarMensajesHelpdesk,
  crearTicketHelpdesk,
  enviarMensajeHelpdesk,
  actualizarTicketHelpdesk,
  listarTecnicosHelpdesk,
  listarCandidatosHelpdesk,
  agregarTecnicoHelpdesk,
  quitarTecnicoHelpdesk,
  type TicketHelpdesk,
  type MensajeHelpdesk,
  type TecnicoHelpdesk,
  type EstadoHelpdesk,
  type PrioridadHelpdesk,
} from '../../lib/data/helpdesk';
import { sucursalesPublicas } from '../../lib/data/menuSucursal';
import {
  listarTrabajadoresEquipo,
  type TrabajadorNomina,
} from '../../lib/data/granCosecha';
import { nombreCompleto } from '../../lib/data/colaboradores';
import {
  Store,
  Plus,
  Search,
  Send,
  UserCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Building2,
  Wrench,
  Monitor,
  Wifi,
  Printer,
  KeyRound,
  ChevronRight,
  Paperclip,
  Lock,
  Sparkles,
  Inbox,
  ArrowLeft,
  TrendingUp,
  Users,
  Flame,
  BarChart3,
  X,
  Loader2,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ============================================================================
// CATÁLOGOS DE LA PANTALLA (categorías y prioridades)
// ============================================================================



const CATEGORIES = [
  'Punto de Venta (POS)',
  'Redes y Wi-Fi',
  'Impresoras y Etiquetadoras',
  'Sistema / ERP',
  'Accesos y Cuentas',
  'Hardware / PC',
];

const PRIORITIES = ['Baja', 'Media', 'Alta', 'Crítica'];
const STATUSES = ['Abierto', 'En Progreso', 'Resuelto', 'Cerrado'];

// ============================================================================
// DATOS INICIALES REALISTAS DE CASOS (TICKETS)
// ============================================================================


// ============================================================================
// UTILIDADES VISUALES DE ESTADOS, PRIORIDADES Y CATEGORÍAS
// ============================================================================

function getStatusStyle(status: string) {
  switch (status) {
    case 'Abierto':
      return 'bg-primary-50 text-primary-700 border-primary-200';
    case 'En Progreso':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'Resuelto':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Cerrado':
      return 'bg-slate-100 text-slate-600 border-slate-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function getStatusDot(status: string): string {
  switch (status) {
    case 'Abierto':
      return 'bg-primary-500';
    case 'En Progreso':
      return 'bg-amber-500 animate-pulse';
    case 'Resuelto':
      return 'bg-emerald-500';
    case 'Cerrado':
      return 'bg-slate-500';
    default:
      return 'bg-slate-500';
  }
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case 'Crítica':
      return 'bg-rose-50 text-rose-700 border-rose-200 font-semibold';
    case 'Alta':
      return 'bg-orange-50 text-orange-700 border-orange-200 font-semibold';
    case 'Media':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'Baja':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'Punto de Venta (POS)':
      return <Monitor className="w-3.5 h-3.5" />;
    case 'Redes y Wi-Fi':
      return <Wifi className="w-3.5 h-3.5" />;
    case 'Impresoras y Etiquetadoras':
      return <Printer className="w-3.5 h-3.5" />;
    case 'Sistema / ERP':
      return <Wrench className="w-3.5 h-3.5" />;
    case 'Accesos y Cuentas':
      return <KeyRound className="w-3.5 h-3.5" />;
    default:
      return <Building2 className="w-3.5 h-3.5" />;
  }
}

function formatTimeNow(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ============================================================================

export function HelpdeskPage() {
  // El rol SALE DE LA SESIÓN: la vista TI es del EQUIPO —Líder, Gerente de
  // TI y Técnico de TI—, la misma cerradura que `es_equipo_ti()` en RLS y
  // la que arma el menú; el resto ve la de sucursal.
  const { profile } = useAuth();
  const rol = profile?.rol ?? 'SIN_ROL';
  const role = esEquipoTi(rol) ? 'it' : 'branch';
  /** Sólo Líder o Gerente de TI arman el equipo de técnicos. */
  const puedeAdministrarTecnicos = gestionaMesaAyuda(rol);
  /**
   * El Gerente de Sucursal sólo mira lo SUYO: sus estadísticas no deben
   * mezclar las de las demás tiendas, así que su dashboard se acota a su
   * sucursal — y el gráfico «por sucursal» (que sólo tendría una curva)
   * no se muestra.
   */
  const esGerenteSucursal = rol === 'GERENTE_S';

  // Vista activa: 'dashboard' | 'tickets' | 'detail'
  const [activeView, setActiveView] = useState<'dashboard' | 'tickets' | 'detail'>('dashboard');
  const [previousView, setPreviousView] = useState<'dashboard' | 'tickets'>('tickets');

  // Los casos: se cargan de la base al abrir la pantalla (vacía mientras).
  const [tickets, setTickets] = useState<TicketHelpdesk[]>([]);
  const [cargandoCasos, setCargandoCasos] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Sucursales reales (la RPC pública de la carta) y equipo TI de la nómina.
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoHelpdesk[]>([]);
  /** La LISTA DE ASIGNACIÓN: los usuarios con rol TECNICO_TI (ver data layer). */
  const [candidatos, setCandidatos] = useState<TecnicoHelpdesk[]>([]);
  // Búsqueda en la nómina para agregar técnicos al equipo.
  const [busquedaTec, setBusquedaTec] = useState('');
  const [resultadosTec, setResultadosTec] = useState<TrabajadorNomina[]>([]);

  // Filtros de la vista de casos
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [priorityFilter, setPriorityFilter] = useState('Todas');
  const [branchFilter, setBranchFilter] = useState('Todas');
  const [techFilter, setTechFilter] = useState('Todos');

  // Sucursal conectada cuando está en modo Sucursal
  const [activeBranchFilter, setActiveBranchFilter] = useState('Todas las Sucursales');

  // Modal de creación de nuevo caso
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newReporter, setNewReporter] = useState('');
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [newPriority, setNewPriority] = useState('Media');
  const [newAssignTo, setNewAssignTo] = useState('');

  // Estado del chat en el detalle del caso
  const [chatInput, setChatInput] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [simulatedAttachment, setSimulatedAttachment] = useState('');

  // Notificación toast discreta
  const [toast, setToast] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // La carga inicial, con cada cosa POR SEPARADO: si una petición falla,
  // las otras siguen (un caso roto no puede dejar el selector de sucursales
  // vacío ni la pantalla en blanco), y el aviso dice CUÁL falló.
  useEffect(() => {
    let vivo = true;
    const aviso = (que: string, e: unknown) => {
      if (!vivo) return;
      // El error de Supabase NO es una instancia de Error: es un objeto
      // { message, code, hint }. Sin esto el aviso diría "[object Object]".
      const detalle =
        e instanceof Error
          ? e.message
          : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
            ? (e as { message: string }).message
            : JSON.stringify(e);
      showToast(`${que} — ${detalle}`);
    };

    // 1) Sucursales: la RPC pública, que es la que usa la carta y no
    //    depende de ninguna tabla nueva. Va primero porque es lo que llena
    //    el selector del «Nuevo Caso».
    void (async () => {
      try {
        const suc = await sucursalesPublicas();
        if (!vivo) return;
        setSucursales(suc);
        // El modal nace con la SUCURSAL DEL QUE REPORTA (la del perfil) y
        // con su nombre: así no se cuelga un caso en la sucursal equivocada.
        const mia = suc.find((s) => s.id === profile?.sucursal_id);
        setNewBranch((actual) => actual || mia?.nombre || suc[0]?.nombre || '');
        setNewReporter((actual) => actual || profile?.nombre || '');
      } catch (e) {
        aviso('No se pudieron cargar las sucursales', e);
      }
    })();

    // 2) Los casos: de acá depende sólo el spinner de la lista.
    void (async () => {
      try {
        const casos = await listarTicketsHelpdesk();
        if (vivo) setTickets(casos);
      } catch (e) {
        aviso('No se pudieron cargar los casos', e);
      } finally {
        if (vivo) setCargandoCasos(false);
      }
    })();

    // 3) El equipo de GUARDIA: de acá depende la tarjeta del Dashboard.
    void (async () => {
      try {
        const tec = await listarTecnicosHelpdesk();
        if (vivo) setTecnicos(tec);
      } catch (e) {
        aviso('No se pudo cargar el equipo TI', e);
      }
    })();

    // 4) La LISTA DE ASIGNACIÓN: los usuarios con rol TECNICO_TI. De acá salen
    //    los selectores de «Técnico asignado» y los filtros por técnico.
    void (async () => {
      try {
        const cand = await listarCandidatosHelpdesk();
        if (vivo) setCandidatos(cand);
      } catch (e) {
        aviso('No se pudo cargar la lista de técnicos', e);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [profile?.nombre, profile?.sucursal_id]);

  /**
   * Quiénes pueden APARECER como dueño de un caso: la LISTA DE ASIGNACIÓN
   * (usuarios con rol TECNICO_TI) MÁS el equipo de guardia -los casos viejos
   * pueden tener asignado a alguien de ese equipo-, sin repetir por id.
   *
   * Sirve para los filtros, la carga por técnico y para buscar quién está
   * asignado. Para ASIGNAR se usa sólo la lista de asignación.
   */
  const atendedores = useMemo(() => {
    const porId = new Map<string, TecnicoHelpdesk>();
    for (const t of [...candidatos, ...tecnicos]) porId.set(t.id, t);
    return [...porId.values()];
  }, [candidatos, tecnicos]);

  // Sucursales como lista de nombres: lo que usan los selects y el
  // gráfico de distribución (antes era el array fijo de maqueta).
  const sucursalesNombres = useMemo(() => sucursales.map((s) => s.nombre), [sucursales]);

  /**
   * LA SUCURSAL DEL USUARIO: la de su perfil.
   *
   * Con ella, el alta de un caso queda PEGADA a la tienda de quien reporta
   * —se muestra como dato, no como selector—, así nadie cuelga un caso en
   * una sucursal que no es la suya. Sin sucursal en el perfil (el Líder de
   * oficina, p. ej.) el selector sigue disponible, porque no hay de dónde
   * tomarla.
   */
  const sucursalPropia = useMemo(
    () => sucursales.find((s) => s.id === profile?.sucursal_id)?.nombre ?? '',
    [sucursales, profile?.sucursal_id]
  );
  const sucursalBloqueada = Boolean(sucursalPropia);

  // Búsqueda en la nómina para agregar técnicos: sólo con2 letras y con
  // debounce, para no martillar la RPC en cada tecla.
  useEffect(() => {
    const texto = busquedaTec.trim();
    if (texto.length < 2) {
      setResultadosTec([]);
      return;
    }
    let vivo = true;
    const t = window.setTimeout(() => {
      void listarTrabajadoresEquipo(texto)
        .then((r) => {
          if (vivo) setResultadosTec(r);
        })
        .catch(() => {
          if (vivo) setResultadosTec([]);
        });
    }, 250);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [busquedaTec]);

  // Alta y baja del equipo TI desde la nómina: sólo el Líder (lo decide el
  // RLS de `helpdesk_tecnico`) y la lista vuelve a leerse de la base.
  const agregarTecnico = async (w: TrabajadorNomina) => {
    try {
      await agregarTecnicoHelpdesk({
        dni: w.dni,
        nacionalidad: w.nacionalidad ?? 'V',
        nombre: nombreCompleto(w),
      });
      setBusquedaTec('');
      setResultadosTec([]);
      setTecnicos(await listarTecnicosHelpdesk());
      showToast(`${nombreCompleto(w)} se sumó al equipo TI`);
    } catch {
      showToast('No se pudo agregar al técnico.');
    }
  };

  const quitarTecnico = async (tech: TecnicoHelpdesk) => {
    // El equipo de guardia siempre viene de la nómina (con DNI); si no lo
    // trae no hay nada que quitar de `helpdesk_tecnico`.
    if (tech.dni == null) return;
    try {
      await quitarTecnicoHelpdesk(tech.dni);
      setTecnicos((prev) => prev.filter((t) => t.dni !== tech.dni));
      showToast(`${tech.name} salió del equipo TI`);
    } catch {
      showToast('No se pudo quitar al técnico.');
    }
  };

  // Ticket seleccionado actualmente
  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  // Auto-scroll del chat al recibir o enviar mensajes en la vista de detalle
  useEffect(() => {
    if (activeView === 'detail') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedTicket?.messages?.length, selectedTicketId, activeView]);

  // Lista filtrada de casos para la vista de Casos / Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (role === 'branch' && activeBranchFilter !== 'Todas las Sucursales') {
        if (ticket.branch !== activeBranchFilter) return false;
      }
      if (role === 'it' && branchFilter !== 'Todas' && ticket.branch !== branchFilter) {
        return false;
      }
      if (statusFilter !== 'Todos' && ticket.status !== statusFilter) {
        return false;
      }
      if (priorityFilter !== 'Todas' && ticket.priority !== priorityFilter) {
        return false;
      }
      if (role === 'it' && techFilter !== 'Todos') {
        if (techFilter === 'unassigned' && ticket.assignedTo !== null) return false;
        if (techFilter !== 'unassigned' && ticket.assignedTo !== techFilter) return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchId = ticket.id.toLowerCase().includes(q);
        const matchTitle = ticket.title.toLowerCase().includes(q);
        const matchBranch = ticket.branch.toLowerCase().includes(q);
        const matchDesc = ticket.description.toLowerCase().includes(q);
        if (!matchId && !matchTitle && !matchBranch && !matchDesc) return false;
      }
      return true;
    });
  }, [
    tickets,
    role,
    activeBranchFilter,
    branchFilter,
    statusFilter,
    priorityFilter,
    techFilter,
    searchQuery,
  ]);

  /**
   * Los casos con los que se calcula el DASHBOARD.
   *
   * Para el Gerente de Sucursal son los de SU tienda (o ninguno, si su
   * perfil no tiene sucursal cargada): el KPI, la categoría, la carga por
   * técnico y las urgencias no pueden contar lo de las demás. Para el
   * equipo de TI y los roles corporativos son TODOS.
   */
  const ticketsDelDashboard = useMemo(
    () => (esGerenteSucursal ? tickets.filter((t) => t.branch === sucursalPropia) : tickets),
    [tickets, esGerenteSucursal, sucursalPropia]
  );

  // Métricas ejecutivas del Dashboard
  const stats = useMemo(() => {
    const total = ticketsDelDashboard.length;
    const open = ticketsDelDashboard.filter((t) => t.status === 'Abierto').length;
    const inProgress = ticketsDelDashboard.filter((t) => t.status === 'En Progreso').length;
    const resolved = ticketsDelDashboard.filter(
      (t) => t.status === 'Resuelto' || t.status === 'Cerrado'
    ).length;
    const critical = ticketsDelDashboard.filter(
      (t) =>
        (t.priority === 'Crítica' || t.priority === 'Alta') &&
        t.status !== 'Resuelto' &&
        t.status !== 'Cerrado'
    ).length;

    const resolvedWithTime = ticketsDelDashboard.filter(
      (t) => typeof t.resolutionMinutes === 'number' && t.resolutionMinutes > 0
    );
    const avgMinutes =
      resolvedWithTime.length > 0
        ? Math.round(
            resolvedWithTime.reduce((acc, item) => acc + (item.resolutionMinutes ?? 0), 0) /
              resolvedWithTime.length
          )
        : 78;

    const avgResolution =
      avgMinutes >= 60
        ? `${(avgMinutes / 60).toFixed(1)}h`
        : `${avgMinutes} min`;

    return { total, open, inProgress, resolved, critical, avgResolution };
  }, [ticketsDelDashboard]);

  // Incidencias por sucursal para las DOS CURVAS del Dashboard: el total
  // histórico y los que siguen activos. Para el Gerente de Sucursal no se
  // pinta (su dashboard es de SU tienda y esto sólo tendría una curva).
  const branchDistribution = useMemo(() => {
    return sucursalesNombres.map((branch) => {
      const branchTickets = ticketsDelDashboard.filter((t) => t.branch === branch);
      const activeCount = branchTickets.filter(
        (t) => t.status === 'Abierto' || t.status === 'En Progreso'
      ).length;
      return {
        branch,
        total: branchTickets.length,
        active: activeCount,
      };
    }).sort((a, b) => b.total - a.total);
  }, [ticketsDelDashboard, sucursalesNombres]);

  // Distribución por categoría para el Dashboard
  const categoryDistribution = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      name: cat,
      count: ticketsDelDashboard.filter((t) => t.category === cat).length,
    })).sort((a, b) => b.count - a.count);
  }, [ticketsDelDashboard]);

  // Carga de trabajo por técnico para el Dashboard
  const techWorkload = useMemo(() => {
    return atendedores.map((tech) => {
      const assigned = ticketsDelDashboard.filter((t) => t.assignedTo === tech.id);
      const activeCount = assigned.filter(
        (t) => t.status === 'Abierto' || t.status === 'En Progreso'
      ).length;
      const resolvedCount = assigned.filter(
        (t) => t.status === 'Resuelto' || t.status === 'Cerrado'
      ).length;
      return {
        ...tech,
        activeCount,
        resolvedCount,
        totalAssigned: assigned.length,
      };
    });
  }, [ticketsDelDashboard, atendedores]);

  // Casos urgentes o recientes para vista rápida en el Dashboard
  const urgentRecentTickets = useMemo(() => {
    const priorityRank = { Crítica: 4, Alta: 3, Media: 2, Baja: 1 };
    return [...ticketsDelDashboard]
      .sort((a, b) => {
        const aOpen = a.status !== 'Resuelto' && a.status !== 'Cerrado' ? 1 : 0;
        const bOpen = b.status !== 'Resuelto' && b.status !== 'Cerrado' ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
        return (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0);
      })
      .slice(0, 4);
  }, [ticketsDelDashboard]);

  // ==========================================================================
  // ACCIONES DE NAVEGACIÓN Y GESTIÓN DE CASOS
  // ==========================================================================

  // Abrir la sala de atención: primero el chat (lo que más tarda), después
  // la vista — así nunca se ve un detalle sin su conversación.
  const handleOpenTicketDetail = async (ticketId: string) => {
    setPreviousView(activeView === 'detail' ? 'tickets' : activeView);
    setSelectedTicketId(ticketId);
    setIsInternalNote(false);
    setSimulatedAttachment('');
    setActiveView('detail');
    try {
      const mensajes = await listarMensajesHelpdesk(ticketId);
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, messages: mensajes } : t)));
    } catch {
      showToast('No se pudo cargar la conversación del caso.');
    }
  };


  const handleBackFromDetail = () => {
    setActiveView(previousView || 'tickets');
  };


  // Crear un nuevo ticket desde una sucursal: el caso con su primer
  // mensaje (la descripción) y, si TI ya eligió técnico, con la asignación
  // inicial — el mismo flujo de la maqueta, ahora persistido.
  const handleCreateTicket = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDescription.trim()) return;

    // La sucursal es la DEL USUARIO: con la del perfil no se lee el
    // selector, aunque el estado conserve un valor viejo.
    const rama = sucursalBloqueada ? sucursalPropia : newBranch;
    const sucursal = sucursales.find((s) => s.nombre === rama);
    const nombreSucursal = sucursal?.nombre ?? rama;
    const reporter = newReporter.trim() || `Encargado ${nombreSucursal.replace('Sucursal ', '')}`;
    const assignedTech =
      puedeAdministrarTecnicos && newAssignTo
        ? atendedores.find((t) => t.id === newAssignTo) ?? null
        : null;

    try {
      const creado = await crearTicketHelpdesk({
        titulo: newTitle.trim(),
        descripcion: newDescription.trim(),
        sucursalId: sucursal?.id ?? null,
        sucursalNombre: nombreSucursal,
        reporterName: reporter,
        categoria: newCategory,
        prioridad: newPriority as PrioridadHelpdesk,
      });
      setTickets((prev) => [creado, ...prev]);
      setSelectedTicketId(creado.id);

      if (assignedTech) {
        const sysText = `Caso asignado a ${assignedTech.name} al momento de su creación.`;
        await actualizarTicketHelpdesk(
          creado.id,
          {
            estado: 'En Progreso',
            tecnicoDni: assignedTech.usuarioId ? null : assignedTech.dni,
            tecnicoUsuario: assignedTech.usuarioId ?? null,
            tecnicoNombre: assignedTech.name
          },
          sysText
        );
        setTickets((prev) =>
          prev.map((t) =>
            t.id === creado.id
              ? {
                  ...t,
                  status: 'En Progreso',
                  assignedTo: assignedTech.id,
                  messages: [
                    ...t.messages,
                    {
                      id: `m-sys-${Date.now()}`,
                      senderType: 'system',
                      senderName: 'Sistema HelpDesk',
                      text: sysText,
                      timestamp: formatTimeNow(),
                    },
                  ],
                }
              : t
          )
        );
      }

      setNewTitle('');
      setNewDescription('');
      setNewReporter('');
      setNewAssignTo('');
      setIsCreateModalOpen(false);
      setActiveView('detail');
      showToast(`Caso ${creado.id} creado y enviado a Mesa TI`);
    } catch {
      showToast('No se pudo crear el caso. Revisá los datos e intentá de nuevo.');
    }
  };



  // Asignar o reasignar técnico a un ticket
  const handleAssignTechnician = async (ticketId: string, techId: string) => {
    // Sólo el Gerente de TI (o el Líder) reparte: el Técnico atiende, no
    // asigna — la misma regla que cumple el disparador de la base.
    if (!puedeAdministrarTecnicos) return;
    const normalizedTechId = techId === '' ? null : techId;
    const techObj = atendedores.find((t) => t.id === normalizedTechId) ?? null;
    const actual = tickets.find((t) => t.id === ticketId);
    if (!actual || actual.assignedTo === normalizedTechId) return;

    const nextStatus = normalizedTechId && actual.status === 'Abierto' ? 'En Progreso' : actual.status;
    const sysText = techObj
      ? `Ticket asignado a ${techObj.name} (${techObj.role}).${
          nextStatus !== actual.status ? ` Estado actualizado a "${nextStatus}".` : ''
        }`
      : 'Asignación de técnico removida; el ticket queda sin asignar.';
    try {
      await actualizarTicketHelpdesk(
        ticketId,
        {
          // La identidad del atendedor: el DNI (si viene de la nómina del
          // equipo de guardia) o el USUARIO con rol TECNICO_TI —nunca los
          // dos—, más el nombre que se muestra.
          tecnicoDni: techObj?.usuarioId ? null : techObj?.dni ?? null,
          tecnicoUsuario: techObj?.usuarioId ?? null,
          tecnicoNombre: techObj?.name ?? null,
          ...(nextStatus !== actual.status ? { estado: nextStatus } : {}),
        },
        sysText
      );
    } catch {
      showToast('No se pudo guardar la asignación.');
      return;
    }

    setTickets((prev) =>
      prev.map((t) =>
        t.id !== ticketId
          ? t
          : {
              ...t,
              assignedTo: normalizedTechId,
              status: nextStatus,
              updatedAt: 'recién',
              messages: [
                ...t.messages,
                {
                  id: `m-sys-${Date.now()}`,
                  senderType: 'system',
                  senderName: 'Sistema HelpDesk',
                  text: sysText,
                  timestamp: formatTimeNow(),
                },
              ],
            }
      )
    );
    if (techObj) showToast(`Asignado a ${techObj.name}`);
    else showToast('Técnico desasignado');
  };



  // Cambiar estado del ticket
  const handleStatusChange = async (ticketId: string, nextStatus: EstadoHelpdesk) => {
    const actual = tickets.find((t) => t.id === ticketId);
    if (!actual || actual.status === nextStatus) return;

    const sysText = `Estado del caso cambiado de "${actual.status}" a "${nextStatus}".`;
    const resolucion =
      (nextStatus === 'Resuelto' || nextStatus === 'Cerrado') && !actual.resolutionMinutes
        ? 45
        : actual.resolutionMinutes;
    try {
      await actualizarTicketHelpdesk(
        ticketId,
        { estado: nextStatus, resolucionMinutos: resolucion },
        sysText
      );
    } catch {
      showToast('No se pudo actualizar el estado.');
      return;
    }

    setTickets((prev) =>
      prev.map((t) =>
        t.id !== ticketId
          ? t
          : {
              ...t,
              status: nextStatus,
              resolutionMinutes: resolucion,
              updatedAt: 'recién',
              messages: [
                ...t.messages,
                {
                  id: `m-st-${Date.now()}`,
                  senderType: 'system',
                  senderName: 'Sistema HelpDesk',
                  text: sysText,
                  timestamp: formatTimeNow(),
                },
              ],
            }
      )
    );
    showToast(`Estado actualizado a "${nextStatus}"`);
  };



  // Cambiar prioridad del ticket
  const handlePriorityChange = async (ticketId: string, nextPriority: PrioridadHelpdesk) => {
    const actual = tickets.find((t) => t.id === ticketId);
    if (!actual || actual.priority === nextPriority) return;

    const sysText = `Prioridad ajustada a "${nextPriority}".`;
    try {
      await actualizarTicketHelpdesk(ticketId, { prioridad: nextPriority }, sysText);
    } catch {
      showToast('No se pudo actualizar la prioridad.');
      return;
    }

    setTickets((prev) =>
      prev.map((t) =>
        t.id !== ticketId
          ? t
          : {
              ...t,
              priority: nextPriority,
              updatedAt: 'recién',
              messages: [
                ...t.messages,
                {
                  id: `m-pr-${Date.now()}`,
                  senderType: 'system',
                  senderName: 'Sistema HelpDesk',
                  text: sysText,
                  timestamp: formatTimeNow(),
                },
              ],
            }
      )
    );
    showToast(`Prioridad: ${nextPriority}`);
  };



  // Enviar mensaje en el chat del caso: lo escribe la sucursal ('branch')
  // o TI ('it', que además mueve el caso a "En Progreso" si estaba abierto
  // —el auto-move de la maqueta—).
  const handleSendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTicket) return;
    if (!chatInput.trim() && !simulatedAttachment) return;

    const senderName =
      role === 'it'
        ? `${profile?.nombre ?? 'TI'} (TI)`
        : `${selectedTicket.reporterName} (${selectedTicket.branch})`;
    const finalText = simulatedAttachment
      ? `${chatInput.trim() ? `${chatInput.trim()}\n` : ''}[Adjunto: ${simulatedAttachment}]`
      : chatInput.trim();
    const esNotaInterna = role === 'it' && isInternalNote;
    const autoMove = role === 'it' && !isInternalNote && selectedTicket.status === 'Abierto';

    try {
      await enviarMensajeHelpdesk(selectedTicket.id, {
        senderType: role === 'it' ? 'it' : 'branch',
        senderName,
        text: finalText,
        isInternal: esNotaInterna,
        adjunto: simulatedAttachment || null,
        cambiarA: autoMove ? 'En Progreso' : undefined,
      });
    } catch {
      showToast('No se pudo enviar el mensaje.');
      return;
    }

    const nuevo: MensajeHelpdesk = {
      id: `m-${Date.now()}`,
      senderType: role === 'it' ? 'it' : 'branch',
      senderName,
      text: finalText,
      timestamp: formatTimeNow(),
      isInternal: esNotaInterna || undefined,
    };
    const extra: MensajeHelpdesk[] = autoMove
      ? [
          {
            id: `m-auto-${Date.now()}`,
            senderType: 'system',
            senderName: 'Sistema HelpDesk',
            text: 'Estado actualizado automáticamente a "En Progreso" por respuesta de TI.',
            timestamp: formatTimeNow(),
          },
        ]
      : [];

    setTickets((prev) =>
      prev.map((t) =>
        t.id !== selectedTicket.id
          ? t
          : {
              ...t,
              status: autoMove ? 'En Progreso' : t.status,
              updatedAt: 'recién',
              messages: [...t.messages, nuevo, ...extra],
            }
      )
    );

    setChatInput('');
    setSimulatedAttachment('');
    setIsInternalNote(false);
  };


  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('Todos');
    setPriorityFilter('Todas');
    setBranchFilter('Todas');
    setTechFilter('Todos');
  };

  const assignedTechOfSelected = selectedTicket
    ? atendedores.find((t) => t.id === selectedTicket.assignedTo)
    : null;

  /** Los casos abiertos que muestra el contador de la pestaña de Casos. */
  const casosAbiertos = tickets.filter(
    (t) => t.status === 'Abierto' || t.status === 'En Progreso'
  ).length;

  return (
    <div className="space-y-6 text-slate-800 font-sans antialiased">
      {/* NOTIFICACIÓN TOAST FLOTANTE */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-white text-slate-800 px-4 py-3 rounded-xl shadow-xl border border-slate-200 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Las acciones de la vista viven en la BARRA de la consola
          (PortalCabecera): cambiar entre Dashboard y Casos es un filtro de
          ESTA pantalla, no una navegación aparte —y la consola ya pone el
          título «Mesa de Ayuda» con su subtítulo. */}
      <PortalCabecera>
        <div
          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1"
          role="group"
          aria-label="Vista de la Mesa de Ayuda"
        >
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            aria-pressed={activeView === 'dashboard'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              activeView === 'dashboard'
                ? 'bg-primary text-white'
                : 'text-slate-600 hover:bg-primary-50 hover:text-primary-900'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveView('tickets')}
            aria-pressed={activeView === 'tickets' || activeView === 'detail'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              activeView === 'tickets' || activeView === 'detail'
                ? 'bg-primary text-white'
                : 'text-slate-600 hover:bg-primary-50 hover:text-primary-900'
            }`}
          >
            Casos{casosAbiertos ? ` (${casosAbiertos})` : ''}
          </button>
        </div>

        {/* El filtro por sucursal es del rol que reporta: el TI ve todo. */}
        {role === 'branch' ? (
          <select
            value={activeBranchFilter}
            onChange={(e) => setActiveBranchFilter(e.target.value)}
            aria-label="Filtrar por sucursal"
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-primary focus:outline-none cursor-pointer"
          >
            <option value="Todas las Sucursales">Todas las sucursales</option>
            {sucursalesNombres.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-700 cursor-pointer"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          <span>Reportar Caso</span>
        </button>
      </PortalCabecera>

      <div className="space-y-6">
        {/* ===================================================================== */}
        {/* VISTA 1: DASHBOARD EJECUTIVO DE MÉTRICAS Y ANALÍTICA                  */}
        {/* ===================================================================== */}
        {activeView === 'dashboard' && (
          <main className="space-y-6">
            <div className="max-w-[1500px] w-full mx-auto space-y-6">
              {/* El Gerente de Sucursal sólo cuenta lo SUYO: el aviso deja
                  claro de dónde salen los números de esta fila. */}
              {esGerenteSucursal ? (
                <p className="text-xs font-semibold text-slate-500">
                  Tus estadísticas: sólo los casos de{' '}
                  <span className="font-bold text-slate-700">
                    {sucursalPropia || 'tu sucursal'}
                  </span>
                  .
                </p>
              ) : null}

              {/* FILA DE TARJETAS KPI */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Total Casos</span>
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900">{stats.total}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Histórico registrado</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Abiertos</span>
                    <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
                      <Inbox className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-primary-700">{stats.open}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Pendientes por tomar</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">En Progreso</span>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-amber-600">{stats.inProgress}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Siendo atendidos</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Críticos / Altos</span>
                    <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                      <Flame className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-rose-600">{stats.critical}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Atención urgente</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Resueltos</span>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-emerald-600">{stats.resolved}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Solucionados con éxito</p>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500">Tiempo Promedio</span>
                    <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900">{stats.avgResolution}</p>
                  <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                    SLA Objetivo: &lt; 2h
                  </p>
                </div>
              </section>

              {/* EL EQUIPO TI Y LA GUARDIA: lo que vivía en la barra lateral
                  propia de esta pantalla. Con la barra de la consola, el
                  equipo se administra acá, en el Dashboard del rol TI. */}
              {role === 'it' ? (
                <section className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Equipo TI ({tecnicos.length})
                      </h3>
                      <p className="text-xs text-slate-500">
                        Quien atiende los casos: se suma desde la nómina y se quita con la X.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-500">Guardia TI</span>
                      <div className="flex -space-x-1.5 overflow-hidden">
                        {tecnicos.map((tech) => (
                          <div
                            key={tech.id}
                            title={`${tech.name} - ${tech.role}`}
                            className={`w-7 h-7 rounded-full ${tech.color} ring-2 ring-white flex items-center justify-center text-[10px] font-bold text-white`}
                          >
                            {tech.avatar}
                          </div>
                        ))}
                        {!tecnicos.length ? (
                          <span className="text-[11px] text-slate-500">Sin técnicos</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className={puedeAdministrarTecnicos ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4'}>
                    <ul className="space-y-1.5">
                      {tecnicos.map((tech) => (
                        <li
                          key={tech.id}
                          className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2"
                        >
                          <span
                            className={`w-7 h-7 shrink-0 rounded-full ${tech.color} flex items-center justify-center text-[10px] font-bold text-white`}
                          >
                            {tech.avatar}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-slate-800 truncate">
                              {tech.name}
                            </span>
                            <span className="block text-[11px] text-slate-500 truncate">
                              {tech.role}
                            </span>
                          </span>
                          {/* Sólo Líder o Gerente de TI sacan gente del
                              equipo: el Técnico lo mira, no lo edita. */}
                          {puedeAdministrarTecnicos ? (
                            <button
                              type="button"
                              onClick={() => void quitarTecnico(tech)}
                              title={`Quitar a ${tech.name} del equipo`}
                              aria-label={`Quitar a ${tech.name} del equipo`}
                              className="shrink-0 p-1 text-slate-500 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                      {!tecnicos.length ? (
                        <li className="text-xs text-slate-500 px-1">
                          Sin técnicos cargados todavía.
                        </li>
                      ) : null}
                    </ul>

                    {puedeAdministrarTecnicos ? (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="buscar-tecnico"
                          className="block text-[11px] font-bold uppercase tracking-wider text-slate-500"
                        >
                          Agregar desde la nómina
                        </label>
                        <input
                          id="buscar-tecnico"
                          type="text"
                          value={busquedaTec}
                          onChange={(e) => setBusquedaTec(e.target.value)}
                          placeholder="Buscar por nombre…"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        {busquedaTec.trim().length >= 2 ? (
                          <ul className="space-y-1">
                            {resultadosTec
                              .filter((r) => !tecnicos.some((t) => t.dni === r.dni))
                              .slice(0, 5)
                              .map((r) => (
                                <li key={`${r.nacionalidad ?? 'V'}-${r.dni}`}>
                                  <button
                                    type="button"
                                    onClick={() => void agregarTecnico(r)}
                                    className="w-full flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 px-2.5 py-2 text-left hover:bg-primary-50 cursor-pointer"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-xs font-semibold text-slate-800 truncate">
                                        {nombreCompleto(r)}
                                      </span>
                                      <span className="block text-[11px] text-slate-500">
                                        {r.nacionalidad ?? 'V'}-{r.dni}
                                        {r.sucursal ? ` · ${r.sucursal}` : ''}
                                      </span>
                                    </span>
                                    <Plus className="w-4 h-4 shrink-0 text-primary" />
                                  </button>
                                </li>
                              ))}
                            {!resultadosTec.length ? (
                              <li className="text-[11px] text-slate-500 px-1">
                                Sin coincidencias en la nómina.
                              </li>
                            ) : null}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* ANALÍTICA INTERMEDIA: INCIDENCIAS POR SUCURSAL (SÓLO SI NO
                  ES EL GERENTE DE UNA) Y POR CATEGORÍA */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* El gráfico COMPARA sucursales: para el Gerente de la suya
                    no dice nada —sólo tendría su curva—, así que no se pinta
                    y la categoría ocupa el ancho completo. */}
                {esGerenteSucursal ? null : (
                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-slate-900">
                        Incidencias por Sucursal
                      </h3>
                      <span className="text-xs font-medium text-slate-500">
                        Activos vs Total histórico
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-5">
                      Distribución operativa de reportes generados por cada sede comercial
                    </p>

                    {/* DOS CURVAS por sucursal: el total histórico en azul
                        primario y los activos en ámbar (trazo punteado, para
                        distinguirla sin depender sólo del color). El orden del
                        eje es el de más casos a menos, igual que antes. */}
                    <div className="space-y-2">
                      <ResponsiveContainer width="100%" height={264}>
                        <LineChart
                          data={branchDistribution}
                          margin={{ top: 8, right: 12, left: -18, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="branch"
                            angle={-32}
                            textAnchor="end"
                            height={74}
                            interval={0}
                            tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            width={34}
                          />
                          <Tooltip
                            cursor={{ stroke: '#facc15', strokeWidth: 2 }}
                            contentStyle={{
                              borderRadius: 12,
                              border: '1px solid #e2e8f0',
                              fontSize: 12,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                          <Line
                            type="monotone"
                            dataKey="total"
                            name="Total histórico"
                            stroke="#0b2545"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#facc15', stroke: '#0b2545', strokeWidth: 2 }}
                            activeDot={{ r: 6 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="active"
                            name="Activos"
                            stroke="#f59e0b"
                            strokeWidth={3}
                            strokeDasharray="6 4"
                            dot={{ r: 4, fill: '#ffffff', stroke: '#f59e0b', strokeWidth: 2 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                      <p className="text-[11px] text-slate-500">
                        Cada punto es una sucursal, de más casos a menos.
                      </p>
                    </div>
                  </div>
                </div>
                )}

                <div className={`${esGerenteSucursal ? 'lg:col-span-12' : 'lg:col-span-5'} bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm flex flex-col justify-between`}>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 mb-1">
                      Tickets por Categoría TI
                    </h3>
                    <p className="text-xs text-slate-500 mb-5">
                      Áreas técnicas con mayor demanda de soporte
                    </p>

                    <div className="space-y-3.5">
                      {categoryDistribution.map((cat) => {
                        const pct =
                          stats.total > 0 ? Math.round((cat.count / stats.total) * 100) : 0;
                        return (
                          <div
                            key={cat.name}
                            className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-lg bg-white border border-slate-200/80 flex items-center justify-center text-slate-700 shrink-0 shadow-sm">
                                {getCategoryIcon(cat.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate">
                                  {cat.name}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {pct}% del volumen total
                                </p>
                              </div>
                            </div>
                            <span className="text-sm font-extrabold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">
                              {cat.count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              {/* FILA INFERIOR: CARGA DE TRABAJO POR TÉCNICO + CASOS URGENTES */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Carga por Especialista TI
                      </h3>
                      <p className="text-xs text-slate-500">
                        Tickets activos asignados actualmente
                      </p>
                    </div>
                    <Users className="w-5 h-5 text-primary-700" />
                  </div>

                  <div className="space-y-3">
                    {techWorkload.map((tech) => (
                      <div
                        key={tech.id}
                        className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-10 h-10 rounded-xl ${tech.color} text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-sm`}
                          >
                            {tech.avatar}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                              {tech.name}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">{tech.role}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="block text-xs font-extrabold text-primary-700">
                              {tech.activeCount} activos
                            </span>
                            <span className="block text-[10px] text-emerald-600 font-semibold">
                              {tech.resolvedCount} resueltos
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Casos Prioritarios en Curso
                        </h3>
                        <p className="text-xs text-slate-500">
                          Haz clic sobre cualquier caso para abrir su sala de atención y chat
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveView('tickets')}
                        className="text-xs font-bold text-primary-700 hover:text-primary-700 flex items-center gap-1 cursor-pointer"
                      >
                        <span>Ver todos</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {urgentRecentTickets.map((ticket) => {
                        const assignedTech = atendedores.find((t) => t.id === ticket.assignedTo);
                        return (
                          <div
                            key={ticket.id}
                            onClick={() => handleOpenTicketDetail(ticket.id)}
                            className="p-3.5 rounded-xl border border-slate-200/90 hover:border-primary-300 hover:bg-primary-50/30 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                                  {ticket.id}
                                </span>
                                <span
                                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${getPriorityStyle(
                                    ticket.priority
                                  )}`}
                                >
                                  {ticket.priority}
                                </span>
                                <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                                  <Store className="w-3 h-3 text-slate-500" />
                                  {ticket.branch}
                                </span>
                              </div>
                              <p className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-primary-700 truncate">
                                {ticket.title}
                              </p>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                              <span
                                className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${getStatusStyle(
                                  ticket.status
                                )}`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${getStatusDot(
                                    ticket.status
                                  )}`}
                                />
                                {ticket.status}
                              </span>

                              <span className="text-xs text-slate-500 font-medium">
                                {assignedTech ? assignedTech.name.split(' ')[0] : 'Sin asignar'}
                              </span>

                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-primary-700 group-hover:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </main>
        )}

        {/* ===================================================================== */}
        {/* VISTA 2: CASOS / TICKETS (LISTADO DEDICADO A ANCHO COMPLETO)          */}
        {/* ===================================================================== */}
        {activeView === 'tickets' && (
          <main className="space-y-6">
            <div className="max-w-[1500px] w-full mx-auto space-y-5">
              {/* BARRA SUPERIOR DE BÚSQUEDA Y FILTROS */}
              <section className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por código (HD-1042), asunto, sucursal o detalle..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Todos">Estado: Todos</option>
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>

                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Todas">Prioridad: Todas</option>
                    {PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>
                        {pr}
                      </option>
                    ))}
                  </select>

                  {role === 'it' && (
                    <>
                      <select
                        value={branchFilter}
                        onChange={(e) => setBranchFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="Todas">Sucursal: Todas</option>
                        {sucursalesNombres.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>

                      <select
                        value={techFilter}
                        onChange={(e) => setTechFilter(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="Todos">Técnico: Todos</option>
                        <option value="unassigned">Sin asignar</option>
                        {atendedores.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {(searchQuery ||
                    statusFilter !== 'Todos' ||
                    priorityFilter !== 'Todas' ||
                    branchFilter !== 'Todas' ||
                    techFilter !== 'Todos') && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </section>

              {/* TABLA DE CASOS A ANCHO COMPLETO */}
              <section className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
                  <span className="text-xs font-bold text-slate-700">
                    Mostrando {filteredTickets.length}{' '}
                    {filteredTickets.length === 1 ? 'caso' : 'casos'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Haz clic en una fila para abrir el chat y atender el caso
                  </span>
                </div>

                {cargandoCasos ? (
                  <div className="p-14 text-center">
                    <Loader2 className="w-8 h-8 text-slate-300 mx-auto mb-3 animate-spin" />
                    <p className="text-sm font-bold text-slate-700">Cargando los casos…</p>
                  </div>
                ) : filteredTickets.length === 0 ? (
                  <div className="p-14 text-center">
                    <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-700">
                      No se encontraron casos con los filtros actuales
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Intenta limpiar los filtros o crea un nuevo caso desde una sucursal.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="py-3.5 px-4">ID</th>
                          <th className="py-3.5 px-4">Asunto del Caso</th>
                          <th className="py-3.5 px-4">Sucursal</th>
                          <th className="py-3.5 px-4">Categoría</th>
                          <th className="py-3.5 px-4">Prioridad</th>
                          <th className="py-3.5 px-4">Estado</th>
                          <th className="py-3.5 px-4">Técnico Asignado</th>
                          <th className="py-3.5 px-4 text-center">Chat</th>
                          <th className="py-3.5 px-4 text-right">Atender</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                        {filteredTickets.map((ticket) => {
                          const assignedTech = atendedores.find(
                            (t) => t.id === ticket.assignedTo
                          );
                          return (
                            <tr
                              key={ticket.id}
                              onClick={() => handleOpenTicketDetail(ticket.id)}
                              className="hover:bg-primary-50/40 transition-colors cursor-pointer group"
                            >
                              <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-700 whitespace-nowrap">
                                {ticket.id}
                              </td>

                              <td className="py-3.5 px-4 max-w-md">
                                <p className="font-bold text-slate-900 group-hover:text-primary-700 line-clamp-1">
                                  {ticket.title}
                                </p>
                                <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                  {ticket.description}
                                </p>
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                  <Store className="w-3.5 h-3.5 text-slate-500" />
                                  {ticket.branch}
                                </span>
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                                  {getCategoryIcon(ticket.category)}
                                  {ticket.category}
                                </span>
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className={`text-xs px-2.5 py-1 rounded-full border ${getPriorityStyle(
                                    ticket.priority
                                  )}`}
                                >
                                  {ticket.priority}
                                </span>
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${getStatusStyle(
                                    ticket.status
                                  )}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${getStatusDot(
                                      ticket.status
                                    )}`}
                                  />
                                  {ticket.status}
                                </span>
                              </td>

                              <td
                                className="py-3.5 px-4 whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {puedeAdministrarTecnicos ? (
                                  <select
                                    value={ticket.assignedTo || ''}
                                    onChange={(e) =>
                                      handleAssignTechnician(ticket.id, e.target.value)
                                    }
                                    className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                                      assignedTech
                                        ? 'bg-primary-50/70 border-primary-200 text-primary-900'
                                        : 'bg-amber-50/80 border-amber-200 text-amber-800'
                                    }`}
                                  >
                                    <option value="">Sin asignar</option>
                                    {candidatos.map((tech) => (
                                      <option key={tech.id} value={tech.id}>
                                        {tech.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-xs font-medium text-slate-700">
                                    {assignedTech ? assignedTech.name : 'Por asignar'}
                                  </span>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                                  <MessageSquare className="w-3.5 h-3.5 text-primary-700" />
                                  {ticket.messages.length}
                                </span>
                              </td>

                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenTicketDetail(ticket.id);
                                  }}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-primary-700 hover:text-white hover:bg-primary border border-primary-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                                >
                                  <span>Abrir</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </main>
        )}

        {/* ===================================================================== */}
        {/* VISTA 3: DETALLE Y ATENCIÓN DEL CASO (PANTALLA COMPLETA DEDICADA)     */}
        {/* ===================================================================== */}
        {activeView === 'detail' && selectedTicket && (
          <main className="lg:h-[calc(100vh-7rem)]">
            <div className="max-w-[1500px] w-full h-full mx-auto flex flex-col gap-4">
              {/* BARRA DE NAVEGACIÓN SUPERIOR DEL CASO FIJA */}
              <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={handleBackFromDetail}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs sm:text-sm font-bold shadow-sm transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 text-primary-700" />
                  <span>Volver a Casos</span>
                </button>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-extrabold bg-slate-100 text-slate-700 px-3 py-1 rounded-lg">
                    {selectedTicket.id}
                  </span>
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full border ${getPriorityStyle(
                      selectedTicket.priority
                    )}`}
                  >
                    Prioridad {selectedTicket.priority}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${getStatusStyle(
                      selectedTicket.status
                    )}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${getStatusDot(
                        selectedTicket.status
                      )}`}
                    />
                    {selectedTicket.status}
                  </span>
                </div>
              </div>

              {/* LAYOUT DE 2 ÁREAS AJUSTADO AL ALTO DISPONIBLE */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">
                {/* COLUMNA PRINCIPAL: ENCABEZADO DEL PROBLEMA + HILO DE CHAT CON SCROLL INTERNO */}
                <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col h-[580px] lg:h-full min-h-0">
                  {/* Resumen del caso fijo */}
                  <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 shrink-0">
                    <h3 className="text-base sm:text-lg font-extrabold text-slate-900 leading-snug">
                      {selectedTicket.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-700 mt-2 leading-relaxed bg-white p-3 rounded-xl border border-slate-200/80">
                      {selectedTicket.description}
                    </p>
                  </div>

                  {/* Hilo de mensajes desplazable */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40 min-h-0">
                    {selectedTicket.messages.map((msg) => {
                      if (msg.senderType === 'system') {
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div className="inline-flex items-center gap-2 bg-slate-200/75 text-slate-700 text-[11px] font-medium px-3.5 py-1.5 rounded-full">
                              <Sparkles className="w-3.5 h-3.5 text-primary-700 shrink-0" />
                              <span>{msg.text}</span>
                              <span className="text-slate-500">· {msg.timestamp}</span>
                            </div>
                          </div>
                        );
                      }

                      if (msg.isInternal && role === 'branch') {
                        return null;
                      }

                      const isIT = msg.senderType === 'it';

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${
                            isIT ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <span className="text-[11px] font-bold text-slate-600">
                              {msg.senderName}
                            </span>
                            {msg.isInternal && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                                <Lock className="w-2.5 h-2.5" />
                                Nota Interna TI
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500">
                              {msg.timestamp}
                            </span>
                          </div>

                          <div
                            className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-line shadow-sm ${
                              msg.isInternal
                                ? 'bg-amber-50 border border-amber-300 text-amber-950 rounded-tr-sm'
                                : isIT
                                ? 'bg-primary text-white rounded-tr-sm'
                                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Caja de envío de mensajes fija al fondo */}
                  <form
                    onSubmit={handleSendMessage}
                    className="p-3.5 sm:p-4 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            setSimulatedAttachment((prev) =>
                              prev ? '' : 'captura_error_pos.png'
                            )
                          }
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                            simulatedAttachment
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>
                            {simulatedAttachment
                              ? `Adjunto: ${simulatedAttachment}`
                              : 'Adjuntar evidencia'}
                          </span>
                        </button>

                        {role === 'it' && (
                          <button
                            type="button"
                            onClick={() => setIsInternalNote((prev) => !prev)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                              isInternalNote
                                ? 'bg-amber-100 border-amber-300 text-amber-900'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>
                              {isInternalNote
                                ? 'Nota Interna (Solo TI)'
                                : 'Marcar como Nota Interna'}
                            </span>
                          </button>
                        )}
                      </div>

                      <span className="text-[11px] text-slate-500">
                        Enviando como{' '}
                        <strong className="text-slate-600">
                          {role === 'it'
                            ? (profile?.nombre ?? 'TI')
                            : selectedTicket.branch}
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder={
                          isInternalNote
                            ? 'Escribe una nota técnica privada para el equipo de TI...'
                            : role === 'it'
                            ? 'Escribe la respuesta o diagnóstico para la sucursal...'
                            : 'Escribe un mensaje para el técnico asignado...'
                        }
                        className={`flex-1 px-4 py-2.5 rounded-xl border text-xs sm:text-sm focus:outline-none focus:ring-2 transition-all ${
                          isInternalNote
                            ? 'bg-amber-50/60 border-amber-300 focus:ring-amber-400/30'
                            : 'bg-slate-50 border-slate-200 focus:bg-white focus:ring-primary/20 focus:border-primary'
                        }`}
                      />
                      <button
                        type="submit"
                        disabled={!chatInput.trim() && !simulatedAttachment}
                        className={`inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white transition-all shadow-sm ${
                          !chatInput.trim() && !simulatedAttachment
                            ? 'bg-slate-300 cursor-not-allowed'
                            : isInternalNote
                            ? 'bg-amber-600 hover:bg-amber-700 cursor-pointer'
                            : 'bg-primary hover:bg-primary-700 cursor-pointer'
                        }`}
                      >
                        <Send className="w-4 h-4" />
                        <span className="hidden sm:inline">Enviar</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* PANEL LATERAL DERECHO: GESTIÓN Y DATOS DEL TICKET */}
                <aside className="lg:col-span-4 space-y-4 lg:overflow-y-auto lg:pr-1">
                  {/* Tarjeta de Asignación y Estado */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-4">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <UserCheck className="w-4 h-4 text-primary-700" />
                      Gestión del Caso
                    </h4>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Técnico Asignado
                      </label>
                      {/* Repartir es del Gerente (o el Líder): el Técnico
                          ve a quién está asignado pero no lo cambia. */}
                      {puedeAdministrarTecnicos ? (
                        <select
                          value={selectedTicket.assignedTo || ''}
                          onChange={(e) =>
                            handleAssignTechnician(selectedTicket.id, e.target.value)
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:border-primary cursor-pointer"
                        >
                          <option value="">-- Sin asignar --</option>
                          {candidatos.map((tech) => (
                            <option key={tech.id} value={tech.id}>
                              {tech.name} · {tech.role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-semibold text-slate-800">
                          {assignedTechOfSelected
                            ? `${assignedTechOfSelected.name} (${assignedTechOfSelected.role})`
                            : 'Pendiente por asignar por Mesa TI'}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3.5">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Estado del Ticket
                        </label>
                        {role === 'it' ? (
                          <select
                            value={selectedTicket.status}
                            onChange={(e) =>
                              handleStatusChange(selectedTicket.id, e.target.value as EstadoHelpdesk)
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:border-primary cursor-pointer"
                          >
                            {STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-bold text-slate-800">
                            {selectedTicket.status}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Prioridad
                        </label>
                        {role === 'it' ? (
                          <select
                            value={selectedTicket.priority}
                            onChange={(e) =>
                              handlePriorityChange(selectedTicket.id, e.target.value as PrioridadHelpdesk)
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:border-primary cursor-pointer"
                          >
                            {PRIORITIES.map((pr) => (
                              <option key={pr} value={pr}>
                                {pr}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-bold text-slate-800">
                            {selectedTicket.priority}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tarjeta de Metadata de la Sucursal */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm space-y-3">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-emerald-600" />
                      Información de Origen
                    </h4>

                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Sucursal</span>
                        <span className="font-bold text-slate-900">
                          {selectedTicket.branch}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Reportado por</span>
                        <span className="font-semibold text-slate-800">
                          {selectedTicket.reporterName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Categoría</span>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                          {getCategoryIcon(selectedTicket.category)}
                          {selectedTicket.category}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span className="text-slate-500">Creado</span>
                        <span className="text-slate-700 font-medium">
                          {selectedTicket.createdAt}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-1.5">
                        <span className="text-slate-500">Última actividad</span>
                        <span className="text-slate-700 font-medium">
                          {selectedTicket.updatedAt}
                        </span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </main>
        )}
      </div>

      {/* ===================================================================== */}
      {/* MODAL: CREAR NUEVO CASO DESDE SUCURSAL                               */}
      {/* ===================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-white border-b border-slate-200 text-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary flex items-center justify-center">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-primary-900">
                    Montar Nuevo Caso a Soporte TI
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Completa los detalles del incidente de la sucursal
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-500 hover:text-slate-700 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Sucursal{sucursalBloqueada ? '' : ' *'}
                  </label>
                  {/* La sucursal es la DEL PERFIL: se muestra como dato y no
                      hay selector que la cambie —el caso queda colgado en la
                      tienda de quien reporta. */}
                  {sucursalBloqueada ? (
                    <div className="w-full bg-primary-50 border border-primary-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold text-primary-900 flex items-center gap-2">
                      <Store className="w-4 h-4 shrink-0 text-primary" />
                      <span className="truncate">{sucursalPropia}</span>
                      <span className="ml-auto shrink-0 text-[10px] font-black uppercase tracking-wide text-primary-700">
                        Tu sucursal
                      </span>
                    </div>
                  ) : (
                    <select
                      value={newBranch}
                      onChange={(e) => setNewBranch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium focus:bg-white focus:outline-none focus:border-primary"
                    >
                      {sucursalesNombres.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Quién reporta
                  </label>
                  <input
                    type="text"
                    value={newReporter}
                    onChange={(e) => setNewReporter(e.target.value)}
                    placeholder="Ej. Carlos Suárez (Cajero)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm focus:bg-white focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium focus:bg-white focus:outline-none focus:border-primary"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Prioridad *
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium focus:bg-white focus:outline-none focus:border-primary"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {puedeAdministrarTecnicos && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Asignar Técnico Inicial (Opcional)
                  </label>
                  <select
                    value={newAssignTo}
                    onChange={(e) => setNewAssignTo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium focus:bg-white focus:outline-none focus:border-primary"
                  >
                    <option value="">Dejar sin asignar (En cola)</option>
                    {candidatos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {t.role}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Título breve del problema *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ej. Punto de venta #2 sin conexión al servidor"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs sm:text-sm focus:bg-white focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Descripción detallada *
                </label>
                <textarea
                  required
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Describe qué ocurre, qué mensaje de error aparece y si afecta la operación de la sucursal..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs sm:text-sm focus:bg-white focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-700 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
                >
                  Crear Caso y Abrir Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
