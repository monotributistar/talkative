# Plan de Acción: Fixes para Merge PR #35

> Fecha: 2026-03-07
> Objetivo: Resolver todos los bloqueantes y mergear a main

---

## Sesión 1: Fix P0 + Cleanup → Merge

### Paso 1: Fix Tenant Spoofing (P0)

**Problema**: `requireOperator` valida password pero no vincula al tenant. El tenant viene del header `x-tenant-id` que el usuario controla.

**Fix (single-tenant MVP)**:

En `backend/src/community/auth.ts`, modificar `requireOperator`:

```typescript
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  // ... validar password como antes ...

  // Fix P0: vincular operador al tenant configurado, NO leer del header
  const tenantId = process.env.COMMUNITY_TENANT_ID?.trim() || "tenant-default";
  req.community_tenant_id = tenantId;

  // Override context para que getTenantIdOrThrow use este valor
  if (!req.context) req.context = {} as any;
  req.context.tenant_id = tenantId;

  next();
}
```

**Archivos a modificar**:
- `backend/src/community/auth.ts` — requireOperator setea tenant
- Verificar que `statsRoutes.ts` y `routesV2.ts` respeten el tenant del middleware

**Verificación**:
```bash
# Intentar spoofear tenant — debería ignorar el header
curl -H "x-operator-token: <password>" -H "x-tenant-id: tenant-malicioso" \
  http://localhost:4000/community/stats/summary
# Debe devolver datos de tenant-default, NO de tenant-malicioso
```

### Paso 2: Eliminar código muerto

**Archivos a eliminar**:
```bash
git rm backend/src/community/routes.ts
git rm backend/src/community/store.ts
git rm backend/src/community/store.test.ts
git rm backend/src/community/SESSION2-CHANGES.md
git rm backend/src/community/SESSION3-CHANGES.md
git rm backend/src/community/SESSION4-CHANGES.md
git rm backend/src/community/SESSION5-CONSOLIDATION.md
```

**Verificar** que ningún import apunte a estos archivos:
```bash
grep -r "from.*routes\.js" backend/src/ --include="*.ts" | grep -v routesV2 | grep -v statsRoutes
grep -r "from.*\/store\.js" backend/src/community/ --include="*.ts" | grep -v storeSqlite | grep -v store.test
```

### Paso 3: Verificar CI local

```bash
cd C:\Users\Stephano\Desktop\SANDBOX\talkative
npm run lint --workspace backend
npm run lint --workspace frontend
npm run typecheck --workspace backend
npm run typecheck --workspace frontend
npm test --workspace backend
```

### Paso 4: Commit + Push + Verificar CI

```bash
git add -A
git commit -m "fix(security): bind operator to configured tenant, remove dead code

- requireOperator now sets tenant_id from COMMUNITY_TENANT_ID env var
- Operator endpoints no longer read tenant from x-tenant-id header
- Remove dead files: routes.ts (v1), store.ts (filesystem), session docs
- Resolves P0 tenant spoofing finding from PR review"
git push origin feat/community-security
```

### Paso 5: Pedir re-review a Javier

Una vez CI verde, comentar en el PR:
> "Fixed P0 tenant spoofing: operator endpoints now derive tenant from COMMUNITY_TENANT_ID, not from header. Also cleaned up dead code (routes v1, filesystem store, session docs). Ready for re-review."

---

## Post-merge: Próximas sesiones

### Sesión 2: Deploy
1. Crear `.env.example`
2. Setup Railway (o alternativa)
3. Configurar env vars en producción
4. Verificar flujo completo en URL pública

### Sesión 3: Auto-classify + Telegram
1. Auto-clasificación en `POST /community/reports` (trigger inmediato)
2. Bot Telegram con `node-telegram-bot-api`
3. Enviar alerta cuando urgencia >= 4
4. Testear flujo completo: reporte → clasificación → alerta

### Sesión 4: Polish para demo
1. Empty states en todos los componentes
2. Login gate en StatsDashboard (como tiene CommunityDashboard)
3. Mobile testing
4. Doc de setup para barrios nuevos

---

## Checklist pre-merge

- [ ] P0 tenant spoofing fixeado
- [ ] Código muerto eliminado
- [ ] Lint pasa (backend + frontend)
- [ ] Typecheck pasa (backend + frontend)
- [ ] Tests pasan (92/92)
- [ ] CI verde en GitHub
- [ ] Re-review de Javier aprobado
