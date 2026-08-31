# Project Cadence — Engineering Guidelines

Single-hero, tick-scheduled deckbuilding roguelite built with **Phaser 4 + TypeScript**.
**[`CADENCE_GDD_v0.2.md`](./CADENCE_GDD_v0.2.md) is the source of truth for *what* to
build** — read it before implementing anything. This file is the source of truth for
*how* to build it.

These rules are mandatory for every change. If a rule must be broken, say so
explicitly and explain why in the same message as the change.

---

## 1. The Game Design Document (Source of Truth)

**`CADENCE_GDD_v0.2.md` is the single source of truth for what this game is.**
Read the relevant section before implementing any system. This file governs *how*
code is written; the GDD governs *what* the code must do. Where they overlap
(architecture, data structures — GDD §20), the GDD's intent wins and this file's
standards describe the way to express it.

### 1.1 Rules for working against the GDD

- **Consult before building.** Every feature traces to a GDD section. If you cannot
  point to one, the feature is out of scope — ask before writing it.
- **Never silently deviate.** If an implementation cannot match the GDD, or the GDD
  is ambiguous/contradictory, stop and surface the conflict with the specific
  section cited. Do not "improve" the design on your own initiative.
- **The GDD is a living document.** When a design decision genuinely changes, update
  the GDD in the same change that implements it, and flag it the way v0.2 does
  (`[FIX]` / `[NEW]`). Code and GDD must never disagree; a drifted GDD is a bug.
- **Open questions are open.** GDD §22 lists six unresolved decisions. Do not resolve
  one by writing code that assumes an answer. Resolving one means: prototype, decide,
  update the GDD, then implement. Open question 1 (Ultimates) is scheduled for M0.
- **Speak the GDD's language** (see §5.1 of this file). Its terminology is the
  codebase's ubiquitous language: `Tick`, `Weight`, `Recovery`, `Guard`, `Poise`,
  `Stagger`, `Weave`, `Attunement`, `Ascendant`, `Suppressed`, `Saturation`,
  `Socket`, `Gem`, `Frame`, `Scarred`, `Insight`, `Riddle`, `Wager`, `Threat`,
  `Depth`, `Sanctum`, `Market`, `Cooldown pile`, `Omen`. Do not invent synonyms —
  in particular there is no "energy", no "block", no "turn duration", and no
  "aggro/threat/taunt" (GDD §4.8: enemy AI targets the player only).
- **Balance numbers belong to the GDD.** Weight classes (4/6/10/16), Recovery
  (8/14/26/60), the `ceil(weight * 100 / effective_speed)` delay, the 600-tick combat
  seed, Guard's 1/tick decay and cap of 40, the Poise/Stagger 3→2→1 falloff, the
  Speed curve and 180 cap, the Weave clamp of `[0.30, 2.00]`, socket costs
  (8/12/18% Max HP) and the 40%-of-baseline Max HP floor — all come from the GDD and
  live in typed config/JSON. Never hardcoded in a method body, never tuned without
  updating the GDD.

### 1.2 The design pillars (GDD §2)

Every technical decision is checked against these:

1. **P1 — Time is the only cost.** There is no energy resource anywhere in the
   codebase. Every action's cost is a `Weight` in ticks. If a system needs a second
   cost axis to work, it is designed wrong.
2. **P2 — The deck is given; the build is earned.** Card acquisition is a
   deterministic authored table (GDD §5.1). **There is no card selection screen
   anywhere in the game** — do not build one, not even as a debug affordance that
   could leak into the UI.
3. **P3 — Value is unstable, not hidden.** Every multiplier the sim applies must be
   readable by the UI *before* the player commits. Any computed value the player
   cannot see is a design bug.
4. **P4 — Creativity is paid, not permitted.** Insight is the only currency for
   experimentation; it is earned only from Riddles, Wagers, and bosses (GDD §8, §9).
5. **P5 — Legibility above all.** Six systems, two numbers on screen. New UI must
   remove something or justify its cost.
6. **P6 — Everything is measured in ticks.** *This is a hard architectural rule.*
   DoT, buffs, Guard decay, cooldowns, and the queue all use the one unit. **No sim
   module may express a duration in turns, rounds, seconds, or milliseconds.** Turns
   are asynchronous and per-actor; a "2-turn buff" is meaningless here. Enforced by
   the branded `Tick` type (§2.3) and by review.

### 1.3 System map — GDD section to implementation

