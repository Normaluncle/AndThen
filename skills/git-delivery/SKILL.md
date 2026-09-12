---
name: git-delivery
description: Use when committing, branching, or preparing an AndThen delivery report. Covers the required commit identity, what must never be committed, migration immutability, and the evidence a delivery report must contain.
---

# Git delivery

## Commit identity

Use command-scoped identity. Never modify global git config.

```bash
git -c user.name='WorkBuddy Development Agent' \
    -c user.email='workbuddy@localhost' \
    commit -m "sources: register import and snapshot routes"
```

## Never commit

`.orchestrator/`, `.worktrees/`, `workbuddy-probe-results/`, `node_modules/`,
`dist/`, `coverage/`, `.env`, local data (`data/`, `*.sqlite`), and any private
evidence (`private/`, `evidence/`). These are in `.gitignore`; do not "fix" a
clean tree by force-adding them.

Real authorized participant material must never enter the repository. Demo data
is `provenance = 'test_fixture'`.

## History rules

- Do not edit an already-applied migration file; add a new one.
- Do not rewrite published history (`--amend` on pushed commits, force-push,
  `reset --hard` on shared branches) without explicit instruction.
- Do not delete or reset another worktree's branch or uncommitted work.

## Commit message shape

```
<module>: <imperative summary>

Why: <the constraint or requirement driving this>
Tests: <commands run and observed result>
Contract changes: <docs/contracts.md sections touched, or "none">
```

## Delivery report

A delivery is only complete when the report contains:

1. **Skills read** — list the `skills/*/SKILL.md` files you actually read.
2. **Files changed** — grouped by purpose.
3. **Evidence** — the exact commands run and their observed results. Never write
   "tests pass" without the run. If something failed or was skipped, say so.
4. **Contract impact** — any change to a frozen interface.
5. **Blockers** — what you could not do and why.
6. **Commit SHA.**

Do not claim a requirement is met because the code looks right. Report the
observed result, including negative or partial outcomes.
