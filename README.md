# agent-team

agent-team is a ten-role software development agent team: the project manager runs as the main session, dispatches work through a layered role hierarchy, sequencing is enforced by gates, and business acceptance runs as an independent track. A full run walks the stage chain from `S1` to `S8`.

**Status:** a ten-role team on an `S1`–`S8` stage chain, run end to end once on real infrastructure — measured under `--plugin-dir` only; the formally installed path is untested.

## Installation

Not published to any marketplace. The only load path this project has ever measured is `--plugin-dir`, so it is the only one documented here. Point it at your clone of this repository, and run it from the project directory you want the team to work in:

```sh
claude --plugin-dir /path/to/agent-team
```

**The plugin ships a `settings.json` whose `agent` key pins the main session to `at-pm`.** That is the design — the project manager *is* the main session — and it was confirmed under `--plugin-dir`: every line of the session transcript carried `"agentSetting":"agent-team:at-pm"`. What it means in practice is that the session you just started is no longer a general-purpose session, and it is not a narrow one either. Read Known Limitations before pointing one at a project you care about.

**Pass `--plugin-dir` on every resume as well — `claude --resume` does not inherit it.** Measured on CLI v2.1.276: resuming a `--plugin-dir` session without the flag makes the CLI print `Continuing with the default tools and system prompt — the agent's tool restrictions no longer apply.`, the plugin's `/agent-team:*` commands stop resolving, and the main session falls back to the default tool surface. Every isolation property this plugin has rides on the roles' `tools:` declarations, so one forgetful resume takes all of them off at once. Note that `/agent-team:at-resume` and `claude --resume` are not the same thing: the first is a plugin command that restores *run state*, the second is a CLI flag that restores the *session*.

**To stop, end the session; start the next one without `--plugin-dir`.** Do not reach for `claude plugin disable` — a session's tool surface is fixed for its lifetime, and disabling was measured *not* to hand it back. `claude plugin enable` has the mirror-image problem: it takes over sessions that are already running. This project has banned both for itself, and every measurement it has was taken with `--plugin-dir`.

**Deliberately undocumented, because it has not been measured:** a properly installed plugin (`claude plugin install`) rather than `--plugin-dir`, and everything that would follow from it — whether the takeover, the resume behaviour and the role tool surfaces come out the same way there. Measurements were also taken in background (`--bg`) sessions rather than an interactive terminal. Read everything below as a claim about `--plugin-dir`, not about the plugin in general.

## Known Limitations

> Write-path isolation is a hard constraint on `Edit`/`Write`/`NotebookEdit` — but only for roles that claim paths in `project.json`. The roles that claim none, `at-qa` and `at-acceptance`, skip that check entirely: outside the run directory it returns early and allows, so they can create files wherever they like. And no hook watches `Bash` at all: executor roles keep it to run builds and tests, and `Bash` can write files (`echo >`, `sed -i`). `at-qa` holds both halves. This plugin is not a sandbox.

> Loading this plugin hands the main session to `at-pm` — and `at-pm` is not a narrow role. Its tool surface is `Bash`, `Write`, `Edit`, `Read`, `Glob`, `AskUserQuestion` and the `Agent(...)` dispatch whitelist, so a taken-over session can do everything an ordinary session can do, in whatever project it happens to be pointed at. The takeover is not self-limiting: what keeps it inside the intended project is the role's prompt, not its tool surface. Under `--plugin-dir` the blast radius is at least bounded to the sessions you start with that flag. Enabling the plugin machine-wide is a different proposition — it would apply to **every new session on this machine, in every project**, for as long as it stayed enabled — and this project does not do that (see Installation).

## Development

Run the test suite with a bare `node --test` from the repository root, with no path arguments. On this machine, `node --test tests/` does **not** discover the files under `tests/` — it silently reports a phantom `pass 0 / fail 1` instead, identically whether the code under test is fixed or broken, which sends anyone debugging the "failure" chasing a bug that doesn't exist.

## License

MIT — see [LICENSE](./LICENSE).
