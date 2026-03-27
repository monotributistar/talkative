# Talkative — Roadmap: De MVP a Primer Cliente Pagante

**Actualizado:** 2026-03-21  
**Autores:** Tepha + Claude  
**Contexto:** Incorpora insights de arquitectura de Portwatch (tool calling, deterministic floor, state machine)

---

## Visión del producto

Talkative es el sistema nervioso que organiza la comunicación entre vecinos y autoridades. No reemplaza WhatsApp — lo estructura. Los vecinos reportan, el sistema clasifica y agrupa, la autoridad responde, y la respuesta queda visible para todos.

**Primer cliente objetivo:** Delegación de Cariló (reunión pendiente con delegado).

---

## Estado actual (Marzo 2026)

### Funcional
- App vecino (PWA): formulario de reportes, fotos, ubicación
- Dashboard operativo: feed, clasificación manual, login
- Dashboard estadísticas: mapa Leaflet, KPIs, hotspots, actividad por franja
- Clasificación LLM (Gemini) con auto-trigger post-201
- Clustering/deduplicación de incidentes (incidentStore.ts)
- 8 endpoints REST de stats
- Multi-tenant básico, auth MVP (código vecino + password operador)
- Seed: 150 reportes realistas, calles de Cariló
- CI verde (lint + typecheck + test + build)

### Bloqueado
- PR #35 sin merge (P0 tenant spoofing pendiente)
- WhatsApp Cloud API en setup (Meta Business Portfolio)
- Sin deploy público
- Sin auto-notificaciones
- Sin respuesta de autoridades
- Sin vista pública de eventos para vecinos

---

## Patrón: Piso Determinístico + LLM Creativo

**Origen:** Research para Portwatch — Tam et al. 2024 demostró que forzar structured output en un LLM degrada razonamiento hasta 27%. La solución: reglas mecánicas garantizan un piso funcional, el LLM enriquece por encima.

### Aplicación en Talkative: Clasificación híbrida

**Track 1 — Reglas keyword (instantáneo, 0 costo, siempre disponible)**

| Keywords | Categoría | Confianza |
|---|---|---|
| fuego, incendio, humo, llamas | bomberos | 0.85 |
| choque, accidente, auto, colisión, volcó | vialidad | 0.85 |
| robo, robaron, asalto, arma, tiros, disparos | seguridad | 0.90 |
| música, ruido, fiesta, molestia, perro ladra | convivencia | 0.80 |
| árbol caído, bache, poste, luz cortada | municipal | 0.80 |
| venta ilegal, construcción sin permiso, ambulante | fiscalización | 0.75 |

Si el reporte matchea keywords con confianza >= threshold → clasificación inmediata, sin LLM.

**Track 2 — LLM (Gemini, para casos ambiguos y enriquecimiento)**

Se activa cuando:
- Keywords no matchean con confianza suficiente
- Reporte es ambiguo ("hay un tipo raro en la esquina")
- Se necesita generar el título del evento público
- Se necesita normalizar la ubicación

**Beneficio:** Si Gemini se cae, el sistema sigue clasificando el 60-70% de los reportes. El LLM enriquece, no es single point of failure.

**Implementación:** `backend/src/community/classifyHybrid.ts` — wrapper que prueba keywords primero, y si no alcanza, llama al LLM existente (`classifyService.ts`).

---

## Patrón: State Machine para Lifecycle de Incidentes

**Origen:** Portwatch — 7 modos con 25 transiciones válidas. Cada modo define qué acciones son posibles.

### Aplicación en Talkative: Lifecycle formal del incidente

```
Estados:
  pending        → Reporte recibido, sin clasificar
  classified     → Clasificado por keywords o LLM
  grouped        → Agrupado en incidente existente
  notified       → Autoridad correspondiente notificada
  acknowledged   → Autoridad confirmó recepción
  in_progress    → Autoridad trabajando en el tema
  resolved       → Autoridad declaró resuelto
  public         → Visible para vecinos en el mapa
  archived       → Cerrado después de N días
```

**Transiciones válidas (ejemplos):**

