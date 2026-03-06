# Talkative — Dashboard de Estadísticas: Roadmap & Checklists

> Documento vivo. Sin orden de ejecución. Cada bloque es independiente.
> Marcar con `[x]` lo completado.

---

## A. BACKEND — Endpoints de Estadísticas

Todo lo que el frontend va a necesitar consumir. SQLite ya tiene los datos, solo faltan las queries granulares.

### A1. Endpoint: `/community/stats/timeline`

Serie temporal de reportes agrupados por día/semana/mes.

- [x] Query SQL con `strftime('%Y-%m-%d', created_at)` agrupado por día
- [x] Parámetros: `from`, `to`, `granularity` (day|week|month)
- [x] Response: `{ points: [{ date, total, classified, pending, avg_urgency }] }`
- [x] Incluir delta vs período anterior
- [x] Montado en `statsRoutes.ts`, protegido con `requireOperator`

### A2. Endpoint: `/community/stats/by-hour`

Distribución de reportes por hora del día (heatmap temporal).

- [x] Query SQL con `strftime('%H', created_at)` agrupando 0-23
- [x] Parámetros: `from`, `to`, `mode` (hourly|grid)
- [x] Response hourly: `{ hours: [...] }` / grid: `{ grid: [...] }` con day_of_week×hour
- [x] Modo grid cruza hora × día de semana para heatmap 2D

### A3. Endpoint: `/community/stats/categories`

Breakdown por categoría con tendencias.

- [x] Totales por categoría con queries propias
- [x] Comparativo vs período anterior por categoría (delta_pct)
- [x] Subcategorías top por cada categoría (top 5)
- [x] Response: `{ categories: [{ id, count, delta_pct, top_subcategories, avg_urgency }] }`

### A4. Endpoint: `/community/stats/hotspots`

Ubicaciones más recurrentes con detalle.

- [x] Agrupar por `address_hint`
- [x] Incluye: conteo, urgencia promedio, categoría más frecuente, último reporte
- [x] Parámetros: `from`, `to`, `limit`
- [x] Incluye `lat/lng` promediados para mapa
- [x] Response: `{ hotspots: [{ address, count, avg_urgency, top_category, last_report_at, lat, lng }] }`

### A5. Endpoint: `/community/stats/summary`

Resumen ejecutivo — los KPIs que van arriba del dashboard.

- [x] Total reportes
- [x] Reportes hoy / esta semana / este mes
- [x] Delta % vs semana anterior / mes anterior
- [x] Urgencia promedio y tendencia (up/down/stable)
- [x] Tiempo promedio de clasificación en segundos
- [x] Categoría más activa + pendientes + alta urgencia
- [x] Response completo con todos los KPIs

### A6. Endpoint: `/community/stats/routing`

Distribución por destinatario con métricas.

- [x] Agrupar por `routed_to`
- [x] Por cada ruta: conteo, urgencia máxima/promedio, últimas 24h
- [x] Response: `{ routes: [{ id, label, total, last_24h, avg_urgency, max_urgency }] }`

### A7. Weekly Summaries — Consumo en frontend

El endpoint ya existe (`GET /community/weekly-summary`). Falta conectar.

- [ ] Verificar que el response tiene todo lo que el frontend necesita
- [ ] Considerar: endpoint que devuelva el summary actual (sin generar nuevo)
- [ ] Considerar: auto-generación programada (cron o al acceder si pasó la semana)

### A8. Export

- [x] Endpoint `GET /community/stats/export?from=...&to=...`
- [x] CSV con todos los reportes del rango (clasificados y pendientes)
- [x] Columnas en español: id, fecha_creacion, categoria, urgencia, ubicacion, resumen, etc.
- [x] Headers `Content-Disposition: attachment` para descarga directa
- [ ] Futuro: PDF con el resumen ejecutivo (post-MVP)

---

## B. FRONTEND — Componentes de Charts (D3 Híbrido + React)

### B1. Setup: D3 como librería de cálculo

- [ ] Instalar dependencias: `d3-scale`, `d3-shape`, `d3-array`, `d3-time`, `d3-time-format`, `d3-color`
- [ ] NO instalar `d3-selection` (no vamos a manipular DOM con D3)
- [ ] Crear helpers compartidos: `chartUtils.ts` (escalas, formateadores de fecha, paleta de colores)
- [ ] Definir paleta de colores consistente con el theme actual (CSS variables → JS)

### B2. Componente: `TimeSeriesChart.tsx`

Línea temporal de reportes por día. El gráfico principal del dashboard.

- [ ] Eje X: fechas (últimos 30 días default)
- [ ] Eje Y: conteo de reportes
- [ ] Línea principal: total reportes
- [ ] Línea secundaria (opcional): urgencia promedio (eje Y derecho)
- [ ] Área sombreada bajo la línea para dar peso visual
- [ ] Tooltip al hover mostrando fecha + conteo + urgencia avg
- [ ] Responsive (width se adapta al container)
- [ ] Respeta dark/light theme

