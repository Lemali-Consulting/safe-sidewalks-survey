# TODO

## Completed-segment visualization

Right now completed surveys only appear as red point markers (from `Sidewalk_Survey_view`). The original Survey123 form promised "blue line segments represent completed sidewalk condition surveys" but never delivered — the `Assessed` flag on `Sidewalk_Buffer` is stale (only 4 of 1,851 submissions are reflected there).

**Goal:** paint a sidewalk block in a distinct "done" color once someone has submitted a survey on it, without relying on the broken `Assessed` flag.

**Approach options:**

1. **Client-side spatial match.** Fetch all ~1,851 points from `Sidewalk_Survey_view` (just geometry, cheap), then for each polyline in `Sidewalks_Blocks` check if any point falls within ~15 m. Style matching blocks differently. In-memory with a small R-tree (e.g. `rbush`). Runs once on load.
2. **Server-side spatial query.** Query `Sidewalks_Blocks` with a geometry filter built from the union of all submission points. Might hit query-size limits.
3. **Ignore the flag, use proximity only in the viewport.** Fetch only the points in the current bbox and do the match per-tile. Cheaper steady-state, more complex code.

**Recommendation:** option 1. Simple, one-time cost, no extra moving parts.

**Open question:** what counts as "completed"? One submission? Multiple? Submissions from different sides of the street should probably both count, but the current data model doesn't distinguish sides — so one point = one block-done is probably the right first pass.