| From | To | Trigger | Automático |
|---|---|---|---|
| pending | classified | keyword_match o llm_classify | sí |
| classified | grouped | cluster_match (incidentStore) | sí |
| grouped | notified | notification_sent | sí |
| notified | acknowledged | authority_ack (WhatsApp) | no |
| acknowledged | in_progress | authority_response | no |
| in_progress | resolved | authority_resolve | no |
| resolved | public | auto (siempre publicar resolución) | sí |
| any | archived | time_expiry (7 días sin actividad) | sí |

**Qué cambia por estado:**

| Estado | Visible vecino | Notifica autoridad | Acepta respuesta | En mapa |
|---|---|---|---|---|
| pending | no | no | no | no |
| classified | no | no | no | no |
| grouped | no | sí (primera vez) | no | no |
| notified | no | no | sí | no |
| acknowledged | sí (genérico) | no | sí | sí (gris) |
| in_progress | sí | no | sí | sí (amarillo) |
| resolved | sí | no | no | sí (verde) |
| archived | no | no | no | no |

**Implementación:** `backend/src/community/incidentStateMachine.ts` — misma estructura que `portwatch-game/server/src/game-modes/state-machine.ts`. Tipos, transiciones válidas, config por estado, funciones `canTransition()`, `tryTransition()`.

**Beneficio:** El delegado puede ver un diagrama de cómo fluye un reporte. El código valida que no se salteen pasos. El audit trail registra cada transición con timestamp y actor.

---

## Patrón: Tool Calling para Bot WhatsApp

**Origen:** Portwatch — en vez de pedirle al LLM que genere JSON complejo, le das tools y él elige cuáles llamar.

### Aplicación en Talkative: Bot de autoridad con tool calling

Cuando una autoridad escribe al bot de WhatsApp, el LLM no necesita generar JSON. Recibe tools:

```
Tools disponibles para autoridades:
- acknowledge_event(event_id) — "Recibido, estamos viendo"
- respond_to_event(event_id, message) — Publicar respuesta oficial
- update_status(event_id, status) — Cambiar estado (in_progress/resolved)
- request_info(event_id, question) — Pedir más info a vecinos del evento
```

La autoridad escribe: "recibido, mandamos patrullero al choque de Cerezo"
El LLM parsea → `respond_to_event(event_id: "inc_xxx", message: "Mandamos patrullero")` + `update_status(event_id: "inc_xxx", status: "in_progress")`

**¿Qué modelo?** Gemini Flash (ya lo usamos) soporta tool calling nativo. Alternativa: Groq Llama 3.3 (ya integrado en Portwatch, código reutilizable).

**Piso determinístico del bot:** Si el LLM falla, el bot parsea con regex simples:
- "recibido" / "ok" / "enterado" → `acknowledge_event`
- "resuelto" / "solucionado" / "listo" → `update_status(resolved)`
- Cualquier otro texto de autoridad → `respond_to_event` con el texto literal

---

## Fases de Implementación

### Fase 1 — Merge + Deploy (1 sesión) — DESBLOQUEA TODO
- [ ] Fix P0 tenant spoofing (hardcode single tenant para MVP)
- [ ] Eliminar código muerto (routes.ts, store.ts, store.test.ts)
- [ ] Merge PR #35
- [ ] Deploy backend a Railway/Fly.io
- [ ] Deploy frontend a Vercel (o estáticos desde backend)
- [ ] URL pública funcionando con seed data

### Fase 2 — Clasificación híbrida + State Machine (1-2 sesiones)
- [ ] `classifyHybrid.ts`: keyword rules como Track 1, Gemini como Track 2
- [ ] `incidentStateMachine.ts`: estados, transiciones, config, audit trail
- [ ] Migrar `incidentStore.ts` para usar state machine en todas las transiciones
- [ ] Auto-clasificación inmediata al recibir reporte (keyword) + async LLM (enriquecimiento)
- [ ] Tests para state machine + hybrid classifier

