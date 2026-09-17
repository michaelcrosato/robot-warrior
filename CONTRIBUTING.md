# Contributing

Contributions are welcome. This repository is developed almost entirely by coding
agents, which mostly changes two things: the verification gate is expected to do the
work a reviewer would otherwise do, and the reasoning behind decisions is written down
rather than held in someone's head.

If you are an agent, read **[AGENTS.md](AGENTS.md)** — it is the operating guide and it
supersedes anything here that conflicts.

## Getting set up

```bash
git clone https://github.com/michaelcrosato/robot-warrior.git
cd robot-warrior
pnpm install
pnpm exec playwright install chromium    # once; the e2e suite drives a real browser
pnpm dev                                 # http://127.0.0.1:5180
```

Node 22 or newer.

**There will be no mission music, and that is correct.** The three soundtrack tracks are
copyrighted commercial recordings and are not distributed with this source. Everything
else — weapons, warnings, radio speech — works. See [docs/assets.md](docs/assets.md) if
you want to supply your own.

## Before you open a pull request

```bash
pnpm verify
```

That runs, in the same order CI does: asset check, formatting, lint, typecheck, unit
tests, production build, end-to-end suite. It takes about a minute. Please read its
output rather than assuming it passed — and paste the relevant part into the PR.

## Understanding the code first

Two documents, and they will save you time:

- **[docs/architecture.md](docs/architecture.md)** — the layer map, how shared state
  works, and a frank list of the rough edges.
- **[docs/adr/](docs/adr/README.md)** — why things are as they are. If a design choice
  looks wrong, check whether there is a record explaining what it cost to get there.

## Three things that will trip you up

Each of these has already caused a real failure here, so they are worth stating plainly.

**Shared mutable state lives on exported objects** — `G`, `camera`, `pass`, `pools`,
`structures`. ES modules forbid assigning to an imported binding, and this state has
writers in several modules, so plain exported `let`s will not compile.
[ADR 0002](docs/adr/0002-shared-state-as-namespace-objects.md) has the reasoning.

**Never shadow one of those names with a local.** It shadows the import silently. A
namespace object named `view` once captured a local of the same name and crashed the
first rendered frame.

**Never regenerate `tests/e2e/__baseline__/original.json` to make a test pass.** It is a
recording of how the original single-file build behaved, and it is the only evidence
that the refactor preserved anything. If parity fails, treat the change as wrong until
you have shown otherwise.

## Tests

Put logic in a pure function and unit test it where you reasonably can —
`tests/unit/` runs in Node and is fast. Anything that owns WebGL, canvas, audio or
socket state belongs in `tests/e2e/`, which drives the real built game through the
`window.RobotWarrior` status API.

If a test encodes behaviour that is imperfect rather than intended, say so in a comment.
There are two examples in `tests/unit/geometry.test.js`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`refactor:`, `test:`, `docs:`, `chore:`, `perf:`, `build:`, `ci:`, with `!` for a
breaking change.

Write the body for someone reading it in a year with no context: what changed, why this
approach, what it cost, what you verified. If something surprised you, put it in the
message — it is the cheapest place to leave it, and it is usually the most valuable part.

## Reporting bugs

Please include the output of `window.RobotWarrior.getStatus()` from the browser console.
It reports actual simulation state — mission stage, objectives, pilot telemetry, every
live entity — and is far more useful than a screenshot.

For anything that looks like a security issue, see [SECURITY.md](SECURITY.md) and report
it privately rather than opening an issue.

## Licence

Contributions are accepted under the [MIT Licence](LICENSE). Do not contribute audio,
art or code you do not have the right to license that way — the reason this repository
ships no soundtrack is precisely that.
