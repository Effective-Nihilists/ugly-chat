---
name: check-errors
description: Query recent error logs (requires dev or prod parameter)
user-invocable: true
---

# Checking Error Logs

**Required parameter: `dev` or `prod`**

If the user did not specify `dev` or `prod`, stop and ask which one before proceeding.

## Dev (your dev-tunnel sessions, filtered by devTunnelId)
```bash
npm run error:dev
```

## Prod (production deployed servers — requires `ugly-app login`)
```bash
npm run error:prod
```

## Tips
- `source: 'server'` = server-side error, `source: 'browser'` = client-side
- Check `stack` field for full stack trace
- `userId: null` means unauthenticated user

# Notes
<!-- Claude: append observations here -->
