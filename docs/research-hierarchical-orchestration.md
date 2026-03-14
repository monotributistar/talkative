# Research: Hierarchical Workflow Orchestration para Talkative

*Fecha: 2026-02-26*
*Tipo: Feature Research*
*Repo: talkative*
*Estado: Investigación*

---

## 1. Contexto: Qué tiene Talkative hoy

Talkative ya tiene una arquitectura de orquestación funcional:

**Lo que existe:**
- `AgentHub` → registry + router de agentes (keyword-based classifier)
- `AgentRunner` → ejecución por agente con skills, heartbeat, tool runner
- `Orchestrator` → state machine (`RunStatus`, `SubagentState`), commands/events, run store
- `mirrorAgentEvent()` → bridge entre agent events y orchestrator events
- Fleet Manager → provisioning de nodos local/SSH
- LLM Router → rules, budgets, usage tracking, métricas
- Channels → separación client/internal
- HITL → approval store para acciones sensibles
- Observability → structured logging con `request_id`, `tenant_id`, `agent_id`, `run_id`
- Prometheus metrics endpoint

**Lo que NO existe (y es lo que investigamos):**
- Un agente puede ejecutar sus propios workflows, pero **no puede orquestar otros agentes como sub-workflows**
- No hay jerarquía: el `AgentHub.routeMessage()` es flat (elige UN agente por keyword)
- No hay un "Master Orchestrator" que pueda:
  - Descomponer una tarea compleja en sub-tareas
  - Delegar sub-tareas a agentes específicos
  - Coordinar resultados entre agentes
  - Evaluar la salud del workflow completo
  - Bitacorizar la ejecución jerárquica

**El gap:** El comando `request_delegate` ya existe en los types del orchestrator, pero no está implementado. Ese es el punto de extensión natural.

---

## 2. Qué queremos lograr

Un **Master Orchestrator Agent** que funcione como una nueva capa sobre el AgentHub existente:

```
                     ┌──────────────────────────┐
                     │   MASTER ORCHESTRATOR     │
                     │   (nuevo componente)      │
                     │                           │
                     │  - Descompone tareas      │
                     │  - Delega a agentes       │
                     │  - Evalúa resultados      │
                     │  - Health monitoring       │
                     │  - Bitácora jerárquica    │
                     └─────┬──────────┬──────────┘
                           │          │
              ┌────────────┘          └────────────┐
              ▼                                    ▼
    ┌─────────────────┐                  ┌─────────────────┐
    │   AgentRunner    │                  │   AgentRunner    │
    │   (existente)    │                  │   (existente)    │
    │   CRM Agent      │                  │   Legal Agent    │
    │   + sus skills   │                  │   + sus skills   │
    └─────────────────┘                  └─────────────────┘
```

El Master Orchestrator NO reemplaza al AgentHub — se monta encima usando la infra existente.

---

## 3. Análisis de Enfoques

### Enfoque A: Nativo TypeScript (extender lo que hay)

Construir la orquestación jerárquica directamente en el stack actual de Talkative (Node/TS/Express).

**Implementación:**
- Nuevo servicio `MasterOrchestrator` que usa `AgentHub.sendMessage()` para delegar
- Implementar `request_delegate` en la state machine existente
- Nuevo tipo de `RunRecord` que trackea sub-runs (parent_run_id)
- El LLM (via router existente) decide la descomposición de tareas
- Health monitor como servicio que lee del event store y métricas Prometheus

**Pros:**
- Zero dependencias nuevas
- Se integra directo con el orchestrator, agent hub, event store, router existentes
- Misma persistencia (JSONL/Postgres), mismos contratos
- El equipo ya conoce el stack
- Mantiene el POC liviano

**Contras:**
- Hay que implementar la lógica de planning/decomposition desde cero
- El graph de ejecución hay que modelarlo manualmente
- Sin UI de visualización de workflows jerárquicos (habría que extender React Flow)

**Complejidad estimada:** Media. La infra está, falta la lógica de coordinación.

---

### Enfoque B: LangGraph como motor de orquestación AI

Usar LangGraph (Python) para la lógica de orquestación inteligente, comunicándose con el backend de Talkative via HTTP.

**Implementación:**
- Servicio Python separado con LangGraph que implementa el supervisor pattern
- Cada "agent" de LangGraph es un wrapper que llama al endpoint `POST /agents/:id/message` de Talkative
- LangGraph maneja el state graph, la descomposición, y el routing inteligente
- Talkative sigue siendo el runtime de ejecución
- El backend de Talkative expone un nuevo endpoint `/orchestrator/plan` que el servicio LangGraph consume

**Pros:**
- LangGraph tiene supervisor-de-supervisors resuelto
- State machines visualizables
- Checkpointing y memory built-in
- Ecosistema LangChain para tools y prompts
- Benchmarks muestran mejor performance en tokens que alternativas

**Contras:**
- Introduce Python como segundo lenguaje del proyecto
- Servicio separado → más complejidad operativa
- Latencia de red entre LangGraph service ↔ Talkative backend
- Duplicación parcial de lógica (LangGraph state + Talkative orchestrator state)
- El LLM Router de Talkative quedaría parcialmente bypaseado

