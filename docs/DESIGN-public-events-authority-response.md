# Design Doc: Eventos Públicos + Respuesta de Autoridades + WhatsApp

> **Estado**: Borrador para revisión — NO implementar sin discusión previa
> **Autores**: Tepha (Arcetro) + Claude
> **Fecha**: 2026-03-11
> **Audiencia**: Javier (monotributistar), reunión con Delegado de Cariló
>
> **Nota para Javier**: Este doc es una propuesta de diseño para discutir.
> Revisálo con tu IA, marcá lo que no cierra, proponé alternativas.
> Nada de esto está implementado — queremos iterar el diseño antes de tocar código.

---

## 1. El Problema

Hoy la comunicación entre vecinos y autoridades en Cariló funciona así:

- Grupo de WhatsApp con 200+ personas, el comisario de Valeria del Mar, el delegado, y vecinos mezclados.
- Un vecino reporta un choque. 5 vecinos más lo reportan. Se genera ruido.
- El comisario responde — pero a los 5 minutos el mensaje quedó enterrado entre otros mensajes.
- No hay registro formal de qué pasó, quién respondió, cuándo.
- Si un vecino que no estaba en el momento quiere saber qué pasó, tiene que scrollear 300 mensajes.

**Lo que falta no es tecnología, es organización.** Los vecinos ya usan WhatsApp. Las autoridades ya usan WhatsApp. Lo que no existe es una capa inteligente que ordene, agrupe, y haga visible la respuesta oficial.

---

## 2. Propuesta de Valor

**Talkative no es una app que reemplaza WhatsApp. Es el sistema nervioso que lo organiza.**

Los vecinos siguen mandando mensajes de WhatsApp. Las autoridades siguen respondiendo por WhatsApp. Pero:

- Los reportes se clasifican automáticamente (LLM).
- Los reportes similares se agrupan en un **evento** ("Choque en Cerezo y Divisadero").
- La autoridad correcta recibe una notificación organizada.
- La autoridad responde y esa respuesta queda **visible, permanente, y pública** para todo el barrio.
- El mapa del barrio muestra los eventos activos con sus respuestas.

---

## 3. Conceptos Clave

### 3.1 Evento Público

Un evento es un incidente que se hace visible para los vecinos. Hoy tenemos "incidentes" internos (solo el operador los ve). El cambio: cuando una autoridad responde, el incidente se convierte en evento público.

```
Incidente (interno)  →  Autoridad publica respuesta  →  Evento público (visible en mapa)
```

**Campos del evento público:**
- Título autogenerado (LLM): "Choque en Cerezo y Divisadero"
- Categoría: seguridad / bomberos / vialidad / etc.
- Ubicación (lat/lng + dirección)
- Estado: activo / atendido / resuelto / cerrado
- Cantidad de reportes agrupados
- Respuesta(s) oficial(es)
- Timestamp de creación y última actualización

### 3.2 Respuesta Oficial

Una respuesta de autoridad tiene:
- Autor con nombre real: "Comisario López, Comisaría Valeria del Mar"
- Rol/institución
- Texto de la respuesta
- Timestamp
- Medio por el que respondió (WhatsApp / webapp)

Un evento puede tener múltiples respuestas (actualización de estado):
1. "Patrullero en camino" — Comisario López, 19:05
2. "Tránsito cortado por Av. Divisadero" — Seguridad Cariló, 19:12
3. "Situación controlada, sin heridos" — Comisario López, 19:30

### 3.3 Roles de Autoridad

No son roles rígidos del sistema. Son accesos con nombre:

| Acceso | Ejemplo | Cómo se identifica |
|--------|---------|-------------------|
| Seguridad privada | Operador de guardia | Ya existe (OPERATOR_PASSWORD) |
| Policía | Comisario López | Número de WhatsApp registrado |
| Delegación | Delegado Municipal | Número de WhatsApp registrado |
| Bomberos | Bombero de turno | Número de WhatsApp registrado |

**Implementación MVP:** Una tabla `authorities` con nombre, rol, teléfono, y tenant_id. El bot de WhatsApp identifica quién responde por el número de teléfono.

---

## 4. Flujos de Uso

### 4.1 Flujo Principal: Vecino reporta → Autoridad responde

