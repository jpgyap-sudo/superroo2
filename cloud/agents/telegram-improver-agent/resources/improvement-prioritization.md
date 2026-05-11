# Improvement Prioritization Framework

## Priority Matrix

| Priority | Criteria | Action |
|----------|----------|--------|
| **Critical (P0)** | Bot crashes, data loss, auth broken, security issue | Fix immediately, alert user |
| **High (P1)** | Core feature broken, users blocked, wrong answers | Fix within 24 hours |
| **Medium (P2)** | Feature degraded, poor UX, missing non-critical feature | Fix within weekly cycle |
| **Low (P3)** | Cosmetic, nice-to-have, edge cases | Fix when time permits |

## Scoring Formula

```
Priority Score = (Frequency × 3) + (Severity × 2) + (User Impact × 2) + (Ease of Fix × 1)
```

### Frequency (1-5)
- 1: Happened once
- 2: Happened 2-3 times
- 3: Happens daily
- 4: Happens multiple times per day
- 5: Happens every conversation

### Severity (1-5)
- 1: Minor inconvenience
- 2: User has to rephrase
- 3: User can't complete task
- 4: Bot gives wrong information
- 5: Bot crashes or errors out

### User Impact (1-5)
- 1: Affects 1 user
- 2: Affects 2-5 users
- 3: Affects 5-20 users
- 4: Affects 20-100 users
- 5: Affects all users

### Ease of Fix (1-5)
- 1: Requires code change + deploy
- 2: Requires code change only
- 3: Requires new skill/workflow file
- 4: Requires updating existing file
- 5: Trivial fix (typo, config change)

## Thresholds
- Score ≥ 30: Critical — fix immediately
- Score 20-29: High — fix this cycle
- Score 10-19: Medium — schedule for next cycle
- Score < 10: Low — backlog
