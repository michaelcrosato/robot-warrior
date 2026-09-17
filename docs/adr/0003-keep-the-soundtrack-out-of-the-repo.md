# 0003 — Keep the soundtrack out of the repository

**Status** Accepted · 2026-09-16

## Context

The original build carried three MP3s embedded as base64, about 8.6 MB. Their ID3 tags
identify them as tracks from the _MechWarrior 2_ soundtrack:

| Cue     | Track                 | Credited to                        |
| ------- | --------------------- | ---------------------------------- |
| `boot`  | 3-01 "Reactor Online" | Carole Ruggier, 1996               |
| `basin` | 1-02 Umber Wall       | Gregory Alper & Jeehun Hwang, 1995 |
| `works` | 1-03 Silent Thunder   | Gregory Alper & Jeehun Hwang, 1995 |

These are commercial recordings under someone else's copyright. This repository is
public. The 40 voice lines in the same build carry no third-party attribution and were
generated for this game.

Git history is permanent once pushed. Committing the tracks and removing them in a later
commit would not help: they would remain in history, and a rewrite after publication
cannot recall clones.

## Decision

`assets/audio/music/` is gitignored, and was gitignored **before the first commit** —
not cleaned up afterwards. The original `RobotWarrior.html` is gitignored for the same
reason, since it carries the same recordings inline.

The 40 voice clips are committed.

The game treats a missing track as expected: it logs once at `console.info` and plays on
in silence. `pnpm run assets:check` reports absent tracks without failing, so CI is
green on a fresh clone, while a missing _voice_ clip does fail.

## Consequences

- A fresh clone has no mission music. Every other sound works. Verified: with
  `assets/audio/music/` removed entirely, the game boots, renders and produces the
  identical entity roster with no console errors.
- [docs/assets.md](../assets.md) documents dropping in your own three files.
- `pnpm run build:single` on a machine that has the tracks present produces a bundle with
  them embedded. That bundle is for personal offline use and must not be redistributed;
  the script says so when it happens.
- The repository carries ~1 MB of audio instead of ~10 MB, a real secondary benefit for
  clone times.
