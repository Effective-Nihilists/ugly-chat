---
name: check-feedback
description: Query user feedback logs (requires dev or prod parameter)
user-invocable: true
---

# Checking Feedback Logs

**Required parameter: `dev` or `prod`**

If the user did not specify `dev` or `prod`, stop and ask which one before proceeding.

## Dev (your dev-tunnel sessions, filtered by devTunnelId)
```bash
npm run feedback:dev
```

## Prod (production deployed servers — requires `ugly-app login`)
```bash
npm run feedback:prod
```

## Types: `bug`, `design`, `feature`
## Screenshots available at `screenshotUrl` field

# Notes
<!-- Claude: append observations here -->
