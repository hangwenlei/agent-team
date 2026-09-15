# agent-team

agent-team is a ten-role software development agent team: the project manager runs as the main session, dispatches work through a layered role hierarchy, sequencing is enforced by gates, and business acceptance runs as an independent track.

**Status:** M0 — foundation validation, not yet usable.

## Installation

Not yet published to a marketplace. Installation instructions will be added once the plugin is usable (post-M0).

## Known Limitations

> Write-path isolation is a hard constraint for `Edit`/`Write`, but only a soft constraint for `Bash`. Executor roles keep Bash available to run builds and tests, and Bash can write files (`echo >`, `sed -i`). This plugin is not a sandbox.

> Enabling this plugin sets the `agent` key in `settings.json`, which takes over **every new session on this machine**, in every project, for as long as the plugin stays enabled — not just sessions in this repository. Each new session becomes `at-pm`, whose tool surface is only `Agent(...)`, `Read`, and `Glob`, so it cannot do normal work in an unrelated project. Disable the plugin as soon as you're done experimenting: `claude plugin disable agent-team@skills-dir` (the bare `agent-team`, without `@skills-dir`, fails with `not found in any editable settings scope`).

## Development

Run the test suite with a bare `node --test` from the repository root, with no path arguments. On this machine, `node --test tests/` does **not** discover the files under `tests/` — it silently reports a phantom `pass 0 / fail 1` instead, identically whether the code under test is fixed or broken, which sends anyone debugging the "failure" chasing a bug that doesn't exist.

## License

MIT — see [LICENSE](./LICENSE).
