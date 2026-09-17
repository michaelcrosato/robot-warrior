# CLAUDE.md

The instructions for working in this repository are in **[AGENTS.md](AGENTS.md)** —
one file, shared by every agent that works here, so guidance cannot drift between tools.

Read it before changing code. The short version:

- `pnpm verify` is the gate. Run it and read the output before claiming anything works.
- Shared mutable state lives on exported objects (`G`, `camera`, `pass`, `pools`,
  `structures`). Never shadow those names with a local.
- Never regenerate `tests/e2e/__baseline__/original.json` to make a test pass.
- Never commit `assets/audio/music/` or `RobotWarrior.html` — third-party audio.

Background on why the code looks the way it does: [docs/architecture.md](docs/architecture.md)
and [docs/adr/](docs/adr/README.md).
