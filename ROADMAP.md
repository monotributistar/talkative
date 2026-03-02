# Talkative — Community Security MVP Roadmap

> Última actualización: 2026-03-02 (Session 8)

## Qué es

Sistema de seguridad comunitaria donde vecinos reportan incidentes vía app móvil, un LLM (Gemini) clasifica automáticamente cada reporte por categoría/urgencia, y los rutea al destinatario correcto (empresa de seguridad, bomberos, municipalidad, etc). El operador de seguridad monitorea todo desde un dashboard admin.

## Estado actual

### Funcional ✅
- **App vecino** (PWA mobile-first): formulario de reportes con categorías, fotos, ubicación
- **Dashboard admin**: métricas, heatmap de zonas calientes, feed de reportes, filtros por categoría/urgencia
- **Clasificación LLM directa**: servicio `classifyService.ts` que lee SQLite → llama Gemini → escribe SQLite (sin agentRunner)
- **6 categorías**: seguridad, bomberos, municipal, fiscalización, vialidad, convivencia
- **Multi-tenant**: `COMMUNITY_CODE_MAP` para múltiples barrios
- **Auth MVP**: código compartido para vecinos, password para operador
- **SQLite**: reportes, clasificaciones, fotos, resúmenes semanales, notificaciones (queue placeholder)
- **Dark mode**: CSS custom properties

### Arquitectura
```
Vecino (PWA)  →  POST /community/reports  →  SQLite (pending)
                                                    ↓
Operador (Dashboard)  →  POST /community/classify  →  classifyService
                                                    ↓
                                              Gemini LLM → classify → SQLite (classified)
                                                    ↓
                                              Dashboard actualiza ← GET /community/dashboard
```

## Deuda técnica conocida

| # | Prioridad | Descripción | Contexto |
|---|-----------|-------------|----------|
| 1 | P0 | **API keys en .env sin .env.example** | Key de Gemini se filtró en PR, Google la deshabilitó. Necesitamos .env.example con placeholders |
| 2 | P1 | **Auth no es producción** | Password compartido, sin JWT, sin per-user accounts |
| 3 | P1 | **No hay deploy** | Solo corre en localhost. Necesita hosting (Railway/Fly.io/VPS) |
| 4 | P2 | **Notificaciones son placeholder** | Queue existe en DB pero no hay sender (Telegram/WhatsApp/email) |
| 5 | P2 | **Reportes fallidos quedan en DB** | Si Gemini falla, el reporte se marca classified con confidence=0. Deberían quedar pending o tener estado "failed" |
| 6 | P2 | **Agente community-classifier sigue existiendo** | El refactor a classifyService lo hizo innecesario pero el template y agente siguen en el código |
| 7 | P3 | **cleanup-failed.cjs committeado** | Script de maintenance que no debería estar en el repo |
| 8 | P3 | **Frontend polling cada 4s** | MissionControl hace polling agresivo; debería ser WebSocket o SSE |

## Camino al primer cliente pagante

### Fase 1 — Demo vendible (actual → 1-2 sesiones)
- [ ] Deploy a servidor público (Railway o VPS)
- [ ] .env.example + documentación de setup
- [ ] Limpiar agente/skill legacy del código
- [ ] Flujo completo funcional en URL pública

### Fase 2 — Producción mínima (2-4 sesiones)
- [ ] Auth real: JWT + registro de operadores
- [ ] Notificaciones: al menos Telegram o WhatsApp al clasificar urgencia >= 4
- [ ] Auto-clasificación: cron o trigger automático cada N minutos
- [ ] Rate limiting y validación de inputs
- [ ] Onboarding: crear tenant desde UI

### Fase 3 — Producto escalable (posterior)
- [ ] Multi-barrio real con dashboard por tenant
- [ ] Historial y analytics avanzados
- [ ] Roles: admin, operador, vecino con accounts
- [ ] API pública para integración con cámaras/sensores
- [ ] Billing: plan por barrio/mes

## Sesiones completadas

| # | Fecha | Foco | Commit |
|---|-------|------|--------|
| 1 | 2026-02-28 | Diseño skill community-classifier | — |
| 2 | 2026-02-28 | Integración classifier + backend | — |
| 3 | 2026-02-28 | Full-stack MVP (form + dashboard) | — |
| 4 | 2026-02-28 | Dark mode + fotos + separación apps | — |
| 5 | 2026-02-28 | Consolidación + audit pre-deploy | `c6f0da0` |
| 6 | 2026-03-01 | PR review + CI fixes + local test | `7cbde1e` (Javier) |
| 7-8 | 2026-03-01/02 | classifyService refactor + UI fixes + API key rotation | `46845bd` |

## Decisiones de arquitectura

- **classifyService directo vs agentRunner**: Elegimos servicio directo (Session 7). El agente genérico ejecutando scripts CLI con JSONs intermedios era deuda técnica del POC. El módulo de seguridad comunitaria necesita un flujo predecible y testeable.
- **SQLite vs PostgreSQL**: SQLite para MVP. Migración a Postgres cuando tengamos multi-tenant real con concurrencia.
- **Gemini free tier**: Suficiente para demo y primeros clientes. Gemini 2.5 Flash es rápido y gratis.
