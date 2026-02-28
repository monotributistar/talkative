# Session 4 — Production Wiring + MVP Features

## Summary

Wired all Session 3 backend modules into the running server and updated
frontend to use the new auth + photo upload + SQLite-backed APIs.
Added PWA support, operator login gate, heatmap component, and weekly
summary integration.

## Changes

### Backend

| File | Change |
|---|---|
| `src/app.ts` | Switched import from `routes.ts` → `routesV2.ts`. Moved communityRouter BEFORE global auth middleware so community endpoints use their own auth. |
| `.env.example` | Updated with COMMUNITY_CODE, OPERATOR_PASSWORD, COMMUNITY_DB_PATH, GEMINI_API_KEY |

**No new backend files this session** — all backend code (db.ts, storeSqlite.ts,
photoStorage.ts, auth.ts, routesV2.ts) was already created in Session 3.
This session WIRED them into the live server.

### Frontend

| File | Change |
|---|---|
| `src/api.ts` | Added `communityFetch()` helper with auto auth headers. Migrated all community endpoints to use it. Added `validateCommunityCode()`, `uploadReportPhotos()`, `getWeeklySummaries()`, `generateWeeklySummary()`. Removed old `operatorHeaders()` / `getOperatorToken()`. |
| `src/CommunityDashboard.tsx` | Added OperatorLoginGate component (password gate before dashboard). Added HeatmapPreview component (zones calientes by address). Added weekly summary generation button. Added logout button. |
| `src/resident/ResidentApp.tsx` | Added CodeGate component (community code entry). Flow: gate → form → tracker. Auto-skips gate if code in localStorage. |
| `src/resident/ReportForm.tsx` | Removed `communityCode` prop (now auto from localStorage via communityFetch). Photos now upload as actual File objects to `/reports/:id/photos` endpoint after report creation. |
| `src/resident/resident.css` | Added `.gate-*` styles for code entry screen. |
| `resident.html` | Cleaned up duplicate tags. Added manifest + SW registration. |

### PWA

| File | Description |
|---|---|
| `public/manifest.json` | PWA manifest: "Seguridad Cariló", standalone mode, green theme |
| `public/sw.js` | Service worker: cache static assets, network-first for API |
| `public/icons/icon-192.svg` | Placeholder SVG icon 192x192 |
| `public/icons/icon-512.svg` | Placeholder SVG icon 512x512 |

## Dependencies needed

```bash
cd backend
pnpm add better-sqlite3 multer
pnpm add -D @types/better-sqlite3 @types/multer
```

## Feature status

| Feature | Status | Notes |
|---|---|---|
| Auth — community code | ✅ Wired | Vecino enters code → validated → stored in localStorage |
| Auth — operator password | ✅ Wired | Dashboard shows login gate, token in localStorage |
| SQLite store | ✅ Wired | routesV2 imports storeSqlite, server uses routesV2 |
| Photo upload | ✅ Wired | ReportForm → uploadReportPhotos → multer → disk + SQLite |
| Notifications | 🟡 Placeholder | Table in SQLite, queueNotification() exists, no dispatcher |
| Weekly summary | ✅ Wired | generateWeeklySummary() + endpoint + dashboard button |
| Heatmap | ✅ Visual | HeatmapPreview component in dashboard, address-based bars |
| PWA | ✅ Ready | manifest + service worker + icons, installable on mobile |
| Multi-tenant | 🟡 Prepared | tenant_id field in all tables, default "tenant-default" |
| RAG ordenanzas | ⏳ Future | Needs ordered data ingestion |
| LLM classifier | ⏳ Config | Needs GEMINI_API_KEY in .env |

## PENDING — Deploy

- [ ] `pnpm add better-sqlite3 multer` + dev types
- [ ] Set GEMINI_API_KEY in .env
- [ ] Deploy backend to VPS/Railway/Fly.io
- [ ] Deploy resident frontend to Vercel/Netlify
- [ ] HTTPS required for PWA + service worker
- [ ] Generate real PNG icons (192x192, 512x512)
- [ ] Set production COMMUNITY_CODE and OPERATOR_PASSWORD
- [ ] Domain: seguridad.carilo.ar or similar

## Auth flow

### Vecino (resident app)
1. Opens `resident.html` → sees CodeGate
2. Enters community code → POST `/community/auth/validate-code`
3. Code saved to localStorage → form appears
4. All subsequent requests include `x-community-code` header automatically

### Operador (admin dashboard)
1. Opens admin → clicks Dashboard tab → sees OperatorLoginGate
2. Enters password → POST `/community/auth/login`
3. Token saved to localStorage → dashboard loads
4. All subsequent requests include `x-operator-token` header automatically
5. 401 response → auto logout → re-show login gate