**Complejidad estimada:** Alta. Ganas poder pero pagás con complejidad operativa.

---

### Enfoque C: Híbrido — Lógica nativa + patterns inspirados en LangGraph

Implementar los patterns de LangGraph (supervisor, state graph, conditional routing) pero en TypeScript nativo dentro de Talkative.

**Implementación:**
- Nuevo módulo `backend/src/master-orchestrator/` con:
  - `planner.ts` — LLM-driven task decomposition
  - `stateGraph.ts` — graph de ejecución con nodos, edges, condiciones
  - `supervisor.ts` — coordina agentes, evalúa resultados, decide re-routing
  - `healthMonitor.ts` — agrega métricas del event store + prometheus
  - `bitacora.ts` — logging jerárquico de runs (parent → children)
- Extiende los types existentes del orchestrator:
  - `RunRecord` gana `parent_run_id` y `child_run_ids`
  - Nuevo command: `delegate_subtask`
  - Nuevos events: `plan_created`, `subtask_delegated`, `subtask_completed`, `health_check`
- El `supervisor` usa el LLM Router existente para sus decisiones
- Los agentes existentes no cambian — el Master los invoca via `AgentHub.sendMessage()`

**Pros:**
- Un solo stack (TypeScript)
- Usa toda la infra existente sin duplicar
- Patterns probados (supervisor, state graph) sin la dependencia
- El conocimiento se queda en el repo
- Extensible: si en el futuro queremos LangGraph, los contratos ya están alineados

**Contras:**
- Más código que el Enfoque B para lograr lo mismo
- La calidad del planning depende de nuestro prompting (no hay framework que lo facilite)
- Sin la comunidad/docs de LangGraph para troubleshooting

**Complejidad estimada:** Media-Alta. Más código pero menos complejidad operativa.

---

## 4. Recomendación: Enfoque C (Híbrido Nativo)

**Razón principal:** Talkative ya tiene el 70% de la infra necesaria. Meter un servicio Python rompe la filosofía del proyecto y agrega complejidad operativa que no se justifica para un POC/producto vendible a baja escala.

Lo que necesitamos construir son ~4 componentes nuevos que se montan sobre lo existente:

### 4.1 Planner (task decomposition)

```typescript
// backend/src/master-orchestrator/planner.ts

interface TaskPlan {
  plan_id: string;
  original_request: string;
  subtasks: SubTask[];
  execution_strategy: "sequential" | "parallel" | "conditional";
  created_at: string;
}

interface SubTask {
  id: string;
  description: string;
  target_agent_id: string;        // qué agente lo ejecuta
  dependencies: string[];          // IDs de subtasks que deben completarse antes
  priority: number;
  estimated_complexity: "low" | "medium" | "high";
  status: "pending" | "delegated" | "completed" | "failed";
  result?: unknown;
}

// El planner usa el LLM Router existente para decidir la descomposición
async function createPlan(
  request: string,
  availableAgents: AgentRecord[]
): Promise<TaskPlan> {
  // 1. Envía al LLM: "Given these agents and their skills, 
  //    decompose this request into subtasks"
  // 2. Parsea la respuesta estructurada
  // 3. Valida que los agent_ids existan
  // 4. Retorna el plan
}
```

### 4.2 Supervisor (coordinación)

```typescript
// backend/src/master-orchestrator/supervisor.ts

class MasterSupervisor {
  constructor(
    private hub: AgentHub,
    private planner: Planner,
    private bitacora: Bitacora,
    private healthMonitor: HealthMonitor
  ) {}

  async executeWorkflow(request: string, tenant_id: string): Promise<MasterRunRecord> {
    const agents = this.hub.listAgents({ tenant_id });
    const plan = await this.planner.createPlan(request, agents);
    
    this.bitacora.logPlanCreated(plan);

    for (const subtask of this.resolveExecutionOrder(plan)) {
      // Delegar al agente correspondiente
      const result = await this.hub.sendMessage(
        subtask.target_agent_id,
        subtask.description,
        tenant_id
      );
      
      // Evaluar resultado
      const evaluation = await this.evaluateResult(subtask, result);
      
      if (evaluation.needsRetry) {
        // Re-routing o retry
      }
      
      this.bitacora.logSubtaskCompleted(plan.plan_id, subtask, result);
    }

    // Health check post-workflow
    const health = this.healthMonitor.checkWorkflowHealth(plan.plan_id);
    this.bitacora.logWorkflowCompleted(plan, health);
    
    return this.buildMasterRunRecord(plan);
  }
}
```

### 4.3 Health Monitor

