# M2 — Run Layer: Implementation Plan

**Milestone owner:** solo · **Budget:** 6 weeks (GDD §18) · **Status:** planned,
not started

**Traces to:** GDD §18 (M2 item list and gate), §5.1–5.3 (levels, XP, Threat),
§9 (economy), §10 (relics), §11 (map and run structure), §12.1/§12.3 (enemy
generation, boss rules), §13 (death and run end), §14 (unlocks — read, not
built), §16 (save), §17 (content budget), §20 (architecture).

---

## Context

M0 proved the queue is a game. M1 built the layer on top of it: six tags, the
Weave and its clamp, ten gem frames, sockets that cost Max HP, generative
crafting, Saturation, and a run layer to hold them.

**Neither milestone's gate has been answered.** M0's came back ambiguous and its
outsider pass was never run; M1's was never run at all. That is a deliberate
call, and the evidence supports it: a run today is six encounters fought at
**level-1 Max HP with a level-9 deck**, because §5.1's level table is unwritten
and nothing grants XP. The harness has never once cleared the set — not in M1,
and not in M0 either. Handing that to a tester would measure a missing power
curve rather than the build layer.

M2 is where that stops being true. §18's own gate for it — **a complete
35-minute run** — is the first point at which the game is a game end to end, and
it is the right place to answer all three sets of questions at once.

That inheritance is the shape of this milestone: M2 is not only "map, economy,
relics, XP/Threat, save, one boss". It is **the milestone that makes the
previous two testable**, and its plan has to carry their unanswered questions
rather than quietly drop them.

---

## 1. What M2 is

> **Is there a 35-minute game here?**

M0 asked whether a turn was interesting. M1 asked whether a build could diverge.
M2 asks whether the two add up to a run someone would finish.

### In scope

The six §18 items, plus five things they structurally require:

1. **XP, levels and Threat** — §5.1–5.3
2. **The map** — §11: 4 Depths, each offering 2 Dungeons / 1 Sanctum / 1 Market,
   two nodes taken, then the Boss
3. **The economy** — §9's full ledger: gold, the Market, card removal
4. **Relics** — §10: passive modifiers, every one with a real drawback
5. **Save and resume** — §16: versioned, at node and encounter boundaries only
6. **One boss** — §12.3's Depth 1, The Clockeater
7. *(required by 1)* **§5.1's 16-skill table**, finally authored — a level grants
   skill *N*, so levelling is meaningless without it
8. *(required by 2)* **Enemy generation** — §12.1's `archetype + modifier + level`;
   a generated map cannot draw on six hand-built encounters
9. *(required by 8)* **More archetypes** — three cannot fill eight Dungeon nodes
10. *(required by 4)* **Elites** — §10 makes them the relic source and §7.2 makes
    them the only carrier of hard immunity
11. *(required by 2)* **A map scene** — the game has been one screen since M0

### Explicitly out of scope

Riddles and Wagers (§8) · unlocks and meta-progression (§14) · the other three
bosses · post-clear Depths I–X · the full §17 content budget · a second class ·
art and audio beyond placeholder shapes.

Same rule as M0 and M1: if a task seems to need one of those, it does not —
write the smallest stand-in, mark it `[M2 STAND-IN]`, and record it in §2.

---

## 2. Design decisions

Numbering continues M1's.

