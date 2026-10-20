# DWO — instructions for Claude Code

- Never build or deploy unless Kevin says the exact phrase "okay to build".
- Before building, read the spec in docs/specs/ that Kevin names. Build only what it lists; anything else goes back to Kevin.
- Diagnose first: SQL, then code. One step at a time on destructive SQL.
- New features go in their own module file, not app-core.js.
- Never hard-delete code during a refactor: comment out with /* MOVED TO [file] — v[X.XX] — date */ and a matching origin note in the receiving file.
- Run node --check on every changed JS file. Bump APP_VERSION and cache busters on every build.
- Commit message format: "v[X.XX]: [summary]". Add a line to CHANGELOG.md for every build.
- Jadyn is male.

## Start here (how chat and code stay in sync)

Kevin designs and writes specs in a separate Claude chat. That chat cannot see this session and this session cannot see that chat. The repo is the only shared place, so:

- **Specs live in `docs/specs/`.** Before building, read the spec Kevin names. If the work is not covered by a spec in `docs/specs/`, say so and stop; do not build from memory of a conversation.
- **Handoff notes live in `docs/handoff-*.md`.** If a recent one exists, read it first.
- **Always `git fetch` first.** Work has been built from stale checkouts before, which caused version collisions. Check the top of `CHANGELOG.md` and `APP_VERSION` in `app-core.js` for the real current version.
- **After every build,** bump `APP_VERSION`, add the `CHANGELOG.md` entry, and put the version in the commit message (`v[X.XX]: ...`). The chat side reads the changelog to learn what shipped, so a build without a changelog line is invisible to it.
- **If a build deviates from its spec** (skipped, changed, or added something), say so in the changelog entry and tell Kevin, so the spec and the code do not drift.
- **Open problems found while building** that are outside the spec go to Kevin in the reply, not into code.