| System | GDD | Owns |
| --- | --- | --- |
| Timeline scheduler | §4.1 | `next_act_tick` min-heap, tie-break by Speed then actor index, combat seeding at `ceil(600 / speed)` |
| Queue forecast | §4.2 | 8-slot lookahead projection; ghost preview via speculative reduce |
| Wait action | §4.3 | Weight 3, draw 1, +3 Guard, auto-select after 1.5s when no legal play |
| Guard | §4.4 | Absorb-before-HP, decay 1/tick, cap 40 |
| Statuses | §4.5 | Poison/Bleed/Burn/Slow/Haste/Weaken/Empower/Brittle, all tick-scheduled |
| Poise & Stagger | §4.6 | Threshold break, `next_act_tick += 3`, halving per application (floor 1) |
| Speed curve | §4.7 | Soft cap 140, half-gain above, hard cap 180, draw decoupled above 140 |
| Targeting | §4.8 | 1–4 enemies, sticky target, auto-advance on kill, AoE at 60% with independent Poise |
| Piles & Cooldown | §4.9 | Draw / hand (cap 6) / Cooldown pile with `return_tick`, no early reshuffle |
| Levels & skills | §5.1 | Fixed authored skill table, +6 Max HP per level |
| XP & Threat | §5.2–5.3 | XP curve, `enemy_level = depth_base + floor(Threat / 2)` |
| Sockets | §6.1 | % Max HP cost, success rates, Scarred flag, Max HP floor |
| Gems & crafting | §6.2 | Frames, tiers, rolled values, affixes, Insight reroll |
| Weave | §7 | `clamp(attunement × (1 − resist) × (1 − saturation), 0.30, 2.00)`, shift schedule, floor indicator |
| Insight | §8 | Riddle predicates over the event log, Wagers |
| Economy | §9 | Gold/material/Insight ledger, material tier upgrades |
| Relics | §10 | Passive modifiers, every one with a real drawback |
| Map & run | §11 | 4 Depths, 2-of-4 node choice, Omen tags |
| Enemies | §12 | `archetype + modifier + level`, scaling formulas, Speed never scales |
| Run end | §13 | Immediate death, run summary, seed replay |
| Save | §16 | Versioned IndexedDB save at node/encounter boundaries, never mid-encounter |

### 1.4 Roadmap discipline (GDD §18)

Development follows M0 → M4 and **each milestone has a gate**. Build the current
milestone's scope only; a hook, abstraction, or interface for a later milestone is a
YAGNI violation (§5.5).

- **M0 — Feel test.** Scheduler, queue, hand, ghost preview, Cooldown pile, Guard,
  Poise/Stagger, three enemies. *Do not build the map, gems, economy, relics, or art.*
  **Gate:** an hour of play with no gems. If moving your position in the queue is not
  fun by itself, the project stops. Treat that gate as real.
- **M1 — Build layer.** Sockets, gems, crafting, Weave panel, Saturation.
- **M2 — Run layer.** Map, economy, relics, XP/Threat, save/resume, one boss.
- **M3 — Content.** Fill the §17 budget.
- **M4 — Balance and polish** against the §19 methodology.

The current milestone is recorded in `docs/` alongside its plan. When in doubt about
whether something is in scope, it is not.

---

## 2. Architecture — the sim/render split

### 2.1 The one non-negotiable boundary (GDD §20.1)

The combat model is a **pure, headless, deterministic module with zero Phaser
imports.** This is what makes the ghost preview trivial (clone state, apply action,
read the queue), makes the §19 balance simulation possible at all, and keeps an
engine change confined to `/scenes` and `/ui`.

```
/src
  /sim          ← no Phaser, no DOM, no Date.now(), no Math.random()
    tick.ts       branded Tick type + arithmetic
    rng.ts        seeded PRNG, one instance per named stream
    timeline.ts   min-heap scheduler on next_act_tick
    combat.ts     reducer: (CombatState, Action) => CombatResult
    effects.ts    tick-scheduled status resolution
    weave.ts      tag multiplier math (§7)
    events.ts     the combat event log types
  /data         ← JSON: cards, gems, frames, affixes, enemies, relics, riddles
  /run          ← run state, map gen, save/serialize
  /scenes       ← Phaser scenes (wiring only)
  /ui           ← queue strip, hand, weave panel, forge
  /sim-harness  ← headless policy agents and balance runs (§19)
```

Rules:

