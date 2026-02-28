# Session 3 — Producción MVP

## Dependencias nuevas necesarias

```bash
cd backend
pnpm add better-sqlite3 multer
pnpm add -D @types/better-sqlite3 @types/multer
```

## Variables de entorno nuevas (.env)

```env
COMMUNITY_CODE=carilo2026
OPERATOR_PASSWORD=seguridad2026
COMMUNITY_DB_PATH=./data/community.db
```

## Archivos creados/modificados

### Backend — nuevos
| Archivo | Descripción |
|---|---|
| `src/community/db.ts` | SQLite database init + migrations (WAL mode) |
| `src/community/storeSqlite.ts` | Store completo sobre SQLite (reemplaza store.ts para community) |
| `src/community/photoStorage.ts` | Upload de fotos a disco + metadata en SQLite |
| `src/community/auth.ts` | Auth MVP: community code (vecino) + password (operador) |
| `src/community/routesV2.ts` | Rutas actualizadas con auth middleware + photo endpoints |

### Backend — modificados
| Archivo | Cambio |
|---|---|
| `.env.example` | Variables de community module |

### Frontend — nuevos
| Archivo | Descripción |
|---|---|
| `resident.html` | Entry point PWA del vecino |
| `src/resident/main.tsx` | Bootstrap + SW registration |
| `src/resident/ResidentApp.tsx` | Shell: gate (código) → form → tracker |
| `src/resident/ReportForm.tsx` | Formulario con fotos + community code |
| `src/resident/ReportTracker.tsx` | Timeline visual del estado del reporte |
| `src/resident/resident.css` | Estilos mobile-first: gate, form, tracker |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker (cache estáticos) |
| `public/icons/icon-192.svg` | Placeholder ícono PWA |

### Frontend — modificados
| Archivo | Cambio |
|---|---|
| `vite.config.ts` | Multi-page build (main + resident) |
| `src/App.tsx` | Removido tab "Reportar" (ahora en app separada) |
| `src/api.ts` | Auth headers, operatorLogin(), community_code en submit |

## Schema SQLite

```
reports           — id, tenant_id, resident_id, text, status, urgency, category, routed_to...
photos            — id, report_id, filename, filepath, mimetype, size_bytes
classification_runs — id, tenant_id, report_count, llm_calls, tokens, duration
notifications     — id, tenant_id, report_id, channel, destination, payload, status (PLACEHOLDER)
weekly_summaries  — id, tenant_id, week_start, week_end, data (JSON)
```

## Flujo del vecino

1. Abre `resident.html` → ve Gate (código de comunidad)
2. Ingresa código → validado contra backend → guardado en localStorage
3. Ve formulario de reporte (categoría, texto, foto, ubicación)
4. Envía → ve ReportTracker con timeline (Recibido → Clasificado → Derivado)
5. Polling cada 4s hasta clasificado
6. Puede copiar link de seguimiento (navigator.share en mobile)

## Flujo del operador

1. Abre `index.html` → App admin → tab Dashboard
2. Dashboard pide `x-operator-token` en cada request
3. Login via `operatorLogin(password)` guarda token en localStorage

## PWA

El vecino puede "Agregar a pantalla de inicio" desde el browser.
Service worker cachea assets estáticos para carga instantánea.
API calls siempre van a red (no cache offline de datos).

## PENDIENTE — Deploy

- [ ] Deploy backend (Fly.io / Railway / VPS)
- [ ] Deploy frontend vecino (Vercel / Netlify)
- [ ] HTTPS obligatorio (requerido para PWA + service worker)
- [ ] Generar íconos PNG reales (192x192, 512x512)
- [ ] Configurar COMMUNITY_CODE y OPERATOR_PASSWORD en producción
- [ ] Dominio: algo como seguridad.carilo.ar o app.talkative.ar

## PENDIENTE — Funcional

- [ ] Wiring: reemplazar `routes.ts` por `routesV2.ts` en el server (import en index.ts)
- [ ] Dashboard: agregar login gate antes de mostrar data
- [ ] Mapa de calor: componente visual con lat/lng de reportes
- [ ] Notificaciones: implementar adapter Telegram/WhatsApp
- [ ] Multi-tenant: activar cuando haya segundo cliente
