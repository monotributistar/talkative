# Design: Master Orchestrator — Contrato y Especificación

*Fecha: 2026-02-26*
*Repo: talkative*
*Prerequisito: docs/research-hierarchical-orchestration.md*
*Estado: Phase 2 IMPLEMENTED — Planner + Supervisor + Health Monitor*

---

## 1. Resumen

El Master Orchestrator es una nueva capa que se monta sobre el `AgentHub` existente.
Recibe pedidos complejos, los descompone en subtareas usando el LLM, delega cada
subtarea a agentes existentes via `AgentHub.sendMessage()`, y registra la traza
completa en el event store.

No reemplaza nada. Los agentes, el orchestrator, el router, el event store —
todo sigue funcionando igual. Esto se suma.

---

## 2. Nuevos Types (extiende orchestrator/types.ts)

```typescript
// ── Plan ──────────────────────────────────────────────

export type ExecutionStrategy = "sequential" | "parallel";

export type SubTaskStatus = "pending" | "delegated" | "completed" | "failed";

export interface SubTask {
  id: string;
  description: string;
  target_agent_id: string;
  dependencies: string[];        // IDs de subtasks que deben completar antes
  priority: number;              // 1 = más alta
  status: SubTaskStatus;
  result?: AgentMessageResponse;
  error?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface TaskPlan {
  plan_id: string;
  tenant_id: string;
  original_request: string;
  subtasks: SubTask[];
  strategy: ExecutionStrategy;
  created_at: string;
  created_by: string;            // "llm" | "template" (futuro)
}

// ── Master Run (extiende RunRecord) ───────────────────

export interface MasterRunRecord extends RunRecord {
  is_master: true;
  plan_id: string;
  child_run_ids: string[];
  plan_snapshot: TaskPlan;
  health_snapshot?: WorkflowHealth;
  final_summary?: string;
}

// ── Health ────────────────────────────────────────────

export interface AgentHealthStatus {
  agent_id: string;
  name: string;
  status: "healthy" | "slow" | "failing" | "unreachable";
  success_rate: number;          // 0..1, últimas N ejecuciones
  avg_response_time_ms: number;
  last_error?: string;
  last_active?: string;
  total_invocations: number;
}

export interface WorkflowHealth {
  plan_id: string;
  total_subtasks: number;
  completed: number;
  failed: number;
  overall_duration_ms: number;
  agent_health: AgentHealthStatus[];
  overall_status: "healthy" | "degraded" | "critical";
}

// ── Nuevos command/event types ────────────────────────

// Agregar a OrchestratorCommandType:
//   | "delegate_subtask"
//   | "evaluate_result"

// Agregar a OrchestratorEventType:
//   | "plan_created"
//   | "subtask_delegated"
//   | "subtask_completed"
//   | "subtask_failed"
//   | "workflow_evaluated"
//   | "health_check"
```

---

## 3. Componentes

### 3.1 Planner

**Archivo:** `backend/src/master-orchestrator/planner.ts`

**Responsabilidad:** Toma un pedido + lista de agentes disponibles,
le pide al LLM que descomponga en subtareas.

**Input:**
- `request: string` — el pedido del usuario
- `agents: AgentRecord[]` — agentes disponibles con sus skills

**Output:**
- `TaskPlan` — plan estructurado

**Cómo funciona:**
1. Arma un prompt con la lista de agentes, sus skills, y el pedido
2. Le pide al LLM un JSON estructurado con subtareas
3. Valida que los `target_agent_id` existan
4. Valida que las `dependencies` sean coherentes (sin ciclos)
5. Retorna el plan

**Prompt template (sketch):**
```
You are a task planner. Given a user request and a list of available agents
with their skills, decompose the request into subtasks.

Available agents:
{{#each agents}}
- Agent "{{name}}" (id: {{id}}), skills: {{skills}}
{{/each}}

User request: "{{request}}"

Respond with a JSON object:
{
  "subtasks": [
    {
      "id": "st-1",
      "description": "what this subtask does",
      "target_agent_id": "which agent handles it",
      "dependencies": [],
      "priority": 1
    }
  ],
  "strategy": "sequential" | "parallel"
}

Rules:
- Only assign to agents that exist in the list
- If a subtask depends on the output of another, list it in dependencies
- Keep subtasks atomic — one clear action each
- If the request is simple enough for one agent, return a single subtask
```