### Fase 3 — Eventos públicos + vista vecino (1-2 sesiones)
- [ ] Tabla `authorities` + `event_responses` en SQLite
- [ ] Campo `visibility` + `public_title` en incidents
- [ ] Endpoint público: GET /community/events/public (para mapa vecino)
- [ ] Vista pública en frontend: mapa con pins de eventos activos + respuestas
- [ ] Operador puede publicar respuestas manualmente desde dashboard

### Fase 4 — Bot WhatsApp vecinos (2-3 sesiones)
- [ ] Completar setup WhatsApp Cloud API (Meta Business Portfolio)
- [ ] Webhook handler: POST /webhooks/whatsapp
- [ ] Recibir texto → crear reporte → clasificación híbrida
- [ ] Recibir ubicación → asociar coordenadas
- [ ] Recibir fotos → adjuntar
- [ ] Enviar confirmación de recepción
- [ ] Enviar notificación cuando hay respuesta oficial

### Fase 5 — Bot WhatsApp autoridades (1-2 sesiones)
- [ ] Tabla `whatsapp_contacts` para identificación por teléfono
- [ ] Tool calling con Gemini/Groq para parsear intención de autoridad
- [ ] Piso determinístico (regex) como fallback
- [ ] Alerta al autoridad cuando se crea evento en su jurisdicción
- [ ] Respuesta de autoridad → publica en evento + transiciona estado

### Fase 6 — Demo vendible (1 sesión)
- [ ] Empty states (dashboard sin datos muestra onboarding claro)
- [ ] Mobile testing del stats dashboard
- [ ] Documentación de setup para barrios nuevos
- [ ] Script de onboarding: crear tenant + seed + autoridades
- [ ] Deck de presentación para delegado (con screenshots reales)

---

## Qué se reutiliza de Portwatch

| Componente Portwatch | Adaptación Talkative | Esfuerzo |
|---|---|---|
| `state-machine.ts` (tipos + transiciones + config) | `incidentStateMachine.ts` — misma estructura, diferentes estados | Bajo |
| Mutation validator (Zod schemas) | Validación de transiciones de estado | Bajo |
| Groq provider (`llm/groq.ts`) | Provider alternativo si Gemini falla | Medio |
| Tool calling pattern (mutations v2) | Bot de autoridad con tool definitions | Medio |
| Quality scorer concept | Métricas de eficiencia: tiempo promedio de respuesta, % resueltos | Bajo |
| Chronicle (WorldMemory) | Audit trail de incidentes (ya existe parcialmente en `incident_events`) | Ya existe |

---

## Métricas de éxito (para el delegado)

| Métrica | Target | Cómo se mide |
|---|---|---|
| Tiempo reporte → clasificación | < 5 segundos (keywords) / < 30s (LLM) | Timestamp diff |
| Tiempo reporte → respuesta autoridad | < 30 minutos | State machine transitions |
| % reportes clasificados sin LLM | > 60% | Counter keyword vs LLM |
| % incidentes con respuesta oficial | > 80% | Estado != pending/classified después de 24h |
| Reportes duplicados agrupados | > 70% clustering accuracy | Manual review |
| Uptime del sistema | > 99% | Healthcheck endpoint |

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| WhatsApp Cloud API no aprobada a tiempo | Fase 1-3 funcionan sin WhatsApp (webapp only) |
| Gemini rate limits en producción | Clasificación híbrida: keywords cubren 60%+ |
| Delegado no convencido | Demo con datos reales de Cariló, UX limpia |
| Javier no disponible para reviews | Fases independientes, cada una mergeable por separado |
| Multi-tenant prematuro | Single-tenant hardcoded para primer cliente, refactor después |

---

## Lo que NO hacemos (por ahora)

- Auth JWT completo (alcanza con código + password)
- Multi-tenant real (un barrio es suficiente para el piloto)
- Analytics avanzados (las stats que hay alcanzan para la demo)
- App nativa (PWA es suficiente)
- Inteligencia predictiva ("va a haber un pico de robos mañana")
- Integración con sistemas policiales formales

---

*Objetivo: llegar a Fase 3 (eventos públicos funcionando en URL pública) antes de la reunión con el delegado. Fases 4-5 (WhatsApp) se desarrollan en paralelo si la API está aprobada.*