```typescript
// backend/src/master-orchestrator/healthMonitor.ts

interface WorkflowHealth {
  plan_id: string;
  total_subtasks: number;
  completed: number;
  failed: number;
  avg_duration_ms: number;
  agent_health: Map<string, AgentHealthStatus>;
  overall_status: "healthy" | "degraded" | "critical";
}

interface AgentHealthStatus {
  agent_id: string;
  success_rate: number;          // últimas N ejecuciones
  avg_response_time_ms: number;
  last_error?: string;
  status: "healthy" | "slow" | "failing" | "unreachable";
}

// Lee del event store existente + métricas prometheus
class HealthMonitor {
  checkAgentHealth(agent_id: string): AgentHealthStatus { ... }
  checkWorkflowHealth(plan_id: string): WorkflowHealth { ... }
  getSystemOverview(tenant_id: string): SystemHealth { ... }
}
```

### 4.4 Bitácora jerárquica

```typescript
// backend/src/master-orchestrator/bitacora.ts

// Extiende el RunRecord existente
interface MasterRunRecord extends RunRecord {
  parent_run_id?: string;          // null = es el run del master
  child_run_ids: string[];         // runs delegados a agentes
  plan_id: string;
  plan_snapshot: TaskPlan;         // copia del plan al momento de ejecución
  health_snapshot?: WorkflowHealth;
}

// Persistencia: misma estrategia que el store actual (JSONL/Postgres)
// Se puede consultar: "dame la traza completa del workflow X"
// incluyendo el plan, cada subtask, cada resultado, y el health check final
```

---

## 5. Extensiones al Orchestrator existente

### Types a agregar en `orchestrator/types.ts`:

```typescript
// Nuevos commands
export type OrchestratorCommandType = 
  | "start_task" | "pause" | "resume" | "cancel" 
  | "request_delegate"
  | "delegate_subtask"       // NUEVO
  | "evaluate_result";       // NUEVO

// Nuevos events
export type OrchestratorEventType =
  | "state_changed" | "tool_started" | "tool_finished" 
  | "metric_recorded" | "error_compacted"
  | "plan_created"           // NUEVO
  | "subtask_delegated"      // NUEVO
  | "subtask_completed"      // NUEVO
  | "subtask_failed"         // NUEVO
  | "health_check"           // NUEVO
  | "workflow_evaluated";    // NUEVO

// Run record extendido
export interface RunRecord {
  // ... existente ...
  parent_run_id?: string;    // NUEVO
  child_run_ids?: string[];  // NUEVO
  plan_id?: string;          // NUEVO
}
```

### State machine extensions en `orchestrator/stateMachine.ts`:

```typescript
// Nuevo: el command "delegate_subtask" mantiene el run padre en "running"
// pero crea child runs
if (input.command === "delegate_subtask") return "running";

// Nuevo: cuando todos los child runs completan, el padre puede completar
if (input.event === "workflow_evaluated") return "completed";
```

---

## 6. APIs nuevas

```
POST /orchestrator/plan           — Crea un plan de ejecución
GET  /orchestrator/plan/:id       — Detalle del plan
POST /orchestrator/plan/:id/execute — Ejecuta el plan (el supervisor arranca)
GET  /orchestrator/health         — System health overview
GET  /orchestrator/health/:agent_id — Health de un agente específico
GET  /orchestrator/runs/:id/trace — Traza completa (padre + hijos)
```

---

## 7. Impacto en Frontend (Mission Control)

Extensiones posibles (no bloqueantes para el backend):
- **Plan Viewer**: visualizar el plan antes de ejecutar (nodes = subtasks, edges = dependencies)
- **Workflow Trace**: expandir un run del master y ver los child runs
- **Health Dashboard**: panel con estado de cada agente
- **React Flow**: los nodos del plan pueden renderizarse en el editor existente

---

## 8. Dependencias nuevas

| Paquete | Para qué | Ya existe en el proyecto |
|---------|----------|------------------------|
| (ninguno nuevo requerido) | — | — |

El enfoque nativo no requiere dependencias nuevas. La lógica de planning usa el LLM Router que ya está integrado. Los patterns de state graph se implementan con TypeScript puro.

**Opcional futuro:**
- `zod` para validación de schemas de plan (si no está ya)
- Un SDK de LLM más robusto si el interpreter actual queda corto

---

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| El LLM no descompone bien las tareas | Plan incorrecto → subtasks mal delegadas | Structured output + validation + fallback a routing simple |
| Loops infinitos en el supervisor | CPU/tokens quemados | Max iterations por plan (hardcoded) |
| Un agente falla y el workflow queda colgado | Run zombie | Timeouts por subtask + health monitor detecta |
| Explosion de tokens en coordinación | Costos altos | El master solo recibe resúmenes, nunca raw output |
| Complejidad de debugging | Hard to trace | La bitácora jerárquica + trace endpoint resuelven |

---

## 10. Próximos pasos si se aprueba

1. Extender `orchestrator/types.ts` con los nuevos commands/events/fields
2. Crear `backend/src/master-orchestrator/` con planner, supervisor, healthMonitor, bitacora
3. Extender la state machine
4. Agregar los endpoints nuevos a routes
5. Tests para el ciclo completo: plan → delegate → execute → evaluate → trace
6. Documentar en `docs/master-orchestrator.md`

---

*Este research queda como referencia para la decisión de implementación.*
