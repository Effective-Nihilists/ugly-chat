---
name: check-perf
description: Query performance logs for slow operations (requires dev or prod parameter)
user-invocable: true
---

# Checking Performance Logs

**Required parameter: `dev` or `prod`**

If the user did not specify `dev` or `prod`, stop and ask which one before proceeding.

## Dev (your dev-tunnel sessions, filtered by devTunnelId)
```bash
npm run perf:dev
```

## Prod (production deployed servers — requires `ugly-app login`)
```bash
npm run perf:prod
```

# Notes
<!-- Claude: append observations here -->