```
VECINO (WhatsApp)                     BOT TALKATIVE                      AUTORIDAD (WhatsApp)
      │                                     │                                    │
      │  "Hay un choque en Cerezo           │                                    │
      │   y Divisadero, 2 autos"            │                                    │
      │ ─────────────────────────────────>   │                                    │
      │                                     │                                    │
      │  "✅ Reporte recibido.              │  [Clasifica: seguridad/accidente]  │
      │   Te avisamos cuando haya           │  [Agrupa con reportes similares]   │
      │   novedades."                       │  [Crea/actualiza evento]           │
      │ <─────────────────────────────────  │                                    │
      │                                     │                                    │
      │                                     │  "🚨 EVENTO: Choque               │
      │                                     │   📍 Cerezo y Divisadero           │
      │                                     │   📊 3 reportes de vecinos         │
      │                                     │   Respondé a este mensaje para     │
      │                                     │   publicar una respuesta oficial." │
      │                                     │ ─────────────────────────────────> │
      │                                     │                                    │
      │                                     │  "Patrullero en camino,            │
      │                                     │   desvíen por Constancia"          │
      │                                     │ <───────────────────────────────── │
      │                                     │                                    │
      │  "📢 Actualización sobre            │  [Publica respuesta en evento]     │
      │   Choque en Cerezo y Divisadero:    │  [Marca evento como 'atendido']   │
      │   Comisario López: Patrullero       │                                    │
      │   en camino, desvíen por            │                                    │
      │   Constancia"                       │                                    │
      │ <─────────────────────────────────  │                                    │
```

### 4.2 Flujo: Vecino consulta estado

```
VECINO: "Qué pasó con el choque en Cerezo?"
BOT:    "🚗 Choque en Cerezo y Divisadero
         Estado: Atendido ✅
         Última actualización (19:12):
         Comisario López: 'Patrullero en camino, desvíen por Constancia'
         3 vecinos reportaron este evento."
```

### 4.3 Flujo: Vecino ve el mapa

En la webapp del vecino (o en un link que el bot comparte), el mapa de Cariló muestra:

- Pins de eventos activos con color por categoría
- Click en pin → detalle del evento con respuesta(s) oficial(es)
- Eventos resueltos se atenúan después de 24h y desaparecen después de 7 días

---

## 5. WhatsApp como Interfaz Principal

### 5.1 WhatsApp Cloud API

Ya tenemos el setup en progreso (Meta Business Portfolio). El bot necesita:

**Para vecinos (número del bot):**
- Recibir mensajes de texto → crear reporte
- Recibir ubicación → asociar coordenadas al reporte
- Recibir fotos → adjuntar al reporte
- Enviar confirmación de recepción
- Enviar notificación cuando hay respuesta oficial
- Responder consultas de estado ("qué pasó con...") vía LLM

**Para autoridades (número del bot, o grupo):**
- Enviar alerta cuando se crea/actualiza un evento en su jurisdicción
- Recibir respuesta de la autoridad → publicar en el evento
- La autoridad se identifica por su número de teléfono registrado

### 5.2 Identificación de Autoridad

Cuando alguien escribe al bot:
1. Bot busca el número en tabla `authorities`
2. Si es autoridad registrada → puede responder a eventos
3. Si es vecino registrado → puede crear reportes
4. Si es desconocido → pide código de comunidad

### 5.3 Webhook Architecture

```
WhatsApp Cloud API
      │
      │ webhook POST /webhooks/whatsapp
      ↓
Bot Handler (Node.js)
      │
      ├─ Identificar remitente (vecino / autoridad / desconocido)
      │
      ├─ Si vecino: crear reporte → clasificar → agrupar en evento
      │
      ├─ Si autoridad: identificar evento → publicar respuesta
      │
      └─ Enviar respuestas por WhatsApp Cloud API
```

---

## 6. Modelo de Datos (cambios al schema actual)

### 6.1 Tabla `authorities` (nueva)

```sql
CREATE TABLE authorities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,              -- "Comisario López"
  role TEXT NOT NULL,              -- "Policía" / "Delegación" / "Bomberos"
  institution TEXT,                -- "Comisaría Valeria del Mar"
  phone TEXT NOT NULL,             -- "+5491155551234" (WhatsApp)
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 6.2 Tabla `event_responses` (nueva)

```sql
CREATE TABLE event_responses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  authority_id TEXT NOT NULL REFERENCES authorities(id),
  text TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp', -- 'whatsapp' / 'webapp'
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 6.3 Cambios a `incidents` (existente)

Agregar campos:
```sql
ALTER TABLE incidents ADD COLUMN visibility TEXT DEFAULT 'internal';
  -- 'internal' = solo operador
  -- 'public' = visible para vecinos (auto-cambia cuando hay respuesta)
ALTER TABLE incidents ADD COLUMN public_title TEXT;
  -- Título legible: "Choque en Cerezo y Divisadero"
  -- Autogenerado por LLM al publicar
```

### 6.4 Tabla `whatsapp_contacts` (nueva)

