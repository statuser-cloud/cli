# Instructions for Codex

Before starting any work, read `CLAUDE.md` in this repository root and follow
its project instructions. Keep shared project rules in `CLAUDE.md` so Claude
and Codex use the same source of guidance.

## Shared local memory for Claude and Codex

If available, read `~/.codex/project-memory/statuser/MEMORY.md`, both memory
indexes, and notes marked `type: feedback` or `type: user` in YAML metadata
before starting work. Read other notes as relevant to the task.

Save durable knowledge and preferences in the shared local memory directories:
- frontend, UI, marketing, and product:
  `~/.codex/project-memory/statuser/statuser-frontend/`;
- backend, API, agents, infrastructure, and general technical notes:
  `~/.codex/project-memory/statuser/statuser-backend/`.

These directories are symlinks to Claude's memory; edits are visible to both
agents. Update the corresponding `MEMORY.md` index when adding a note and
follow the format of nearby notes. Re-read a file before editing and make
focused changes to preserve other sessions' edits. Keep project rules in
`CLAUDE.md` and do not create separate copies of the shared memory.

Shared memory is private local context. Do not copy non-public data from it
into this public repository, commits, pull requests, or issues.
