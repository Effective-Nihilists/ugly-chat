---
name: fix-errors
description: Fetch errors and fix them (requires dev or prod parameter)
user-invocable: true
---

Fetch errors and fix them.

**Required parameter: `dev` or `prod`**

If the user did not specify `dev` or `prod`, stop and ask which one before proceeding.

## Dev (your dev-tunnel sessions, filtered by devTunnelId)
Run: `npm run error:dev`

## Prod (production deployed servers — requires `ugly-app login`)
Run: `npm run error:prod`

For each error:
1. Find the relevant source file
2. Understand the root cause
3. Fix the code
4. Run `npm run build` to verify the fix compiles
