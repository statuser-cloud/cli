# statuser (CLI) — notes for Claude

A command line on top of the public Statuser API: hand-written commands over
types generated from the production OpenAPI spec. Published to npm as
`statuser` with provenance. **This repository is public** — non-public data
(internal accounts, credentials, internal addresses) and links to private
repositories never land in repo files, comments included.

## Language

- **Commits, PRs, branch names and code comments — English only.** The repo is
  public and its history is read from the outside. Other repositories in this
  project are kept in Russian — do not carry that habit across repos.
- README and user-facing docs — Russian (that is the audience).
- Help and messages the CLI prints follow the system locale: Russian or
  English. Every string lives in both dictionaries in `src/i18n.ts`; `en` is
  typed by `ru`, so a key missing from one of them fails `tsc`. A string
  printed past the dictionary is printed in one language to everyone — do not.
  Command and flag names stay English.

## Never edit by hand

`spec/openapi.json` and `src/generated/openapi.ts` are output of
`npm run fetch-spec` (pulls `/swagger-json` from production). Hand edits are
overwritten by the next sync. Need different behaviour — change the API, then
sync.

An endpoint the CLI uses before it reaches the public spec (an operation under
`ApiOperationDevOnly` in the API) is typed by hand next to the command, with a
comment saying so. Replace it with generated types once the operation is
published.

## Release cycle

1. `sync-spec.yml` opens a `chore/sync-spec` PR when the production spec
   changes — `repository_dispatch: backend-deployed` sent by the API's CI
   after a production deploy, a daily cron as the safety net, and a manual
   trigger. The commands are
   hand-written, so a new spec changes nothing by itself; the PR is about
   typecheck. It is opened even when typecheck fails and the errors are at the
   top of its body: PRs opened with `GITHUB_TOKEN` do not trigger `ci.yml`.
2. A release is a version bump in `package.json` by hand, then the tag:
   `git pull && git tag "v$(jq -r .version package.json)" && git push --tags`.
   The tag triggers `publish.yml`, which gates on the version matching the tag.

**Never move a published `v*` tag.** npm refuses to republish the same version,
and provenance breaks on a moved tag. Got a release wrong — ship the next
version.

## Contract

- **Exit codes are API** (`src/errors.ts`): 0 ok, 1 API or network error, 2 bad
  arguments, 3 no key or key rejected, 4 scenario failed. CI pipelines branch
  on them; changing one is a breaking change.
- **`--json` output is API too.** Each command prints one documented shape.
  Progress and diagnostics go to stderr so stdout stays parseable.
- Write commands must not leave half-applied state they could have prevented:
  everything the API would reject mid-way (limits, names, duplicates) is
  checked before the first write — see `scenarios/plan.ts`.
- **The CLI never deletes on its own.** `apply` and `deploy` only list what
  the file does not mention. Removal is an explicit `servers delete` or
  `incidents delete` by id, never by project, and asks first
  (`confirm.ts`): without a terminal it needs `--yes`.
- **`servers add` goes through the `apply` parser and plan**
  (`createOnly`): one place for ranges, the host gate, duplicates and the
  plan, so a check added there covers both.
- **`apply` never changes a server's protocol**: the backend wipes what
  belonged to the old one (HTTP credentials, LLM key, heartbeat token).
- **What a protocol uses lives in one place** — `servers-config/fields.ts`
  (export allowlist, accepted file fields, `servers update` applicability).
  It mirrors `servers.service.ts` in the backend; when the backend changes
  which protocol uses a field, change it here too.
- **Host checks are copies of the backend**: `host-pattern.ts` is its
  `urlPattern`, `forbidden-host.ts` its `assertServerHostPublic` without
  DNS (`localhost` and the literals of `isForbiddenIp`) — a name resolves
  differently from the user's network. Checked only when a host is set or
  changed, as the backend does: old internal servers stay editable.
- **A write whose connection was never set up is retried and reported as
  not applied** (`NotSentError`); in `apply` and `deploy` any other network
  failure is an unknown outcome, never retried. Heartbeat pings are the
  exception: a repeated ping is harmless, a lost one is silence.
- **Duplicates are replayed in execution order** (`checkDuplicates`): the
  backend checks each request against the state at that moment, so a
  final-state check alone would let an address swap fail on its first PATCH.
- Export output is written 0600 (`files.ts`) and secret header values are
  replaced with `$STATUSER_<id>_<n>_<HEADER>` references; host, body and
  username are exported as is, and the docs say so.

## Secrets

- The API key goes only to the API origin: the client refuses foreign origins
  and never follows redirects. A saved key is bound to the origin it was
  checked against.
- Secrets never reach stdout or stderr: the key is not printed, the heartbeat
  token is masked in `--debug`, scenario env values are left out of the deploy
  JSON. A key with whitespace inside is rejected before fetch — fetch quotes
  the whole header in its error.
- Docs recommend environment variables over flags for secrets: arguments are
  visible in the process list.

## Completion and install scripts

- `statuser completion bash|zsh|fish` is generated from the live commander
  tree (`src/completion.ts`): a new command or flag is completed without
  touching it. Values offered after a flag live in the `VALUES` map there,
  keyed by `<command path> <flag>` or by the flag alone.
- In the zsh script the command path variable must not be called `path`:
  zsh ties `path` to `$PATH`, and a local `path` breaks command lookup
  inside the completion function. It is `cmdpath` in all three shells.
- `install.sh` and `install.ps1` must stay in sync with the release asset
  names built by `binaries.yml`: `statuser-<os>-<arch>.tar.gz` with
  `statuser` inside, `statuser-windows-x64.zip` with `statuser.exe`, and
  `SHA256SUMS`. `verify-install` in `publish.yml` runs both scripts against
  every release.

## Before a PR

Run what CI runs:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

## Git

Do not commit, push or merge without an explicit instruction.
