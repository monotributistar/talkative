# Talkative — Community Security: Roadmap Actualizado

> Última actualización: 2026-03-07 (post stats dashboard)
> Este documento reemplaza la versión anterior. Refleja el estado real del código.

---

## Estado actual del producto

### Funcional ✅
- **App vecino (PWA)**: formulario de reportes, fotos, ubicación, código compartido por barrio
- **Dashboard operativo** (`CommunityDashboard.tsx`): feed de reportes, clasificación manual, login operador
- **Dashboard estadísticas** (`StatsDashboard.tsx`): mapa Leaflet, KPIs, distribución, hotspots, actividad por franja, narrative line
- **8 endpoints REST** de stats: summary, timeline, by-hour, categories, hotspots, routing, reports-geo, export CSV
- **Clasificación LLM directa**: `classifyService.ts` (SQLite → Gemini → SQLite)
- **6 categorías**: seguridad, bomberos, municipal, fiscalización, vialidad, convivencia
- **Multi-tenant**: `COMMUNITY_CODE_MAP` para múltiples barrios
- **Auth MVP**: código compartido (vecinos) + password (operador)
- **Seed**: 150 reportes realistas, calles reales de Cariló, 21 ubicaciones
- **CI**: GitHub Actions (lint + typecheck + test + build) — verde

### PR #35 — Abierto contra main
- 20 commits, +11964/-62 líneas
- CI verde
- Reviews de Javier: 3 findings resueltos, 1 pendiente (P0 tenant spoofing)

---

## Bloqueante: P0 Tenant Spoofing en Endpoints Operator

**Problema**: Los endpoints operator (stats, dashboard, classify) usan `getTenantIdOrThrow(req)` que lee `x-tenant-id` del header. Como community routes van antes de `authenticateRequest` en `app.ts`, cualquier operador con la password puede forzar cualquier tenant cambiando el header.

**Impacto**: En producción multi-tenant, un operador de un barrio podría ver/operar datos de otro barrio.

**Fix propuesto**: Que `requireOperator` vincule la password al tenant. Opciones:
1. `OPERATOR_PASSWORD_MAP` en env: `tenant-carilo:pass1,tenant-nordelta:pass2`
2. Login devuelve token con tenant_id embebido (JWT lite)
3. Para MVP single-tenant: hardcodear `COMMUNITY_TENANT_ID` en requireOperator y no leer del header

**Decisión**: Opción 3 para desbloquear merge, con migración a opción 2 en Fase 2.

---

## Deuda técnica conocida

| # | Prioridad | Qué | Dónde | Estado |
|---|-----------|-----|-------|--------|
| 1 | P0 | Tenant spoofing operator | `statsRoutes.ts`, `routesV2.ts` → `guard.ts` | **Bloqueante** |
| 2 | P1 | Código muerto: `routes.ts` (v1 filesystem) | `backend/src/community/routes.ts` | Sin usar |
| 3 | P1 | Store duplicado: `store.ts` (filesystem) | `backend/src/community/store.ts` | Sin usar |
| 4 | P2 | `store.test.ts` testea store viejo | `backend/src/community/store.test.ts` | Desactualizado |
| 5 | P2 | SESSION docs en código | `community/SESSION*-CHANGES.md` (4 archivos) | Limpiar |
| 6 | P2 | Sin tests para stats | `statsService.ts`, `statsRoutes.ts` | 0 coverage |
| 7 | P2 | Notificaciones placeholder | Queue en DB pero sin sender | Sin implementar |
| 8 | P2 | Clasificación manual (no auto) | Operador hace click para clasificar | Sin cron/trigger |
| 9 | P3 | Frontend polling agresivo | `CommunityDashboard.tsx` cada 5s | Producción: reducir |
| 10 | P3 | `cleanup-failed.cjs` committeado | Raíz del repo | Borrar |
| 11 | P3 | `agents.json` modificado sin commit | `backend/data/agents.json` | En working tree |

---

## Camino al primer cliente pagante

### Fase 1 — Merge PR + Cleanup (1 sesión)
- [ ] Fix P0 tenant spoofing (opción 3: single-tenant hardcoded)
- [ ] Eliminar código muerto: `routes.ts`, `store.ts`, `store.test.ts`
- [ ] Eliminar SESSION docs del directorio community
- [ ] Commit, push, merge PR #35