**Integración:** Usa el LLM Router existente para la call.
El usage se trackea en el router como cualquier otra call.

---

### 3.2 Supervisor

**Archivo:** `backend/src/master-orchestrator/supervisor.ts`

**Responsabilidad:** Ejecuta un `TaskPlan` delegando al `AgentHub`.

**Flujo (sequential):**
```
1. Recibe TaskPlan
2. Ordena subtasks por dependencies + priority
3. Para cada subtask en orden:
   a. Marca status = "delegated"
   b. Emite event "subtask_delegated"
   c. Llama agentHub.sendMessage(target_agent_id, description)
   d. Recibe resultado
   e. Evalúa resultado (opcionalmente via LLM)
   f. Marca status = "completed" | "failed"
   g. Emite event "subtask_completed" | "subtask_failed"
   h. Si failed: decide si reintenta o aborta (por ahora: aborta)
4. Cuando terminan todas: emite "workflow_evaluated"
5. Arma final_summary con los resultados
```

**Flujo (parallel, futuro):**
```
Agrupa subtasks sin dependencies mutuas y las ejecuta con Promise.all.
Para v0 no lo necesitamos.
```

**Integración con orchestrator store:**
- Crea un `MasterRunRecord` al empezar
- Cada subtask delegada también crea/actualiza un run hijo via `appendCommand`
- El run del master tiene `child_run_ids` apuntando a los runs hijos

**Timeouts:**
- Cada subtask tiene un timeout configurable (default: 60s)
- Si el timeout se cumple → status = "failed", error = "timeout"

**Max subtasks:**
- Hardcoded limit: 10 subtasks por plan (previene loops de LLM)

---

### 3.3 Health Monitor

**Archivo:** `backend/src/master-orchestrator/healthMonitor.ts`

**Responsabilidad:** Lee del event store y calcula métricas de salud.

**Métodos:**
- `checkAgentHealth(agent_id): AgentHealthStatus`
  Lee últimos N events del agente, calcula success_rate y avg_response_time
- `checkWorkflowHealth(plan_id): WorkflowHealth`
  Agrega health de cada agente involucrado en el plan
- `getSystemOverview(tenant_id): AgentHealthStatus[]`
  Health de todos los agentes del tenant

**Fuentes de datos:**
- Event store (agentEvents): para calcular success/fail rates
- RunRecord steps: para duraciones
- Prometheus metrics endpoint (opcional, para latencia HTTP)

---

### 3.4 Bitácora (se integra en el event store existente)

NO es un componente separado. Se implementa emitiendo los nuevos event types
al event store que ya existe (`appendEvent`).

Cada evento lleva:
- `tenant_id`, `agent_id`, `run_id` (como hoy)
- `plan_id` en el payload
- `parent_run_id` en el payload (para traza jerárquica)

Para reconstruir la traza completa de un workflow:
```typescript
async function getWorkflowTrace(master_run_id: string): Promise<{
  master: MasterRunRecord;
  children: RunRecord[];
  events: OrchestratorEvent[];
}> {
  const master = await getRun(master_run_id);
  const children = await Promise.all(
    master.child_run_ids.map(id => getRun(id))
  );
  // Eventos de todos los runs involucrados
  const events = ...; 
  return { master, children, events };
}
```

---

## 4. Nuevos Endpoints

```
POST /orchestrator/plan
  Body: { request: string, tenant_id: string }
  Response: TaskPlan
  → Llama al Planner, retorna el plan sin ejecutarlo

POST /orchestrator/plan/:plan_id/execute
  Response: MasterRunRecord
  → El Supervisor ejecuta el plan

GET /orchestrator/runs/:run_id/trace
  Response: { master, children, events }
  → Traza jerárquica completa

GET /orchestrator/health
  Query: ?tenant_id=
  Response: AgentHealthStatus[]
  → Overview de salud del sistema

GET /orchestrator/health/:agent_id
  Response: AgentHealthStatus
  → Health de un agente específico
```

---

## 5. Estructura de archivos nuevos

```
backend/src/master-orchestrator/
├── planner.ts          # LLM-driven task decomposition
├── supervisor.ts       # Ejecuta planes delegando al AgentHub
├── healthMonitor.ts    # Calcula métricas de salud
├── types.ts            # Types nuevos (Plan, SubTask, Health, MasterRun)
├── index.ts            # Exports
└── __tests__/
    ├── planner.test.ts
    └── supervisor.test.ts
```