- Nothing in `/src/sim` may import from `/scenes`, `/ui`, `/run`, or `phaser`.
  A unit test asserts this by scanning the import graph; it is a build failure, not
  a style note.
- `/sim` is free of ambient nondeterminism: no `Math.random`, no `Date`, no
  `performance`, no `crypto`. Randomness arrives as an injected `Rng` (§4.5).
- The UI never computes game numbers. If the queue strip needs post-Weave damage,
  the sim exposes it — the UI does not multiply (GDD §15).

### 2.2 Combat is a reducer (GDD §20.3)

`(CombatState, Action) => { state: CombatState; events: CombatEvent[] }`, immutable,
emitting an event log. Riddles, achievements, telemetry, replays, and the ghost
preview all read that log. **No game logic in a Phaser `update` loop.**

- `CombatState` is a plain serializable value: no class instances, no functions, no
  `Map`/`Set` in persisted shapes, no references back into Phaser objects.
- Every state change is caused by an `Action` or by the scheduler advancing time.
  There are no side-channel mutations from the UI.
- Ghost preview is `reduce(state, action)` on a clone, read the projected queue,
  discard. It must not be a separate estimation path — a preview that can disagree
  with the real result destroys the pillar it exists to serve.
- The event log is append-only and typed as a discriminated union. Adding an event
  kind is additive; consumers must handle unknown kinds by ignoring them.

### 2.3 Ticks are a type, not a number (GDD §2 P6)

```ts
type Tick = number & { readonly __brand: 'Tick' };
```

Durations, `next_act_tick`, `return_tick`, Weight, Recovery, Guard decay windows, and
status timers are all `Tick`. Animation timings in `/ui` are milliseconds and are
never `Tick`. The type is the enforcement mechanism for P6: if a value crossing into
the sim is not a `Tick`, it does not describe game time.

### 2.4 Determinism (GDD §20.2)

- One run seed. **Separate named PRNG streams** — `map`, `gemRoll`, `enemyGen`,
  `combat` — so changing one system does not reshuffle the others during testing.
- Stream positions are part of the save and part of the run summary. Seed replay
  (GDD §13) and daily challenges fall out of this for free.
- Any function that consumes randomness takes its `Rng` as a parameter. A module that
  reaches for a global stream is a bug.
- Determinism is a tested property, not an aspiration: same seed + same action
  sequence ⇒ byte-identical event log (§7.2).

---

## 3. TypeScript Standards

### 3.1 Strictness
- `tsconfig.json` runs in **strict mode**, non-negotiable:
  `strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`.
- **`any` is banned.** Use `unknown` at boundaries and narrow it. If a third-party
  type is missing, write the declaration rather than casting through `any`.
- **No `as` casts** to silence the compiler. Casting is allowed only after a real
  runtime check, in a type guard (`function isX(v: unknown): v is X`), or in the one
  sanctioned place a brand is applied (`tick()`, `weight()` constructors).
- **No non-null assertions (`!`)**. Handle the `undefined` case or restructure so it
  cannot occur. `noUncheckedIndexedAccess` will make heap and pile indexing explicit —
  that is the point, do not cast it away.
- **No `@ts-ignore`**. `@ts-expect-error` with a one-line justification, only when a
  genuine compiler/library limitation is being worked around.

### 3.2 Typing style
- Prefer `type` for unions and function shapes, `interface` for object contracts that
  classes implement or that get extended.
- Model domain values as **discriminated unions**, not booleans plus optional fields.
  Example: `type Action = { kind: 'play'; card: CardId; target: ActorId } |
  { kind: 'wait' }` — never `{ isWait: boolean; card?: CardId }`.
- Use **string literal unions** over `enum` (`type Tag = 'Physical' | 'Fire' | ...`,
  `type Frame = 'REPEAT' | 'CHARGE' | ...`). They serialize cleanly to and from the
  JSON data files and cost nothing at runtime.
- Mark data that must not mutate as `readonly` / `ReadonlyArray<T>`. Loaded JSON
  (cards, gems, frames, affix pools, enemies, relics, riddles) is **immutable** —
  clone before modifying. `CombatState` is `readonly` throughout; the reducer returns
  new values.
- Make illegal states unrepresentable. Branded IDs (`ActorId`, `CardId`, `GemId`) over
  bare `string`. A card is in exactly one pile — model the piles, do not put a
  `location` field on the card.
- Avoid optional properties as a default. An optional field must mean "genuinely
  absent", not "not filled in yet".