### B3. Componente: `CategoryDonut.tsx`

Donut chart de distribución por categoría.

- [ ] D3 `pie()` + `arc()` para calcular, React renderiza `<path>`
- [ ] Colores por categoría (reutilizar `CATEGORY_COLORS` existente)
- [ ] Label en el centro: total de reportes
- [ ] Leyenda al costado o abajo con porcentajes
- [ ] Click en segmento → filtra el dashboard (interactividad)
- [ ] Animación de entrada (transición de ángulo)

### B4. Componente: `HourHeatmap.tsx`

Heatmap de actividad por hora del día. Muestra cuándo pasan los incidentes.

- [ ] Grid 24 columnas (horas) × 7 filas (días de semana) — O versión simplificada: solo 24 barras
- [ ] Color intensity basado en conteo (D3 `scaleSequential` con interpolador)
- [ ] Tooltip por celda: hora, día, conteo, urgencia promedio
- [ ] Versión MVP: barras verticales por hora (más simple, mismo impacto)

### B5. Componente: `HotspotsBar.tsx`

Top ubicaciones con reportes recurrentes. Bar chart horizontal.

- [ ] Barras horizontales ordenadas por conteo descendente
- [ ] Color de barra según urgencia promedio del hotspot
- [ ] Label: nombre de ubicación + conteo
- [ ] Limitar a top 10
- [ ] Click → podría filtrar feed de reportes

### B6. Componente: `UrgencyTrend.tsx`

Indicador visual de si la urgencia promedio sube o baja.

- [ ] Sparkline o mini area chart de urgencia promedio por semana
- [ ] Flecha + porcentaje de cambio (↑ 12% o ↓ 5%)
- [ ] Color: rojo si sube, verde si baja
- [ ] Podría ser un componente pequeño dentro de un KPI card

### B7. Componente: `KPICards.tsx`

Los cards de métricas arriba del dashboard (evolución del actual).

- [ ] Total reportes (con delta % vs período anterior)
- [ ] Reportes hoy
- [ ] Urgencia promedio (con trend indicator)
- [ ] Tiempo promedio de clasificación
- [ ] Pendientes actuales
- [ ] Cada card: valor grande + label + mini indicador de tendencia
- [ ] Responsive: 5 cards en desktop, 2-3 en mobile

### B8. Componente: `WeeklySummaryView.tsx`

Visualización de resúmenes semanales históricos.

- [ ] Lista/timeline de semanas
- [ ] Cada semana: mini resumen con KPIs principales
- [ ] Expandible para ver detalle completo
- [ ] Comparativo semana vs semana

---

## C. FRONTEND — Página StatsDashboard

### C1. Estructura de la página

- [ ] Nuevo tab en `App.tsx`: "📈 Estadísticas" (separado del dashboard operativo)
- [ ] Layout: KPIs arriba → gráficos principales → detalle abajo
- [ ] Selector de rango de fechas global (últimos 7d / 30d / 90d / custom)
- [ ] El rango de fechas filtra todos los componentes a la vez
- [ ] Loading state global mientras cargan los datos

### C2. Layout propuesto (grid)

```
┌─────────────────────────────────────────────────┐
│  KPI Cards (5 across)                           │
├────────────────────────┬────────────────────────┤
│  TimeSeries (grande)   │  CategoryDonut         │
├────────────────────────┼────────────────────────┤
│  HourHeatmap           │  HotspotsBar           │
├────────────────────────┴────────────────────────┤
│  UrgencyTrend + Routing breakdown               │
├─────────────────────────────────────────────────┤
│  WeeklySummaries                                │
└─────────────────────────────────────────────────┘
```

- [ ] Implementar grid layout con CSS Grid
- [ ] Responsive: stack vertical en mobile
- [ ] Cada sección en un `<div class="card">` consistente con el diseño actual

### C3. Hook: `useStatsData.ts`

- [ ] Fetch a todos los endpoints de stats en paralelo
- [ ] Parámetros: `{ from, to }` del selector de rango
- [ ] Cache básico: no refetchear si el rango no cambió
- [ ] Loading/error states por sección (no bloquear todo si uno falla)
- [ ] Auto-refresh configurable (cada 60s? solo si el tab está activo?)

### C4. Date Range Picker

- [ ] Presets: Hoy, Últimos 7 días, Últimos 30 días, Este mes, Último mes
- [ ] Custom: dos inputs date para from/to
- [ ] Componente propio simple (no meter librería de date picker)
- [ ] Persiste selección en URL params (`?from=...&to=...`)

### C5. Export button

- [ ] Botón "Exportar CSV" que llama al endpoint de export
- [ ] Descarga directa del archivo
- [ ] Respeta el rango de fechas seleccionado
- [ ] Futuro: exportar como PDF con los gráficos (post-MVP)

---

## D. INTEGRACIÓN & CALIDAD