Modificaciones a archivos existentes:
- `orchestrator/types.ts` — agregar nuevos command/event types
- `orchestrator/stateMachine.ts` — manejar `delegate_subtask` y `workflow_evaluated`
- `orchestrator/store.ts` — soporte para `parent_run_id` y `child_run_ids`
- `routes/` — nuevos endpoints

---

## 6. Lo que NO incluye esta versión

- Ejecución paralela de subtasks (futuro)
- Re-routing automático cuando un agente falla (futuro)
- Templates de plan predefinidos — Opción B (futuro, optimización)
- UI en Mission Control para visualizar planes (futuro, no bloquea backend)
- Aprobación de plan por el usuario antes de ejecutar (futuro, usar HITL existente)

---

## 7. Diagrama de secuencia (camino feliz)

```
Usuario                 API              Planner         Supervisor       AgentHub        EventStore
  │                      │                  │                │               │               │
  ├─POST /plan──────────▶│                  │                │               │               │
  │                      ├─createPlan()────▶│                │               │               │
  │                      │                  ├─LLM call──────▶│               │               │
  │                      │                  │◀──TaskPlan─────│               │               │
  │◀─────TaskPlan────────│                  │                │               │               │
  │                      │                  │                │               │               │
  ├─POST /plan/:id/exec─▶│                  │                │               │               │
  │                      ├─execute()────────────────────────▶│               │               │
  │                      │                  │                ├─subtask 1────▶│               │
  │                      │                  │                │               ├─sendMessage()─▶
  │                      │                  │                │               │◀──response─────│
  │                      │                  │                │◀──result──────│               │
  │                      │                  │                ├─emit event────────────────────▶│
  │                      │                  │                │               │               │
  │                      │                  │                ├─subtask 2────▶│               │
  │                      │                  │                │  ... (same)   │               │
  │                      │                  │                │               │               │
  │                      │                  │                ├─health check──│               │
  │                      │                  │                ├─emit evaluated─────────────────▶
  │◀─────MasterRunRecord─│                  │                │               │               │
```

---

## Implementation Log

### Phase 1 — Contract (completed 2026-02-26)
- Extended `orchestrator/types.ts` with new command/event types
- Created `master-orchestrator/types.ts` with TaskPlan, SubTask, MasterRunRecord, Health types
- Updated `orchestrator/stateMachine.ts` with master orchestrator transitions
- Updated `agents/agentHub.ts`: classifyAgent now returns `{ agent, confidence }`
- Documented `services/interpreter.ts` to distinguish from Planner

### Phase 2 — Planner + Supervisor (completed 2026-02-26)
- `master-orchestrator/llmClient.ts`: provider-agnostic LLM client via fetch (OpenAI-compatible)
- `master-orchestrator/planner.ts`: LLM-driven decomposition with validation (agent existence, cycle detection, max subtasks)
- `master-orchestrator/supervisor.ts`: sequential execution via AgentHub, timeout support, abort-on-failure, WorkflowHealth building
- `master-orchestrator/healthMonitor.ts`: reads event store, computes agent health metrics
- `routes/masterOrchestratorRoutes.ts`: API endpoints (plan, execute, run, trace, health)
- Registered in `app.ts`
- Unit tests for state machine transitions and topological ordering

### Phase 3 — Observability (pending)
- Trace endpoint exists but needs enrichment (child run aggregation)
- Health Monitor basic implementation done

### Phase 4 — Iteration (future)
- Parallel execution
- Conditional routing / re-routing on failure
- Plan persistence (currently in-memory)
- Mission Control UI

### Environment Variables
```
LLM_API_KEY=     # Required for Planner
LLM_BASE_URL=    # Default: https://api.openai.com/v1
LLM_MODEL=       # Default: gpt-4o-mini
```

### API Endpoints
```
POST /orchestrator/plan          — Create plan (no execute)
POST /orchestrator/plan/:id/execute — Execute existing plan
POST /orchestrator/run           — Plan + execute in one call
GET  /orchestrator/runs/:id/trace — Hierarchical trace
GET  /orchestrator/health         — System health overview
GET  /orchestrator/health/:id     — Agent health
```