### 3.3 Modules & structure
- One primary export per file; filename matches the export.
- `PascalCase` for types/classes, `camelCase` for values/functions,
  `SCREAMING_SNAKE_CASE` for module-level constants.
- No circular imports. If two modules need each other, the shared piece belongs in a
  third module (usually a type).
- No barrel `index.ts` files that re-export whole folders — they hide dependencies and
  break tree-shaking.
- Boundary data (JSON) is **validated on load** by a parser returning a typed result.
  Never trust a cache read to match its interface. An invalid card or enemy id fails
  loudly at load, not silently at combat time.

---

## 4. SOLID Principles

### 4.1 Single Responsibility
- A class has one reason to change. The `Timeline` schedules; it does not apply
  damage. `Effects` resolves statuses; it does not decide targets.
- Split along the GDD's own seams: `Timeline` (who acts next), `CombatReducer` (what
  an action does), `Effects` (what time does), `Weave` (what a tag is worth),
  `DeckPiles` (where cards are), `EnemyIntent` (what the enemy telegraphs).
- Phaser `Scene` classes are **wiring only**: create systems, connect them, tick them.
  Game rules never live in a Scene.

### 4.2 Open/Closed
- Extend behavior by adding data or a new registered implementation, never by editing
  a `switch` that grows with every feature.
- New card effects, gem frames, status effects, relics, riddle predicates, and enemy
  archetypes must be addable via JSON + a registered handler with **zero edits to
  existing systems**.
- Registries over conditionals: `effectHandlers.register('EXTRA_STRIKE', fn)` beats
  `if (effect.type === 'EXTRA_STRIKE')`. The one permitted exhaustive `switch` is over
  a closed union the compiler checks (`Action.kind`), where a new case *should* break
  the build.

### 4.3 Liskov Substitution
- A subtype must honor its base contract. If an override throws "not supported", the
  hierarchy is wrong — use composition.
- A boss is not a subclass of an enemy whose `telegraphIntent()` it no-ops. Model
  capability as data the actor either has or lacks.

### 4.4 Interface Segregation
- Small, role-shaped interfaces: `Damageable`, `Staggerable`, `Scheduled`,
  `HasGuard`. Consumers depend only on what they call.
- No god `IActor` that every system must implement in full.

### 4.5 Dependency Inversion
- Systems depend on **interfaces**, not concrete classes or Phaser globals.
- Inject collaborators through the constructor. No service locators, no singletons, no
  reaching into `scene.registry` for a dependency from deep inside a system.
- Pure game logic (delay math, Guard decay, Weave multipliers, socket cost, XP,
  gem rolls) is **Phaser-free** and unit-testable in isolation. Phaser is a
  rendering/input detail at the edges, not a dependency of the rules.
- Randomness is injected as an `Rng` interface, never `Math.random()` inline — this is
  what makes generation seedable, reproducible, and replayable (§2.4).

---

## 5. Clean Code

### 5.1 Naming
- Names state intent: `projectQueue`, not `calc2`.
- No abbreviations beyond established domain terms (`Rng`, `Ai`, `Xp`, `Hp`, `DoT`).
- Booleans read as predicates: `isStaggered`, `hasGuard`, `canPlayCard`.
- Use the GDD's vocabulary exactly (§1.1). `Guard`, never "block" or "shield".
  `Cooldown pile`, never "discard". `Weight`, never "cost". `Recovery`, never
  "cooldown duration". Code and design doc must speak the same language.
- **No magic numbers.** `GUARD_CAP`, `GUARD_DECAY_PER_TICK`, `WAIT_WEIGHT`,
  `COMBAT_SEED_CONSTANT`, `SPEED_SOFT_CAP`, `WEAVE_FLOOR`. Tunable gameplay values
  live in typed config or JSON, cite their GDD section in a comment, and are never
  literals in a method body.

### 5.2 Functions
- Small and single-purpose. If a function needs a comment to explain its sections,
  those sections are separate functions.
- Max 3 parameters; beyond that pass a named options object.
- **No boolean flag parameters** — `applyDamage(x, y, true)` tells the reader nothing.
  Two functions, or an explicit union argument.
- Prefer pure functions returning new values over methods mutating shared state. In
  `/sim` this is not a preference, it is the architecture.
- Guard clauses over nested `if`. Keep nesting at 2 levels or less.

