# Contributing

Contributions are welcome. This repository is developed almost entirely by coding
agents, which mostly changes two things: the verification gate is expected to do the
work a reviewer would otherwise do, and the reasoning behind decisions is written down
rather than held in someone's head.

If you are an agent, read **[AGENTS.md](AGENTS.md)** — it is the operating guide and it
supersedes anything here that conflicts.

## Getting set up

[AGENTS.md](AGENTS.md) is the shared guide to setup, scripts, code conventions, tests and
commits. [docs/deployment.md](docs/deployment.md#local-builds-and-browser-checks) covers
running and inspecting the game; [docs/assets.md](docs/assets.md) explains the optional
local soundtrack.

## Before you open a pull request

```bash
pnpm verify
```

Read its output and paste the relevant part into the PR. Keep the recorded behavioural
baseline unchanged; a failing parity check needs an explanation or a code fix.

## Understanding the code first

Two documents, and they will save you time:

- **[docs/architecture.md](docs/architecture.md)** — the layer map, how shared state
  works, and a frank list of the rough edges.
- **[docs/adr/](docs/adr/README.md)** — why things are as they are. If a design choice
  looks wrong, check whether there is a record explaining what it cost to get there.

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
