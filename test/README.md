# Tests

- `smoke-local.sh` runs the smoke job's steps on your machine in about a minute: install the canvas, update an older one, typecheck, build, and load it in a browser (`fixture-app/smoke.spec.ts`). Use it to find a failure before you push.

  ```sh
  test/smoke-local.sh
  ```

  `main` requires GitHub's `smoke` job, not this script. That job runs on every pull request on a clean, slower macOS machine, and it has caught timing problems that passed here. A pull request that changes only docs or the license passes it at once.
- `codex-listener.test.mjs` tests the Codex listener script.
- `skills/design-canvas/shell/TESTING.md` lists the interactive checks that stay manual.
