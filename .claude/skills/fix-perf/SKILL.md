---
name: fix-perf
description: Fetch performance issues and optimize slow paths (requires dev or prod parameter)
user-invocable: true
---

Fetch performance issues and optimize slow paths.

**Required parameter: `dev` or `prod`**

If the user did not specify `dev` or `prod`, stop and ask which one before proceeding.

## Dev (your dev-tunnel sessions, filtered by devTunnelId)
Run: `npm run perf:dev`

## Prod (production deployed servers — requires `ugly-app login`)
Run: `npm run perf:prod`

For each slow path:
1. Find the source of the slowdown
2. Optimize the code (avoid blocking operations, add caching, etc.)
3. Run `npm run build` to verify
