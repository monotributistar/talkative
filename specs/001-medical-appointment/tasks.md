# Tareas — Feature 001

Cada tarea debe copiar `.specify/templates/task.md` al comenzar y completar sus archivos permitidos, escenarios y comandos exactos.

| ID | Estado | Entregable | Owner | Depende de | Gate principal |
|---|---|---|---|---|---|
| T001 | done | Congelar vocabulario, escenarios y output contract | Integrador | — | Given/When/Then aceptados |
| T002 | done | JSON Schemas para decisiones, comandos, resultados y eventos | Integrador | T001 | fixtures válidas e inválidas |
| T003 | done | Modelos Principal, Subject, Delegation, Conversation y Case | Domain | T002 | migración y tenant isolation |
| T004 | done | Modelos Task, Attempt, Consent, Artifact y CalendarProjection | Domain | T002,T003 | constraints e idempotencia |
| T005 | done | Motor de turno estructurado sin efectos | Conversation | T002 | fixtures conversacionales |
| T006 | done | Adaptador de clínica simulada | Execution | T002 | suite contractual del adaptador |
| T006D | done | Baseline y migraciones PostgreSQL | Integrador | T003,T004 | fresh + adopción histórica sin drift |
| T007 | done | CaseManager y máquina de estados | Domain | T003,T004,T006D | transición inválida rechazada |
| T008 | done | Consentimiento y aprobación vinculados al caso | Domain | T004,T007 | scope, expiración y revocación |
| T009 | ready | Ejecutor de tareas, intentos, retry y handoff | Execution | T006,T007,T008 | límites e idempotencia |
| T010 | blocked | Persistencia de planes y supervisor estructurado | Execution | T007,T009 | recuperación tras reinicio |
| T011 | blocked | API de conversación, caso y timeline | Integrador | T005,T007,T009 | HTTP + tenant isolation |
| T012 | blocked | UI chat, resumen, aprobación y timeline | Conversation | T011 | pruebas de componentes |
| T013 | blocked | Eventos de producto, redacción y métricas | Execution | T007,T009 | funnel sin datos sensibles |
| T014 | blocked | Calendario simulado idempotente | Integrador | T009,T011 | una sola proyección |
| T015 | blocked | Matriz E2E sintética y evidencia | Integrador | T010-T014 | todos los escenarios críticos |

## Protocolo de asignación

El integrador entrega a cada agente:

```text
Tarea: T###
Objetivo:
Archivos permitidos:
Dependencias ya disponibles:
Contratos consumidos:
Contrato producido:
Escenarios obligatorios:
Comandos de validación:
Decisiones que no puede cambiar:
```

No asignar dos tareas que escriban el mismo archivo en paralelo.

## Definition of Done global

- [ ] Caso feliz, límite y fallo.
- [ ] Regresión por cada bug.
- [ ] Sin red, secretos ni datos reales.
- [ ] Typecheck, lint y test focal correctos.
- [ ] Contratos públicos validados.
- [ ] Migración comprobada si cambia Prisma.
- [ ] Evidencia de la tarea entregada en formato `AGENTS.md`.
