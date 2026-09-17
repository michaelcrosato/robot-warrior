# Architecture decision records

Short notes on decisions that are not obvious from the code, written so that whoever
touches this next — person or agent — does not have to re-derive the reasoning or
reverse a choice by accident.

One file per decision. Never edited once accepted: a decision that no longer holds gets
a new record that supersedes it.

| #                                                     | Decision                                             | Status   |
| ----------------------------------------------------- | ---------------------------------------------------- | -------- |
| [0001](0001-unpack-the-single-file-build.md)          | Unpack the single-file build into ES modules         | Accepted |
| [0002](0002-shared-state-as-namespace-objects.md)     | Hold cross-module mutable state in namespace objects | Accepted |
| [0003](0003-keep-the-soundtrack-out-of-the-repo.md)   | Keep the soundtrack out of the repository            | Accepted |
| [0004](0004-verify-against-a-behavioural-baseline.md) | Verify refactors against a behavioural baseline      | Accepted |
| [0005](0005-no-runtime-dependencies.md)               | Ship no runtime dependencies                         | Accepted |
