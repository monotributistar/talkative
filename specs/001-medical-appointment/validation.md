# Validación — Feature 001

## Capas

| Nivel | Alcance | Entorno |
|---|---|---|
| L0 | lint, typecheck, build | CI actual |
| L1 | contratos y unidades de dominio | `node:test`, sin DB/red/LLM |
| L2 | servicios con repositorios fake | reloj e IDs deterministas |
| L3 | persistencia y API | PostgreSQL efímero + Supertest |
| L4 | contratos de adaptadores | clínica y calendario simulados |
| L5 | componentes frontend | Vitest + Testing Library |
| L6 | producto E2E | Playwright, stack local sintético |
| L7 | smoke de conectores reales | staging, fuera de CI |

## Fixtures mínimas

- Ana Pérez y Tomás, ambos sintéticos.
- Delegación válida, expirada y revocada.
- Clínica `clinic_01` con slots fijos.
- Reloj fijo: `2026-08-03T12:00:00-03:00`.
- IDs y correlation IDs predecibles.
- Respuestas de éxito, espera, fallo reintentable y fallo final.
- Comprobante sintético con checksum.
- Calendario vacío y calendario con evento existente.

## Gates

### G1 — Tarea

Test focal y typecheck del paquete afectado.

### G2 — Repositorio

```bash
npm run lint
npm run typecheck
npm run test:backend
npm run build
```

Cuando existan:

```bash
npm run test:integration
npm run test:frontend
npm run test:e2e:mvp
```

### G3 — Dominio

- transición inválida rechazada;
- `completed` exige intento exitoso y evidencia válida;
- fallo de calendario no borra una reserva confirmada.

### G4 — Privacidad

Prueba automática de que eventos y logs no contienen nombre completo, fecha de nacimiento, documento, texto clínico o contenido de archivos.

### G5 — Persistencia

Base PostgreSQL desde cero, migración, seed sintético, reinicio y reconstrucción del caso.

### G6 — E2E

Todos los escenarios críticos pasan sin reintentos ocultos para tolerar flaky tests. Se guardan trace, screenshot y logs sólo ante fallo.

### G7 — Release

Smoke en staging, rollback de aplicación y migración, y verificación del dashboard de eventos.

## Criterio de salida del MVP

- los escenarios críticos pasan desde UI hasta base y adaptadores;
- el caso sobrevive un reinicio;
- retries y doble submit no duplican reserva ni calendario;
- handoff conserva contexto y responsable;
- tenant isolation está probado;
- todo `completed` tiene evidencia verificable;
- ninguna telemetría contiene datos sensibles.

