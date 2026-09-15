# agent-team

agent-team is a ten-role software development agent team: the project manager runs as the main session, dispatches work through a layered role hierarchy, sequencing is enforced by gates, and business acceptance runs as an independent track.

**Status:** M0 — foundation validation, not yet usable.

## Installation

Not yet published to a marketplace. Installation instructions will be added once the plugin is usable (post-M0).

## Known Limitations

> Write-path isolation is a hard constraint for `Edit`/`Write`, but only a soft constraint for `Bash`. Executor roles keep Bash available to run builds and tests, and Bash can write files (`echo >`, `sed -i`). This plugin is not a sandbox.

## License

MIT — see [LICENSE](./LICENSE).