### Fase 2 — Deploy público (1 sesión)
- [ ] `.env.example` con todas las variables documentadas
- [ ] Deploy backend a Railway/Fly.io/VPS
- [ ] Deploy frontend a Vercel o servir estáticos desde backend
- [ ] HTTPS + dominio (mínimo: subdominio gratuito de Railway)
- [ ] Verificar flujo completo en URL pública

### Fase 3 — Auto-clasificación + Notificaciones (1-2 sesiones)
- [ ] Auto-clasificación: trigger automático al recibir reporte (sin esperar click del operador)
- [ ] Notificaciones Telegram: bot que envía alerta cuando urgencia >= 4
- [ ] Rate limiting en endpoints públicos
- [ ] Validación de inputs (texto, fotos, coordenadas)

### Fase 4 — Demo vendible (1 sesión)
- [ ] Empty states (dashboard sin datos muestra onboarding claro)
- [ ] Login operador en stats dashboard (hoy no tiene, asume autenticado)
- [ ] Mobile testing del stats dashboard
- [ ] Documentación de setup para barrios nuevos

### Fase 5 — Producción real (2-3 sesiones)
- [ ] Auth JWT con accounts por operador
- [ ] Multi-tenant real: tenant derivado de token, no de header
- [ ] Onboarding: crear tenant desde UI
- [ ] Historial y analytics avanzados (TimeSeries chart)
- [ ] Roles: admin ve todo, operador ve su barrio

---

## Descartado del roadmap original

Estos items estaban planificados pero ya no son necesarios:

- **Componentes D3 separados** (B1-B8): Resuelto con SVG inline + HTML. Funciona, no necesita librería extra.
- **CategoryDonut interactivo**: La distribution list es más legible y ocupa menos espacio.
- **WeeklySummaryView**: El NarrativeLine autogenerado cubre esta necesidad.
- **UrgencyTrend sparkline**: Los colores de status en KPI strip ya lo comunican.
- **Custom date picker**: Los presets 7d/30d/90d alcanzan para el MVP.
- **Print styles**: No es prioridad.

---

## Arquitectura actual

```
Vecino (PWA)  →  POST /community/reports  →  SQLite (pending)
                                                    ↓
                                            classifyService (manual trigger)
                                                    ↓
                                              Gemini LLM → classify → SQLite
                                                    ↓
Operador (Dashboard)  ←  GET /community/dashboard  ←  SQLite
                      ←  GET /community/stats/*     ←  statsService.ts (8 endpoints)

Frontend:
  /dashboard  →  CommunityDashboard.tsx (operativo: feed, clasificar, incidentes)
  /stats      →  StatsDashboard.tsx (analytics: mapa, KPIs, distribución, hotspots)
  /resident   →  ResidentApp.tsx (PWA vecino: formulario de reportes)
```

## Archivos clave

```
backend/src/community/
  ├── auth.ts              # Auth MVP (código vecino + password operador)
  ├── classifyService.ts   # Clasificación LLM directa (Gemini)
  ├── db.ts                # SQLite setup + migrations
  ├── routesV2.ts          # Rutas operativas (reportes, dashboard, classify)
  ├── statsRoutes.ts       # 8 endpoints de estadísticas
  ├── statsService.ts      # Queries SQL para stats
  ├── storeSqlite.ts       # CRUD de reportes (SQLite)
  ├── incidentStore.ts     # Gestión de incidentes
  ├── photoStorage.ts      # Almacenamiento de fotos
  ├── routes.ts            # ❌ MUERTO — v1 filesystem, no se usa
  └── store.ts             # ❌ MUERTO — filesystem store, no se usa

frontend/src/dashboard/
  ├── StatsDashboard.tsx   # Dashboard de estadísticas completo
  ├── stats.css            # 819 líneas, container queries
  ├── statsApi.ts          # Client HTTP para 8 endpoints
  ├── statsTypes.ts        # Interfaces TypeScript
  ├── useStatsData.ts      # Hook con fetch paralelo + auto-refresh
  └── leaflet.d.ts         # Tipos para Leaflet CDN

backend/src/scripts/
  └── seedCommunity.ts     # 150 reportes realistas, calles de Cariló
```

---

*Sesiones completadas: 10 (8 previas + 2 de stats dashboard)*
