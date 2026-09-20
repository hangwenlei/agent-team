# agent-team

agent-team is a ten-role software development agent team: the project manager runs as the main session, dispatches work through a layered role hierarchy, sequencing is enforced by gates, and business acceptance runs as an independent track. A full run walks the stage chain from `S1` to `S8`.

**Status:** a ten-role team on an `S1`–`S8` stage chain, run end to end once on real infrastructure — that one full run was measured under `--plugin-dir` only. The formally installed path has since been measured separately, on its own: loading, the `at-pm` takeover, command and role resolution, every dispatchable role's tool surface, all six gates, resume and uninstall all came out the same way there.

## Installation

Not published to any marketplace. Two load paths have been measured, and they behave the same. The simpler one is `--plugin-dir`: point it at your clone of this repository, and run it from the project directory you want the team to work in:

```sh
claude --plugin-dir /path/to/agent-team
```

**The other measured path is a local-scope install.** Run from the project directory, `claude plugin marketplace add /path/to/agent-team --scope local` and then `claude plugin install agent-team@agent-team-marketplace --scope local` declare the plugin in that project's `.claude/settings.local.json` and nowhere else — no `claude plugin enable`, and no effect on any other project. Measured on CLI v2.1.278 side by side with a `--plugin-dir` control: the takeover, the four `/agent-team:*` commands, every dispatchable role's `tools:` line and all six gates came out identical across the two. It buys you working slash commands and a resume that needs no flag; what it costs is the next two paragraphs.

**`--scope local` does not keep everything inside the project.** The install also writes machine-global entries under `~/.claude/plugins/`, and leaves a copy of the plugin in `~/.claude/plugins/cache/` that `claude plugin uninstall` does **not** remove. `claude plugin list` will therefore list the plugin from any directory on the machine — shown as `disabled` everywhere except the project that installed it, which is the part that actually governs what loads. If your machine already has another plugin named `agent-team`, name every reference `<plugin>@<marketplace>`: the uninstall confirmation line prints the bare name back at you and does not say which one it removed.

**The plugin ships a `settings.json` whose `agent` key pins the main session to `at-pm`.** That is the design — the project manager *is* the main session — and both load paths were measured to do it: the session transcript carries an `agent-setting` record reading `"agentSetting":"agent-team:at-pm"`, and the CLI prints `@agent-team:at-pm` in the session header. What it means in practice is that the session you just started is no longer a general-purpose session, and it is not a narrow one either. Read Known Limitations before pointing one at a project you care about.

**Pass `--plugin-dir` on every resume as well — `claude --resume` does not inherit it.** Measured on CLI v2.1.276: resuming a `--plugin-dir` session without the flag makes the CLI print `Continuing with the default tools and system prompt — the agent's tool restrictions no longer apply.`, the plugin's `/agent-team:*` commands stop resolving, and the main session falls back to the default tool surface. Every isolation property this plugin has rides on the roles' `tools:` declarations, so one forgetful resume takes all of them off at once. Note that `/agent-team:at-resume` and `claude --resume` are not the same thing: the first is a plugin command that restores *run state*, the second is a CLI flag that restores the *session*.

**A local-scope install has the same failure with a different trigger — resume in the wrong directory.** Measured on v2.1.278: resume inside the project directory that holds the install and everything survives, with no flag to pass at all. Resume that same session from anywhere else and the CLI prints the same line as above, because the agent is resolved against the working directory you are in *now*, not the one the session started in. There is no flag to forget here, which makes it the harder of the two to catch — and checking the transcript will not save you: it goes on recording the session as `at-pm` after the tool restrictions are already gone.

**To stop, end the session; start the next one without `--plugin-dir`, or uninstall.** Do not reach for `claude plugin disable` — a session's tool surface is fixed for its lifetime, and disabling was measured *not* to hand it back. `claude plugin enable` has the mirror-image problem: it takes over sessions that are already running. This project has banned both for itself, and every measurement it has was taken either with `--plugin-dir` or with a local-scope install. `claude plugin uninstall <plugin>@<marketplace> --scope local` was measured to leave the *next* session in that directory completely clean — no pin, no commands, no roles — but it says nothing about a session already running, which is the case `disable` fails at.

**Still undocumented, because it has not been measured:** a full `S1`–`S8` run under the local-scope install. The one end-to-end run this project has was taken under `--plugin-dir`, so read the stage-chain claims as claims about that path. Neither has any marketplace that is not a local directory: a GitHub-sourced install may resolve the plugin root somewhere else entirely, and this project has not looked. Measurements were also taken in background (`--bg`) sessions rather than an interactive terminal.

## Known Limitations

> Write-path isolation is a hard constraint on `Edit`/`Write`/`NotebookEdit` — but only for roles that claim paths in `project.json`. The roles that claim none, `at-qa` and `at-acceptance`, skip that check entirely: outside the run directory it returns early and allows, so they can create files wherever they like. And no hook watches `Bash` at all: executor roles keep it to run builds and tests, and `Bash` can write files (`echo >`, `sed -i`). `at-qa` holds both halves. This plugin is not a sandbox.

> Loading this plugin hands the main session to `at-pm` — and `at-pm` is not a narrow role. Its tool surface is `Bash`, `Write`, `Edit`, `Read`, `Glob`, `AskUserQuestion` and the `Agent(...)` dispatch whitelist, so a taken-over session can do everything an ordinary session can do, in whatever project it happens to be pointed at. The takeover is not self-limiting: what keeps it inside the intended project is the role's prompt, not its tool surface. Under `--plugin-dir` the blast radius is at least bounded to the sessions you start with that flag. Enabling the plugin machine-wide is a different proposition — it would apply to **every new session on this machine, in every project**, for as long as it stayed enabled — and this project does not do that (see Installation). A local-scope install sits between the two, and was measured there: bounded to the one project directory that declares it, and a new session in that directory comes back completely clean after `claude plugin uninstall <plugin>@<marketplace> --scope local`.

## Development

Run the test suite with a bare `node --test` from the repository root, with no path arguments. On this machine, `node --test tests/` does **not** discover the files under `tests/` — it silently reports a phantom `pass 0 / fail 1` instead, identically whether the code under test is fixed or broken, which sends anyone debugging the "failure" chasing a bug that doesn't exist.

## License

MIT — see [LICENSE](./LICENSE).
