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

## Preflight: permissions and connections before any long session (Kevin, 2026-11-08)

Kevin often works on something else while a build runs. A permission prompt that nobody sees stops the whole session for 20 minutes or more. So:

1. **Before the first edit, list everything the session will need**, step by step, from the spec: repo access (push to which branch), database access (read, write, migrations), edge function deploys, Netlify or other deploys, Claude Docs and Todoist writes, anything that needs Kevin to sign in (browser checks), folders on his computer, tools that must be loaded first, and any key or secret.
2. **Trigger every one of them up front, in one batch,** with a harmless first use (load the tool, a read query, a test push to a scratch branch, a dry run). Then tell Kevin in one message how many approvals are waiting and what each is for, and wait for him once, at the start.
3. **List anything that can only be approved at the moment it happens** (for example a first production write) with the step it comes at, so Kevin knows when he is needed. Ask whether he will be away.
4. **Order the work so unblocked steps run first** and approval-needing steps are grouped together.
5. **If you are blocked anyway,** say so immediately in the reply (and send a push notification if that tool is available), keep working on anything that is not blocked, and never wait silently.
6. The preflight is **not** permission to build. Kevin must still say the exact phrase "okay to build".

## Rollback and backups: know the way back before any change (Kevin, 2026-11-11)

1. **Every spec has a short "Rollback" section:** what undoes the change and what that costs. If there is no clean undo, the spec says so and Kevin must approve that explicitly.
2. **Database changes that alter or delete policies, tables or data:**
   - Confirm with Kevin that the latest Supabase daily backup exists (Claude cannot see or take backups). Daily backups are the only safety net: point-in-time recovery is not purchased, so a restore loses everything entered since that backup.
   - Export the current policies, and copy affected tables into the `backup_` schema right before the change (for example `backup.hours_entries_YYYYMMDD`).
   - Write and syntax-check the rollback file **before** running the change. Run multi-step changes in one transaction.
   - For a large change (for example slice 3 enforcement), also have Kevin make a full dump file first, and lead him through it step by step during the preflight.
3. **App changes:** record the previous version number in the CHANGELOG.md entry so it can be redeployed as-is.

## New modules and users: never leave permissions behind (Kevin, 2026-11-11)

Every new module or feature screen must be registered in the permissions system **in the same build**:
1. A `modules` row, and a permission row for **every** template (new modules default to `none` for Field Tech unless the spec says otherwise). Put this sentence at the top of the migration file.
2. Enforcement policies for its tables (slice 3 pattern) and a nav entry that follows the module's access level.
3. The new module appears in the Permissions grid in Settings.

Every build's QC includes: sign in as Test User and Test Admin and confirm the new module shows or hides correctly; confirm Add user still works (create a throwaway user, log in, deactivate); confirm the new module appears in the Permissions grid.