| # | Gap | Decision | Recorded in |
|---|---|---|---|
| D35 | **The set has never been cleared.** Not in M1, not in M0. | **Measured in S1, and the first diagnosis was wrong.** It is not a diffuse power shortfall: five of the six encounters are cleared 100% of the time by two of four policies, and the zero is *one* encounter — Full Consort, which loses 64–95% even at full HP. Alongside it sits a socket economy in which spending 26 Max HP on unread frames is strictly worse than spending nothing, which is exactly the failure §5.1 `[FIX]` predicted: "v0.1 had a fixed 70 Max HP while charging 8–18 Max HP per socket". M1 shipped the charge without the pool. | here |
| D35a | **The harness said S1 made things worse; a human said it did not.** Policies fell from ~5 of 6 fights cleared to 3.1 and socketed builders to 1.6–2.5 — but the owner played the new curve and reached Full Consort, the sixth. | **Trust the gap, not either number.** The harness has always documented its policies as a floor ("read every rate as a floor a competent human beats"); this is the first measurement of how *far* below the floor sits, and it is roughly a factor of two in fights cleared. A harness regression of that size was still not evidence of a design regression, and only play could tell them apart. The standing rule from here: a policy result is a **relative** instrument — read it against the previous policy result, never as an absolute claim about difficulty. | here |
| D35b | So what *is* wrong, if not the curve? | One encounter. Full Consort loses 64–95% at full HP for every policy and is where human play stops too. It is the last of six fixed encounters, and §11 **deletes it** — the fixed chain becomes a generated map whose difficulty rises with Depth and Threat. The wall is therefore not a balance task to be done before the map; it is a thing the map removes. No separate fix, and none should be attempted before S3. | GDD §11, here |
| D36 | **§5.1's 16-skill table is still unauthored** after two milestones, and a level that grants "skill *N*" needs an *N*. | Author it. The seven provisional cards that survived M0 and M1 are promoted and the table is filled out to sixteen across the six tags, keeping M0's Weight curve shape. This is the largest single piece of authored content in M2 and the thing every other system reads. | GDD §5.1 |
| D37 | **The Depth-1 boss must be beatable by any build** (§12.3), but a boss is also the only thing gating a Depth. | The Clockeater only. §18 says one boss and §12.3's own note says Depth 1 must be winnable by any build, which makes it the right one to build first — it is the boss that must *not* require a specific build to beat. Depths 2–4 close on a scaled elite as a `[M2 STAND-IN]` until M3 authors the other three. | GDD §12.3, here |
| D38 | **A save must not persist derived data** (§16). `CombatState` carries the whole card catalogue. | The save is **`RunState` and nothing else**. The catalogue is rebuilt from the data files by `encounterSetup`, so it is derived rather than state; and §16 already says an encounter is atomic and resume replays it from its start state. Serialization is pure and lives in `/run`; IndexedDB is async and browser-only and lives behind an adapter at the edge, like Phaser. | GDD §16 |
| D39 | **Relics change combat rules** — Metronome zeroes the first action's Weight, Undertow adds a tick to Stagger and takes 10 Speed, Prism rewrites §7.1's multipliers, Glass Sigil scales damage both ways. That is not one lever. | Relics reuse M1's **effect-atom registry pattern** rather than inventing a second one: a relic is data naming registered atoms, and the atoms write to a small closed set of levers on `CombatRules`, the Weave table, and the resolved card. A relic that needs a lever nobody has is a real design change, exactly as with frames (M1 D33). | GDD §10 |
| D40 | **Eight Dungeon nodes cannot be six hand-built encounters.** §12.1 specifies generation; M1 has three archetypes and a fixed list. | Build §12.1's generator on the `enemyGen` stream, and grow the roster enough to feed it. `ENCOUNTERS` stops being the run's content and becomes what it always should have been: fixtures for tests and the harness. | GDD §12.1 |
| D41 | **Gates deferred.** M0's is ambiguous with its outsider pass unrun; M1's was never run. | They are **carried, not dropped.** M2's gate asks its own question *and* M1's three material-difference criteria *and* M0's six questions, in one sitting on a complete run. Recorded in `docs/M2_GATE.md`, which supersedes neither of the earlier documents but closes both. If the answers are bad, the failure is two milestones deep and the response is proportionally larger — that is the cost of deferring, and it is stated here so it is not a surprise. | here, docs/M2_GATE.md |

---

## 3. Architecture spine

New files marked `+`. The three architecture guards are unchanged and still
fail the build on a `/sim` → `phaser | /ui | /scenes | /run` import, on ambient
time or randomness in `/sim`, and on arithmetic over game numbers in `/ui`.