### 5.3 Comments
- Code explains *what*; comments explain *why* — a non-obvious balance decision, a
  Phaser quirk, a deliberate trade-off. A comment citing a GDD section for a formula
  is always welcome (`// GDD §4.7: soft cap prevents the Haste runaway`).
- No commented-out code, no changelog comments, no redundant restatements.
- Public system APIs get a short TSDoc block; private helpers usually need none.

### 5.4 Error handling
- Fail fast and loud on programmer error (unknown card id, unregistered effect type,
  malformed enemy JSON) — throw with a message naming the offending id.
- Expected failures return a typed result (`{ ok: true, value } | { ok: false, error }`),
  not `null` plus a comment. An illegal action (playing a card on cooldown) is an
  expected failure and must be rejected by the reducer, not prevented only by the UI.
- Never swallow an error into an empty `catch`.

### 5.5 Hygiene
- **DRY, but only after the third repetition.** Two similar blocks are fine; three is
  an abstraction. Premature abstraction is worse than duplication.
- **YAGNI:** build what the current milestone needs (§1.4). No speculative hooks for
  M2 systems while M0's gate is unproven.
- Leave code cleaner than you found it, but keep refactors in separate commits from
  behavior changes.
- Delete dead code — version control remembers it.

---

## 6. Phaser-Specific Rules

- **Composition over inheritance** for game objects. Deep `Sprite` subclass chains are
  forbidden. A queue slot is `QueueSlotView` + data, not
  `class EnemySlot extends Slot extends Sprite`.
- Scene lifecycle is strict: `preload` loads assets only; `create` wires systems;
  `update(time, delta)` delegates to view code and **contains no game rules**. The sim
  does not advance in `update` — it advances when an action is committed.
- The UI is a **projection of sim state**. Views render from a `CombatState` snapshot
  and emit `Action`s; they never hold their own copy of a game number.
- **Every allocation is freed.** Event listeners registered in `create` are removed in
  `shutdown`. Tweens, timers, and emitters are destroyed with their owner. A leak
  across dozens of encounters per run is a crash.
- Use object pools for repeated transient views (damage numbers, queue slots, card
  faces). Never create/destroy per-frame objects in `update`.
- Animation and input timing are **delta-scaled milliseconds** and belong only to
  `/ui` and `/scenes`. They never influence sim outcomes — a player on a 144Hz display
  and one on 60Hz must produce identical event logs from identical inputs.
- Animations are skippable (GDD §15): every tween's outcome is already true in the sim
  before it plays. Skipping must never change a result, only how fast it is shown.
- Communicate between systems via a typed event emitter with a declared event map —
  not by holding references to sibling systems and calling into them.
- **Phaser 4, not 3** (GDD §20.5). Verify API specifics against current v4 docs; v3
  tutorials will mislead. The `/sim` split limits the blast radius of engine surprises.

---

## 7. Testing

- Every pure-logic module ships with unit tests: delay math, tie-breaking, Guard decay
  and absorption, status tick scheduling, Stagger falloff, Speed curve, Weave clamp,
  socket cost and floor, XP, pile transitions.
- Test behavior through the public API, not private internals.
- A bug fix starts with a failing test that reproduces it.
- Rendering and input are not unit-tested; keep the untestable surface thin enough
  that this is acceptable.

### 7.1 Sim-specific test obligations

- **Ghost preview equivalence.** For a generated set of states and legal actions, the
  projected queue from the preview must equal the actual queue after committing the
  action. This is the highest-value test in the codebase — it guards the game's core
  UX promise (GDD §4.2).
- **Tick invariants** (property tests): `next_act_tick` never decreases for an actor
  that just acted; Guard never exceeds 40 nor goes negative; Max HP never falls below
  the §6.1 floor; the Weave multiplier is always inside `[0.30, 2.00]`; no scheduled
  effect ever resolves at a tick earlier than the one it was scheduled for.
- **No-Phaser guard.** A test scans `/src/sim` imports and fails on any reference to
  `phaser`, `/ui`, `/scenes`, or `/run`.
- **P6 guard.** A test greps `/src/sim` for `setTimeout`, `Date`, `performance`,
  `Math.random`, and duration identifiers named in turns/rounds/ms, and fails on a hit.

### 7.2 Determinism and replay

- Same seed + same action sequence ⇒ identical `CombatState` and identical event log.
  Asserted by a stored golden log for a fixed scenario.
- Each PRNG stream is tested in isolation: consuming from `gemRoll` must not shift
  `combat`.