### D1. Tipos TypeScript compartidos

- [ ] Crear `statsTypes.ts` con interfaces de los responses de stats
- [ ] Sincronizar con los tipos del backend
- [ ] Exportar desde `api.ts` los nuevos fetchers

### D2. API client

- [ ] Agregar funciones en `api.ts` para cada endpoint nuevo
- [ ] Reutilizar `communityFetch` con auth operator
- [ ] Manejar errores consistentemente

### D3. CSS del dashboard de stats

- [ ] Archivo separado: `dashboard/stats.css`
- [ ] Reutilizar tokens CSS existentes (`--color-*`)
- [ ] Estilos específicos para charts (tooltips, ejes, legends)
- [ ] Dark/light theme para todos los gráficos
- [ ] Print styles básicos (para cuando alguien haga Ctrl+P)

### D4. Testing básico

- [ ] Al menos un test para cada endpoint de stats (query correcta, response shape)
- [ ] Test con DB vacía (no debe romper, debe devolver zeros)
- [ ] Test con datos edge: solo 1 reporte, reportes sin ubicación, sin clasificar

### D5. Performance

- [x] Indices SQLite: category, urgency, routed_to, address_hint (agregados en db.ts migrate)
- [ ] Considerar: tabla materializada para stats diarias si el volumen crece

---

## E. UX / PRODUCTO

### E1. Navegación

- [ ] Tab "📈 Estadísticas" en la barra de navegación principal
- [ ] Sub-navegación dentro de stats si crece (overview / detalle / historico)
- [ ] Breadcrumb o indicador de sección activa
- [ ] Deep link: `/stats?from=...&to=...` para compartir vistas

### E2. Empty states

- [ ] Dashboard sin datos: mensaje claro + call to action ("Aún no hay reportes")
- [ ] Gráfico sin datos en el rango: mensaje en el área del chart
- [ ] Parcial: algunos charts con datos, otros sin — no romper el layout

### E3. Acceso por rol (futuro, post-MVP)

- [ ] Bomberos solo ve categoría "bomberos"
- [ ] Seguridad privada ve todo
- [ ] Municipalidad ve todo con métricas de gestión
- [ ] Policía ve seguridad + vialidad
- [ ] Por ahora: todos ven todo tras login de operador

### E4. Mobile

- [ ] Los gráficos D3 deben funcionar en mobile (touch events para tooltips)
- [ ] Stack vertical en pantallas chicas
- [ ] KPI cards: 2 por fila en mobile
- [ ] Gráficos: ancho completo, altura reducida

---

## F. DEUDA TÉCNICA A RESOLVER (detectada en la auditoría)

Cosas detectadas en el código actual que deberíamos limpiar si tocamos esas áreas.

### F1. Doble sistema de routes

- [ ] Existen `routes.ts` (v1, usa file store) y `routesV2.ts` (SQLite)
- [ ] Verificar cuál está montada en `app.ts`
- [ ] Si v2 es la activa, considerar eliminar v1 o marcarla deprecated
- [ ] Los nuevos endpoints de stats van en `routesV2.ts`

### F2. Store duplicado

- [ ] `store.ts` (filesystem) y `storeSqlite.ts` coexisten
- [ ] `routes.ts` importa de `store.ts`, `routesV2.ts` de `storeSqlite.ts`
- [ ] Limpiar si v1 ya no se usa

### F3. Dashboard polling

- [ ] `CommunityDashboard.tsx` hace polling cada 5 segundos — agresivo para stats
- [ ] El dashboard de stats debería: no hacer polling, o hacerlo cada 60s
- [ ] Considerar: indicador de "datos actualizados hace X minutos" + botón refresh manual

### F4. Frontend monolítico

- [ ] Toda la app (MissionControl, WorkflowEditor, RouterAdmin, Dashboard) vive en un solo bundle
- [ ] Para producción: considerar code splitting o rutas lazy
- [ ] El resident.html ya tiene su propio entry point (bien)
- [ ] El dashboard de stats podría beneficiarse de lazy loading (charts son pesados)

---

## G. DATOS DE PRUEBA

Para que el dashboard se vea bien durante demos y desarrollo.

- [x] Script seed: genera 150 reportes distribuidos en los últimos 30 días
- [x] Variedad de categorías, ubicaciones, urgencias (6 categorías, 16 templates)
- [x] Distribución temporal realista (bias night/day por tipo de reporte)
- [x] Algunas ubicaciones repetidas (12 ubicaciones con pesos, para hotspots)
- [x] Reportes ya clasificados directo (90%), ~10% pendientes para testing
- [x] Ejecutable con: `pnpm seed:community` (flag `--clear` para resetear)
- [x] 15 resident IDs recurrentes (simula vecinos reales)
- [x] 3 classification_runs fake para métricas
- [ ] Testear que el seed corre sin errores (pendiente ejecución)

---

*Última actualización: 2026-03-04*
*Sesión: Talkative Dashboard Ideas*