```
/src
  /sim
+   relicEffects.ts  the relic atom registry, beside gemEffects.ts
+   level.ts         the §5.1 curve and §5.2 XP formula — pure arithmetic
    rules.ts         CombatRules grows the levers relics write to
  /data
+   skills.json      §5.1's sixteen, finally authored (D36)
+   relics.json      §10, every entry carrying its drawback
+   archetypes.ts    grown enough to feed a generated map (D40)
+   bosses.ts        The Clockeater (§12.3)
    encounters.ts    demoted to test and harness fixtures
  /run
+   map.ts           §11's four Depths, on the `map` stream
+   generate.ts      §12.1's archetype + modifier + level, on `enemyGen`
+   economy.ts       §9's ledger: gold, the Market, card removal
+   relics.ts        which are held, and what they do to a CombatSetup
+   progress.ts      XP, levels, Threat (§5.1–5.3)
+   save.ts          pure serialize/parse of RunState, versioned (§16)
    RunState.ts      grows level, xp, threat, gold, relics, map position
  /platform
+   idb.ts           IndexedDB behind an async adapter — the only file that
                     knows a database exists, and nothing pure imports it
  /scenes
+   MapScene.ts      §11's node choice; the game stops being one screen
+   RunScene.ts      or: one scene that owns the run and swaps children
    CombatScene.ts   receives an encounter, reports its result, owns no run
  /ui
+   MapView.ts       nodes, Threat, the Omen tag (§11)
+   RelicTray.ts     what is held, and what it costs you
+   RunSummary.ts    §13's summary, and "retry this seed"
```

### 3.1 The save is the run, and nothing else

`RunState` is already plain data holding all five stream positions, and
`encounterSetup(run)` already rebuilds the catalogue from the data files. So a
save is a serialized `RunState` and a version number, and resume is
`parse → encounterSetup`. Nothing derived is written, which is what stops a
future fix to gem math from silently changing a resumed run while the golden log
still matches.

IndexedDB is asynchronous and browser-only. It goes behind an adapter at the
edge, exactly where Phaser goes, and the *serialization* stays pure in `/run`
where it can be unit-tested without a browser.

### 3.2 Relics are atoms, not a switch

M1 learned this the expensive way with gem frames (D33): ten frames were not ten
handlers, they were sixteen atoms and a data table. §10 budgets **24 relics**,
and they touch more systems than frames do — the timeline, the Weave, the socket
economy, the deck. A registry of levers is the only version of this that does
not become a `switch` growing by one case per relic, which CLAUDE.md §4.2
forbids outright.

---

## 4. Sprint breakdown

Eight sprints. The riskiest thing in M2 is not the map or the save — it is that
**the game may not be winnable at all**, and everything else is scaffolding
around a run nobody can finish. So the power curve comes first and the harness
answers the question before a single node is drawn.

| # | Days | Scope | Exit criterion |
|---|---|---|---|
| **S1** | 5 | §5.1's sixteen skills authored; the level table, XP (§5.2) and Threat (§5.3); Max HP growing +6 a level | ~~The harness clears the set at least sometimes.~~ **Done, and the criterion was wrong** (D35a): the level curve cannot be read against a six-fight chain authored for a 12-card deck. What S1 delivers is the *curve itself*; whether it is tuned correctly is now S4's question, measured against a real run |
| **S2** | 4 | §12.1's generator on `enemyGen`; the archetype roster grown to feed it; `ENCOUNTERS` demoted to fixtures | A generated Dungeon at a given Threat is reproducible from its seed, and the 48 existing references to the fixed list still compile and pass |
| **S3** | 4 | §11's map on the `map` stream: 4 Depths, 2-of-4 node choice, Omen tags, Threat rising per node entered; a run-flow reducer so the harness plays the *shipping* flow | The same seed lays out the same map; a node shows its Threat and Omen *before* it is entered and its composition only after; a headless test plays a full 4-Depth run |
| **S3a** | 2 | **The real S1 measurement**, now that there is a run to make it against: win rate by Depth, and `ascetic` measured against every other builder | **At least two builders beat `ascetic`** — the direct test of §5.1 `[FIX]`'s thesis that a growing pool makes the socket cost survivable, and the one number that does not depend on the policy skill floor. Win rate is read as a *trend against the previous run*, not against an absolute target (D35a) |
| **S4** | 4 | §9's ledger — gold, the Market, card removal at 60/120/240/480; the Sanctum | A run's totals land near §9's targets (~450 gold, ~9 materials, ~7 Insight) across the harness |
| **S5** | 5 | Relics: the atom registry, ~10 of §10's 24, elites as their source | Every relic has a drawback the parser enforces; an unregistered relic atom fails at load naming the relic |
| **S6** | 4 | §16 save and resume: versioned, pure serialization, the IndexedDB adapter | **A run resumed from a save byte-matches one that never stopped** — same event log, same stream positions |
| **S7** | 5 | The Clockeater (§12.3); §13's run summary and "retry this seed"; MapScene and the scene split | A complete run can be played from first node to boss kill in a browser |
| **S8** | 4 | Balance against §19; the 35-minute timing budget (§11); then the gate | A run takes 30–40 minutes; the harness wins often enough to read §19's diversity metric; the gate is run |

