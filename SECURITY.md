# Security policy

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/michaelcrosato/robot-warrior/security/advisories/new)
rather than opening a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it.
You will get an acknowledgement within a week. This is a personal project maintained in
spare time, so please be realistic about timelines — but a real issue will be taken
seriously.

## Scope

The game is a static site with no backend, no accounts and no server-side state. It ships
**no runtime dependencies** (see
[ADR 0005](docs/adr/0005-no-runtime-dependencies.md)), so the shipped bundle is entirely
first-party code. That rules out most of the usual categories.

What remains genuinely worth reporting:

**The co-op networking layer** (`src/net/`) is the real attack surface. Four browsers
exchange simulation state over WebRTC data channels, and the host is authoritative. Of
interest:

- A message from a peer that can crash another player's client, hang it, or make it
  allocate without bound.
- A way for a joining pilot to affect state the host should own.
- A way to make a client execute or inject anything from message content.
- Room codes or signalling behaviour that lets someone join or disrupt a session they
  were not invited to.

**Stored settings.** `localStorage` holds display and audio preferences and the chosen
chassis. Anything that turns that into code execution is in scope.

**The build and CI.** A way to get arbitrary code into the published site through the
build, a workflow, or a dependency update.

## Out of scope

- Missing mission music. The soundtrack is deliberately not distributed — see
  [docs/assets.md](docs/assets.md).
- Reading or modifying your own local game state. It is a single-player game in your own
  browser; there is nothing to protect it from.
- Cheating in co-op against people you invited. The protocol trusts the host and assumes
  a friendly lobby. It is not designed to be a competitive anti-cheat boundary, and
  reports that it can be manipulated by a participant are not vulnerabilities. A way to
  affect a session you were **not** invited to is.
- Denial of service against a peer you are already in a session with, by simply
  disconnecting or flooding. Crashing their client with a malformed message is in scope;
  leaving the game is not.
- Results from automated scanners with no demonstrated impact.

## Third-party audio

If you find copyrighted audio committed to this repository, please report it — that is a
licensing failure and it is treated as urgent. `assets/audio/music/` and the original
`RobotWarrior.html` are gitignored and a CI job asserts they stay untracked, but a report
is welcome regardless. See
[ADR 0003](docs/adr/0003-keep-the-soundtrack-out-of-the-repo.md).
