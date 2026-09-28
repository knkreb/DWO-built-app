# DWO — instructions for Claude Code

- Never build or deploy unless Kevin says the exact phrase "okay to build".
- Before building, read the spec in docs/specs/ that Kevin names. Build only what it lists; anything else goes back to Kevin.
- Diagnose first: SQL, then code. One step at a time on destructive SQL.
- New features go in their own module file, not app-core.js.
- Never hard-delete code during a refactor: comment out with /* MOVED TO [file] — v[X.XX] — date */ and a matching origin note in the receiving file.
- Run node --check on every changed JS file. Bump APP_VERSION and cache busters on every build.
- Commit message format: "v[X.XX]: [summary]". Add a line to CHANGELOG.md for every build.
- Jadyn is male.