≈ 7 working weeks, against §18's 6 — over, and the overrun is S1's fault by
design. If S1 shows the game is winnable with levels alone, S2 starts on time
and the rest holds.

**The first moment M2 is real: end of S3**, when a run has a route through it.
**The first moment it is a game: end of S7.**

---

## 5. Test obligations

- **Resume equivalence** (S6) — the new determinism surface, and the highest-value
  new test in M2: a run serialized at every node boundary and resumed produces a
  byte-identical event log to one played straight through. Same shape as M1's
  preview equivalence, and for the same reason — two paths to one result.
- **Map reproducibility** (S3) — one seed, one map, asserted over many seeds.
- **Stream isolation** (S2, S3) — generating a map must not move `combat`;
  generating enemies must not move `gemRoll`. `tests/sim/rng.test.ts` already
  asserts the property and now has two more consumers to hold to it.
- **Save migration** (S6) — a v1 save loads into a v2 build, or is rejected
  loudly. Never silently half-read (§16).
- **Every relic has a drawback** (S5) — enforced by the parser, the way
  `frames.json` already enforces it (M1).
- **The level curve** (S1) — Max HP at level *N* matches §5.1's table exactly;
  XP follows §5.2's formula including both clamp bounds.
- **Threat** (S1) — `enemy_level = depth_base + floor(Threat / 2)`, and Speed
  never scales with it (§12.1).
- The three architecture guards keep passing, and `/platform` is added to the
  list `/sim` may not import.

---

## 6. Risks

| Risk | Watch for | Response |
|---|---|---|
| **The game is not winnable even with levels** | S1's harness still clears nothing | S2 becomes balance, not the map. This is the milestone's real risk and the reason S1 is first |
| **Two milestones of unanswered gates land at once** | M2's gate fails on an M0 or M1 question | Accepted deliberately (D41). The response is proportionally larger and that is the price of deferring |
| Save/resume diverges | A resumed run drifts from a straight one | Resume equivalence (§5), written in S6 before the adapter |
| Relics become a switch | A second `if` chain growing per relic | The atom registry (D39), CLAUDE.md §4.2 |
| §17's content budget swallows the milestone | Authoring 16 skills, 24 relics, 14 archetypes | M2 ships the *minimum that makes a run real* — 16 skills, ~10 relics, enough archetypes for eight nodes. The rest is M3's whole purpose |
| The 35-minute budget is missed | Runs at 50 minutes or 20 | §11 names the lever: cut Depth 2 to one Dungeon node before touching encounter pacing |

---

## 7. The gate

**GDD §18: a complete 35-minute run.** M2's gate also closes M0's and M1's,
which were deferred to it (D41).

Recorded in `docs/M2_GATE.md`. Three questions in one sitting:

1. **M2's own:** does a run play start to finish in 30–40 minutes, and would you
   start another?
2. **M1's, carried:** two testers, same seed — do they reach materially
   different builds, on the three criteria `docs/M1_GATE.md` §2 fixed in advance?
3. **M0's, carried:** the six questions, including the outsider pass that was
   never run — someone who has not read the GDD plays cold.

A failure at (3) is the most serious possible outcome and the one deferring
bought: it would mean two milestones built on an unproven core. It is unlikely —
M0's answers 1, 3 and 5 were already yes — but the plan names it rather than
assuming it away.

---

## 8. Verification

Per CLAUDE.md §8, every sprint closes green on all of these; the milestone
additionally closes on §7.4's browser pass.

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run sim -- --report --seeds=2000
npm run sim -- --builds --seeds=200     # §19's diversity metric, finally readable
```

**Headless browser pass** (CLAUDE.md §7.4) at the end of each sprint that touches
the screen, driven over CDP for the interaction assertions. M2-specific:

- A map laid out from `?seed=N` is the same map every time, and a node states its
  Threat and Omen before it is entered.
- A run saved at a node boundary and reloaded resumes on the same node, with the
  same gold, relics, build and Attunement.
- The boss fight opens, and the run summary names the seed and offers a retry.

Kill Brave and vite **by PID** afterwards; `pkill -f` kills the shell itself.

**Manual pass.** This one is the gate (§7) — a complete run, played start to
finish, timed. Nothing headless can tell you whether you would start another.
