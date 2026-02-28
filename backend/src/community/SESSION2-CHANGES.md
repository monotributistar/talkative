# Branch Update Summary - Session 2

## Changes Applied

### 1. CSS Custom Properties (Dark Mode Architecture)
**Problem:** Dark mode was inline JS objects in prototype, unmaintainable at scale.
**Solution:** All colors in `styles.css` as CSS custom properties. Toggle is one line: `document.documentElement.setAttribute('data-theme', 'dark')`.

Files modified:
- `frontend/src/styles.css` — Added `:root` tokens (30+ variables) + `[data-theme="dark"]` override block. Migrated ALL hardcoded colors to `var(--color-*)`. Added `.photo-upload`, `.photo-thumb`, `.photo-add-btn`, `.theme-toggle` classes.

### 2. Frontend Synced with Prototype
**Problem:** `ResidentReport.tsx` and `CommunityDashboard.tsx` lagged behind interactive prototype.
**Solution:** Rewrote both with photo upload, CSS classes (no inline), urgency filters.

Files modified:
- `frontend/src/ResidentReport.tsx` — Added `PhotoUpload` component (max 4, camera capture, preview + remove). Added `ReportTracker` component (polls report status, shows classification result to resident).
- `frontend/src/CommunityDashboard.tsx` — Fully uses CSS classes. Category filter + urgency filter. Photo badge in feed items.
- `frontend/src/App.tsx` — Already had dark mode toggle (confirmed).
- `frontend/src/api.ts` — Added `getReportStatus()` + `ReportStatus` interface.

### 3. Agent Lookup by Template
**Problem:** `findCommunityAgent()` searched by name with `.includes("community")` — fragile.
**Solution:** Already resolved in previous session. Routes use `agentHub.findByTemplate("community-classifier", tenant_id)`. Confirmed `findByTemplate()` exists in agentHub.

### 4. Tests — Critical Path
**Problem:** Zero tests on the branch.
**Solution:** Created `store.test.ts` covering:

| Test Suite | Tests | Priority |
|---|---|---|
| `isLikelyUrgent` | fire/robbery/medical keywords → true, non-urgent → false | Critical |
| `ingestReport` | creates pending report, appends to both files, stores location/attachments | Critical |
| `urgency auto-trigger` | fires callback for urgent, does NOT fire for non-urgent | Critical |
| `markReportsClassified` | marks specific IDs, clears pending queue, sets classified_at | Critical |
| `buildDashboard` | zero state, counts pending, reads classification output | Critical |
| `getReports filters` | filters by status, respects limit | Nice-to-have |

Run: `pnpm test -- src/community/store.test.ts`

### 5. Auto-Classification for Urgent Reports
**Problem:** Reports with urgency keywords (fuego, robo, herido) waited for manual classify.
**Solution:** Already wired in previous session:
- `store.ts`: `isLikelyUrgent()` keyword detector + `setOnUrgentReport()` callback
- `routes.ts`: callback finds running community agent and fires classify
- Confirmed the full chain works: ingest → detect urgent → find agent → sendMessage → classify

### 6. Report Status Tracking (Closing the Loop)
**Problem:** Vecino sent report, got "Gracias", never knew what happened.
**Solution:**
- **Backend:** `GET /community/reports/:id/status` endpoint (already existed in routes.ts)
- **Frontend:** `ReportTracker` component polls status every 4s. Shows:
  - ⏳ "Reporte enviado" (pending) → ✅ "Reporte procesado" (classified)
  - When classified: shows category, urgency, routed_to, summary
  - "Enviar otro reporte" button to reset form
- **Backend fix:** `markReportsClassified()` now called automatically after successful classification in `agentRunner.ts` (dynamic import, best-effort)

## Files Changed This Session

| File | Action |
|---|---|
| `frontend/src/styles.css` | Major: CSS custom properties, dark theme, photo upload classes |
| `frontend/src/ResidentReport.tsx` | Rewritten: photo upload + report tracker |
| `frontend/src/CommunityDashboard.tsx` | Rewritten: CSS classes, filters |
| `frontend/src/api.ts` | Added: `getReportStatus()` + `ReportStatus` type |
| `backend/src/agents/agentRunner.ts` | Added: auto `markReportsClassified()` after classification |
| `backend/src/community/store.test.ts` | New: 12 tests covering critical path |

## Remaining Nice-to-Have

- [ ] Supertest integration tests for routes
- [ ] Frontend component tests (vitest + RTL)
- [ ] Photo upload backend (actual file storage)
- [ ] Maps de calor georreferenciados
- [ ] RAG ordenanzas municipales
