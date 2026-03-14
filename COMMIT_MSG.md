# COMMIT MESSAGE — Community Security MVP

## feat(community): complete MVP stack — auth, SQLite, photos, PWA, heatmap

### Full-stack community reporting system for residential security.

**Backend — Node/Express/SQLite:**
- Auth MVP: community code for residents, password for operators
- SQLite database with WAL mode (better-sqlite3) — 5 tables
- Photo upload with multer (disk storage + SQLite metadata)
- LLM classifier skill using Gemini free tier (batched classification)
- Auto-classification trigger for urgent reports (keyword detection)
- Weekly summary generation + endpoint
- Notification queue (placeholder — table ready, no dispatcher yet)
- All routes behind appropriate auth middleware

**Frontend — React/Vite (two separate apps):**
- Admin app (index.html): Mission Control, Workflow, Router, Dashboard
- Resident app (resident.html): CodeGate → Report Form → Status Tracker
- Community Dashboard: login gate, metrics, heatmap, filters, classify button
- Dark mode: CSS custom properties, auto night mode for residents
- Vite multi-page build configuration

**PWA:**
- Web app manifest (standalone, portrait, themed)
- Service worker (static cache + network-first API)
- SVG placeholder icons (192, 512)

**PENDING — Deploy (blocks first paid customer):**
- [ ] `cd backend && pnpm install` (better-sqlite3 + multer)
- [ ] Deploy backend to VPS/Railway/Fly.io
- [ ] Deploy frontend to Vercel/Netlify
- [ ] HTTPS (required for PWA + service worker)
- [ ] Set production credentials
- [ ] Real PNG icons
- [ ] Telegram webhook for urgent notifications
- [ ] Domain configuration

### New files:
```
backend/src/community/
  auth.ts, db.ts, storeSqlite.ts, photoStorage.ts, routesV2.ts
  SESSION2-CHANGES.md, SESSION3-CHANGES.md, SESSION4-CHANGES.md, SESSION5-CONSOLIDATION.md

frontend/
  resident.html
  src/resident/main.tsx, ResidentApp.tsx, ReportForm.tsx, ReportTracker.tsx, resident.css
  src/CommunityDashboard.tsx
  public/manifest.json, sw.js, icons/

skills/templates/community-classifier/
  SKILL.md, scripts/classifyReports.ts, references/categories.json
```

### Modified files:
```
backend/package.json     — Added better-sqlite3, multer + types
backend/src/app.ts       — Wired communityRouter before global auth
backend/.env.example     — Community module variables
frontend/vite.config.ts  — Multi-page build
frontend/src/App.tsx     — Removed resident tabs from admin
frontend/src/api.ts      — Community API functions + auth helpers
.gitignore               — Added backend/data/, data/, workspace/
```
