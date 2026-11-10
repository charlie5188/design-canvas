# Tests

- `smoke-local.sh` runs the smoke job's steps on your machine in about a minute: install the canvas, update an older one, typecheck, build, and load it in a browser (`fixture-app/smoke.spec.ts`). On a clean, pushed commit it also marks the commit `local-smoke` on GitHub, which is the check `main` requires, so the pull request can merge without waiting for GitHub's runner.

  ```sh
  git push
  test/smoke-local.sh              # runs everything, then marks the pushed commit
  test/smoke-local.sh --no-status  # runs everything and marks nothing
  ```

  The mark comes from your own machine (it needs `gh` signed in). GitHub's `smoke` job still runs on every pull request and shows its result, but it no longer blocks the merge, so look at it when it fails: it runs on a clean macOS machine, and a failure there that did not show here usually means a timing problem.
- `codex-listener.test.mjs` tests the Codex listener script.
- `skills/design-canvas/shell/TESTING.md` lists the interactive checks that stay manual.
