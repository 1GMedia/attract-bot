# Korgo Bot QA Report

- Date: 2026-08-20
- Target: Korgo Bot desktop development build (`http://127.0.0.1:5174` in Electron)
- Scope: Orgo computer fullscreen keyboard isolation
- Mode: Standard, focused regression
- Framework: Electron + React + noVNC
- Baseline health score: 97/100

## Summary

| Severity | Found | Fixed | Deferred |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 1 | 1 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 0 | 0 |

## ISSUE-001: Fullscreen Orgo typing is stolen by the chat composer

- Severity: High
- Category: Functional
- Fix Status: Verified
- Fix Commit: `744885d`
- Regression Test Commit: `cb0bae3`
- Files Changed:
  - `apps/desktop/src/app/right-sidebar/desktop/index.tsx`
  - `apps/desktop/src/app/right-sidebar/desktop/fullscreen-keyboard.regression-1.test.tsx`
- Before: [issue-001-before.png](screenshots/issue-001-before.png)
- After: [issue-001-after.png](screenshots/issue-001-after.png)

### Reproduction

1. Open the configured Orgo computer pane.
2. Expand the computer to the full-window view.
3. Click inside the remote Chrome window.
4. Type `QAFOCUS`.

### Actual result

The remote Chrome window does not receive the text. Korgo's underlying message composer receives `QAFOSCU` and gains focus, even though the user clicked the remote computer.

### Expected result

While the computer is expanded, keyboard input belongs to the noVNC remote computer until the user exits fullscreen or explicitly uses overlay chrome.

## Console Health

No renderer crash or visible console error accompanied the failure. The defect is incorrect focus routing.

## Top Things to Fix

1. Mark the portaled fullscreen computer as a key-owning overlay so global chat type-to-focus and paste-to-focus handlers yield to noVNC.
2. Add a regression test proving fullscreen supplies the overlay ownership marker.
3. Re-run the live click-and-type path and confirm the chat composer remains unchanged.

## Final QA

- Final health score: 100/100
- Health score delta: 97 → 100
- Live proof: `QAFOCUSOK` appeared in the remote Chrome address bar; the active DOM element remained the noVNC canvas; Korgo's chat draft remained empty.
- Automated proof: 2 focused test files passed, 9 tests total; desktop TypeScript checks passed.
- Deferred issues: 0

PR summary: QA found 1 issue, fixed 1, health score 97 → 100.