- Encounters are atomic and resumable from their start state (GDD §16) — a test
  replays an encounter from its serialized start and reaches the same end state.

### 7.3 Headless balance harness (GDD §19)

Once M0's sim exists, `/sim-harness` runs scripted policy agents (greedy-damage,
greedy-tempo, random) over many seeds without a browser. This is not a later luxury —
it is the reason the sim is pure, and it is the only way a solo developer balances
this system. Keep it runnable from the CLI and fast enough to do 10,000 seeds.

### 7.4 End-of-milestone browser verification

Unit tests cover the rules; they say nothing about whether the game still boots.
**Every milestone (and every sprint inside one) closes with an end-to-end run in a
real browser** before it is called done. Use **Brave** (any Chromium-based binary
takes the same flags).

Automated pass — start the dev server, then drive it headless:

```bash
npm run dev &                       # or: npm run build && npm run preview
brave --headless=new --disable-gpu --no-sandbox --enable-unsafe-swiftshader \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --enable-logging=stderr --v=0 --window-size=1280,720 \
  --screenshot=/tmp/cadence-boot.png http://localhost:8081/

# For an input-driven check, add --remote-debugging-port=9222 instead of
# --screenshot, then drive it over CDP (Input.dispatchMouseEvent for the hover
# preview, Input.dispatchKeyEvent for card selection + Page.captureScreenshot).
```

Headless Chromium renders on demand, which constrains what this pass can prove:

- The page is backgrounded after a few seconds and `requestAnimationFrame` drops to
  zero, freezing Phaser's loop. Keep it awake with the three `--disable-*`
  backgrounding flags above **and** a CDP `Emulation.setFocusEmulationEnabled` call.
- Even awake, software WebGL cannot hold 60fps, and `TimeStep.smoothDelta` clamps
  oversized deltas. The game runs in **slow motion**: simulated wall-clock time
  advances slower than real time. **Never assert an animation duration or frame count
  from a headless run.** Cadence's saving grace is that ticks are not wall-clock —
  sim assertions (queue order, Guard values, damage) are perfectly safe to make
  headlessly; only presentation timing is not.
- CDP virtual time (`Emulation.setVirtualTimePolicy`) does not drive Phaser's frame
  loop. It is not a workaround.

The automated pass passes only when **all** of these hold:

- The process exits `0` and writes a screenshot.
- The console shows the expected `Phaser v<version> (WebGL | Web Audio)` banner — a
  Canvas fallback means the renderer regressed.
- **Zero** console errors, warnings, or uncaught exceptions.
  `--enable-unsafe-swiftshader` keeps the headless software-WebGL notice out of that
  count; any other warning is fixed, or its benignness recorded in the closing commit.
- The screenshot shows what the sprint built, not an empty canvas — for M0 that means
  the 8-slot queue strip and a readable hand.
- Where the sprint added interaction, driving it over CDP produces the right sim
  result: hovering a card renders a ghost queue that matches the queue after playing
  it, and playing a Heavy card visibly slides the player later in the strip.

Manual pass — this is where feel is actually checked, because headless cannot measure
it and **M0's entire gate is feel**. Open the dev server and play: does hovering a
card make the consequence obvious? Does a Heavy card feel like a real decision? Is
Guard's decay readable against the queue? Anything that feels wrong is a finding even
when every test is green.

Record the outcome of both passes in the closing commit message. A failing browser run
blocks the milestone from being called done, exactly as a failing unit test blocks a
change.

---

## 8. Definition of Done

A change is complete only when all of these hold:

1. The change traces to a section of the GDD, and does not contradict it.
2. If the design changed, the GDD was updated in the same change and flagged.
3. `tsc --noEmit` passes with zero errors and zero new warnings.
4. Lint and format pass; no disabled rules added.
5. Tests for the touched logic pass, and new logic has new tests.
6. No `any`, no `!`, no `@ts-ignore`, no magic numbers, no dead code.
7. `/src/sim` still imports no Phaser, no DOM, and no ambient randomness or clock.
8. Every new duration is a `Tick` (P6), and every new player-visible number is
   readable from sim state rather than recomputed in the UI (P3, P5).
9. New behavior is data-driven where the GDD says it should be.
10. Nothing outside the requested scope, or outside the current milestone, was changed.

For a change that closes a milestone or sprint, one more holds:

11. The end-to-end browser verification in §7.4 passed, both automated and manual, and
    its outcome is recorded in the closing commit message.
