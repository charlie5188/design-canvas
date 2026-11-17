# Tests

- `smoke-local.sh` runs the smoke job's steps on your machine in about a minute: install the canvas, update an older one, typecheck, build, and load it in a browser (`fixture-app/smoke.spec.ts`). Use it to find a failure before you push.

  ```sh
  test/smoke-local.sh
  ```

  `main` requires GitHub's `smoke` job, not this script. That job runs on every pull request on a clean, slower macOS machine, and it has caught timing problems that passed here. A pull request that changes only docs or the license passes it at once.

  The browser tests share one `registry.tsx` and one dev server, so they run one at a time. After each test, a step closes its pages, waits until the dev server has made every registry write they sent, and puts the registry back as installed if the test left it changed. It prints which test did, so a test that forgets to restore the registry still shows.
- `codex-listener.test.mjs` tests the Codex listener script.
- `skills/design-canvas/shell/TESTING.md` lists the interactive checks that stay manual.
