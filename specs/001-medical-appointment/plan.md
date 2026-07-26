# Plan — Feature 001

## Estrategia

Un integrador conserva contratos y wiring global. Tres agentes pequeños trabajan en paralelo sobre dominio, conversación y ejecución. Cada agente recibe una tarea acotada, no una fase completa.

## Ownership estable

| Rol | Ownership | No puede |
|---|---|---|
| Integrador | `specs/**`, contratos públicos, wiring, E2E | declarar completo sin gates |
| Domain | `backend/prisma/schema.prisma`, `backend/src/cases/**` | llamar conectores o generar conversación |
| Conversation | `backend/src/conversation/**`, `frontend/src/conversation/**` | ejecutar efectos o aprobar |
| Execution | `backend/src/execution/**`, `backend/src/adapters/**` | cambiar directamente el estado de Case |

El integrador es el único que modifica `backend/src/app.ts` y contratos congelados.

## Contratos que deben congelarse primero

1. `TurnDecision`: decisión estructurada del motor conversacional.
2. `TaskCommand`: comando validado con `case_id`, consentimiento, correlación e idempotencia.
3. `AdapterResult`: éxito con evidencia, espera, fallo, necesidad de usuario o handoff.
4. `DomainEvent`: sobre tipado y payload redactado.
5. Output contract de `medical_appointment`.

## Regla de escritura

```text
Conversation Engine -> propone TurnDecision
Policy/Consent      -> permite, deniega o pide aprobación
CaseManager         -> valida y cambia Case
Task Executor       -> crea Attempt y llama Adapter
Adapter             -> devuelve AdapterResult y evidencia
CaseManager         -> valida evidencia y puede emitir case.completed
```

## Oleadas

### Ola A — Contratos

T001 y T002. No comenzar implementación de producto hasta completar esta ola.

### Ola B — Fundaciones paralelas

- Domain: T003 y T004.
- Conversation: T005.
- Execution: T006.

### Ola C — Comportamiento

- Domain: T007 y T008.
- Execution: T009 y T010.
- Integrador: T011.

### Ola D — Experiencia y observabilidad

- Conversation: T012.
- Execution: T013.
- Integrador: T014.

### Ola E — Validación

T015 y revisión constitucional completa.

## Hito integrable

```text
conversación persistida
  -> caso creado
  -> datos confirmados
  -> consentimiento
  -> clínica simulada
  -> evidencia de turno
  -> caso completado
  -> calendario simulado
  -> timeline reconstruible tras reinicio
```

