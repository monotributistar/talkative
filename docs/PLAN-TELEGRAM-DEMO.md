# PLAN: Telegram Bot Demo — Talkative

**Fecha:** 2026-03-21  
**Objetivo:** Demo funcional del flujo completo vecino → sistema → autoridad → vecino  
**Framework:** grammY (TypeScript, mismo proceso que Express backend)  

---

## Lo que la demo tiene que mostrar

1. Vecino manda mensaje al bot → reporte creado + clasificado automáticamente
2. Vecino manda ubicación → asociada al reporte
3. Vecino manda foto → adjuntada al reporte
4. Sistema clasifica (keyword instantáneo o LLM) → agrupa en incidente
5. Autoridad registrada recibe alerta del incidente
6. Autoridad responde al bot → respuesta publicada en el evento
7. Vecino recibe notificación con la respuesta oficial
8. Dashboard web muestra todo en tiempo real

## Arquitectura

```
Telegram (vecinos + autoridades)
      │
      │ long polling (grammY)
      ↓
telegramBot.ts (grammY Bot)
      │
      ├─ Identificar remitente (telegram_id → vecino o autoridad)
      │
      ├─ Si vecino:
      │    ingestReport() → classifyHybrid() → linkToIncident()
      │    → confirmar recepción por Telegram
      │    → si urgencia >= 4: notificar autoridad
      │
      ├─ Si autoridad:
      │    Parsear intención (keyword fallback)
      │    → respond_to_event / update_status
      │    → notificar vecinos del evento
      │
      └─ Comandos:
           /start → registro (vecino: código comunidad, autoridad: registrado por operador)
           /status → ver eventos activos del barrio
           /help → ayuda
```

## Estructura de archivos

```
backend/src/telegram/
  ├── bot.ts              # grammY Bot setup, command handlers, message router
  ├── handlers/
  │   ├── vecino.ts       # Handle vecino messages (text, photo, location)
  │   ├── autoridad.ts    # Handle authority responses
  │   └── commands.ts     # /start, /status, /help
  ├── contacts.ts         # Registro telegram_id → vecino/autoridad (SQLite table)
  ├── notifications.ts    # Enviar alertas a autoridades, updates a vecinos
  └── index.ts            # Export + startup (se llama desde server.ts)
```

## Registro de contactos

Nueva tabla en SQLite:

```sql
CREATE TABLE telegram_contacts (
  telegram_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('vecino', 'autoridad')),
  name TEXT,
  authority_role TEXT,          -- solo para autoridades: "Policía", "Delegación", etc.
  authority_institution TEXT,   -- "Comisaría Valeria del Mar"
  registered_at TEXT DEFAULT (datetime('now'))
);
```

Vecinos se registran solos con /start + código de comunidad.
Autoridades las registra el operador manualmente (o con un comando admin).

## Flujo de clasificación (híbrido)

```
Mensaje de vecino
      │
      ├─ Keywords match? ──── sí → clasificación inmediata (0ms, 0 costo)
      │                               │
      │                               └─ Confianza > 0.8? → usar directo
      │                                                  │
      │                                                  └─ Enriquecer con LLM async
      │
      └─ No match → LLM (Gemini, classifyService existente)
```

## Notificaciones

- Vecino manda reporte → bot responde: "✅ Reporte recibido. Categoría: [X]. Te avisamos."
- Incidente nuevo o urgencia >= 4 → bot notifica autoridades registradas para esa categoría
- Autoridad responde → bot notifica a todos los vecinos que reportaron ese incidente
- Estado cambia a resuelto → bot notifica: "✅ Resuelto: [título]. Respuesta: [texto]"

## Para la demo en vivo

1. Crear bot con @BotFather → obtener token
2. Registrar 2-3 contactos de prueba (nosotros como vecino + como autoridad)
3. Mostrar el flujo completo:
   - Vecino 1 reporta "hay un choque en Cerezo y Divisadero"
   - Vecino 2 reporta "accidente en Cerezo, dos autos"
   - Sistema agrupa → notifica autoridad
   - Autoridad responde "patrullero en camino"
   - Ambos vecinos reciben la actualización
   - Dashboard web muestra el evento en el mapa

## Dependencias

- `grammy` — framework del bot
- Todo lo demás ya existe: SQLite, storeSqlite, classifyService, incidentStore, photoStorage

## Lo que NO hace la demo

- No tiene state machine completo (eso viene en Fase 2)
- No tiene tool calling para autoridades (keyword parsing alcanza para la demo)
- No tiene escalamiento automático
- No tiene UI de registro de autoridades (se hace por SQLite directo o comando admin)

## Orden de implementación

1. [ ] `npm install grammy` en backend
2. [ ] Tabla `telegram_contacts` en db.ts migrations
3. [ ] `contacts.ts` — CRUD de contactos
4. [ ] `bot.ts` — setup grammY, /start, message router
5. [ ] `handlers/vecino.ts` — recibir texto/foto/ubicación → ingestReport
6. [ ] `classifyHybrid.ts` — keyword rules como Track 1
7. [ ] `notifications.ts` — enviar alertas por Telegram
8. [ ] `handlers/autoridad.ts` — parsear respuesta → publicar en evento
9. [ ] Integrar bot.start() en server.ts (mismo proceso)
10. [ ] Test manual: flujo completo en Telegram