```sql
CREATE TABLE whatsapp_contacts (
  phone TEXT PRIMARY KEY,          -- "+5491155551234"
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'vecino' / 'autoridad'
  resident_id TEXT,                -- FK si es vecino
  authority_id TEXT,               -- FK si es autoridad
  name TEXT,
  registered_at TEXT DEFAULT (datetime('now'))
);
```

---

## 7. Endpoints Nuevos

### Para el bot de WhatsApp

```
POST /webhooks/whatsapp                  — Webhook de WhatsApp Cloud API
POST /community/events/:id/responses     — Publicar respuesta (authority auth)
GET  /community/events/public            — Eventos públicos (para mapa vecino)
GET  /community/events/:id               — Detalle de evento público
```

### Para la webapp del operador

```
POST /community/authorities              — Registrar autoridad
GET  /community/authorities              — Listar autoridades
PUT  /community/incidents/:id/publish    — Hacer público un incidente
```

---

## 8. Fases de Implementación

### Fase A — Respuesta de autoridad por webapp (1-2 sesiones)
Lo mínimo para la demo con el delegado:
- Tabla `authorities` + `event_responses`
- Campo `visibility` en incidents
- Endpoint para publicar respuesta
- Vista pública de eventos en el mapa del vecino
- Operador puede registrar autoridades y publicar respuestas manualmente

### Fase B — Bot de WhatsApp para vecinos (2-3 sesiones)
- Webhook de WhatsApp Cloud API
- Recibir mensajes de texto → crear reporte
- Clasificación automática (ya existe)
- Confirmación de recepción por WhatsApp
- Notificación cuando hay respuesta oficial

### Fase C — Bot de WhatsApp para autoridades (1-2 sesiones)
- Identificación por número de teléfono
- Recibir alertas de eventos nuevos
- Responder al bot → publica respuesta en evento
- Actualización de estado por WhatsApp

### Fase D — LLM conversacional (futuro)
- Vecino pregunta "qué pasó en Cerezo?" → bot busca eventos y responde
- Autoridad dice "cerrá el evento del choque" → bot actualiza estado
- Resúmenes automáticos: "Esta semana hubo 12 eventos, 8 resueltos"

---

## 9. Para la Reunión con el Delegado

### Lo que podemos mostrar hoy:
- Dashboard de estadísticas con mapa real de Cariló
- 133 reportes distribuidos por todo el barrio
- Clasificación automática por LLM
- KPIs en tiempo real

### Lo que proponemos:
- "Los vecinos te reportan por WhatsApp, sin instalar nada."
- "Vos respondés por WhatsApp, y tu respuesta queda visible en el mapa para todos."
- "Cada evento queda registrado: qué pasó, quién respondió, cuándo."
- "Nosotros manejamos la tecnología, vos manejás la comunicación."

### Preguntas para el delegado:
1. ¿Cuántas autoridades participarían? (comisario, bomberos, delegación, seguridad privada)
2. ¿Prefiere responder por WhatsApp personal o por un número de la delegación?
3. ¿Hay eventos tipo que quiera rastrear? (cortes de luz, caídas de árboles, etc.)
4. ¿Hay algún canal formal donde hoy comunican resoluciones? (queremos integrarlo, no reemplazarlo)

---

## 10. Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| WhatsApp Cloud API tiene costo por conversación | Free tier 1000 conversaciones/mes, suficiente para piloto |
| Autoridad no responde | Timeout configurable + escalamiento automático |
| Reportes falsos / spam | Rate limiting + LLM detecta spam + código de comunidad |
| Múltiples barrios con mismo comisario | Multi-tenant soportado, un comisario puede estar en N barrios |
| Meta restringe la cuenta (ya pasó) | Nuevo Business Portfolio en proceso |

---

## 11. Stack Técnico

Todo lo que necesitamos ya lo tenemos o está en proceso:

| Componente | Estado |
|-----------|--------|
| Backend Node.js + Express | ✅ Existe |
| SQLite + better-sqlite3 | ✅ Existe |
| Clasificación LLM (Gemini) | ✅ Existe, auto-classify recién implementado |
| Agrupación en incidentes | ✅ Existe (incidentStore.ts) |
| Stats dashboard + mapa | ✅ Existe |
| WhatsApp Cloud API | 🟡 En setup (Meta Business Portfolio) |
| Webhook handler | 🔴 Por construir |
| Tabla authorities + responses | 🔴 Por construir |
| Vista pública para vecinos | 🔴 Por construir |

---

*Próximo paso: Discutir con Javier, iterar, y arrancar con Fase A (respuesta de autoridad por webapp) como proof of concept para la reunión con el delegado.*
