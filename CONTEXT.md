# Beads task discovery

This context defines the user-facing vocabulary for discovering Beads work
from OpenCode prompts.

## Language

**Beads issue**:
An issue record stored in the Beads workspace associated with the current
project.
_Avoid_: Ticket, task

**Issue search**:
A user-entered query that finds matching Beads issues by issue ID and title.
_Avoid_: Task lookup, ticket search

**Beads reference**:
The `bd:` prompt prefix that asks OpenCode to perform an issue search.
_Avoid_: Hash reference, task tag
