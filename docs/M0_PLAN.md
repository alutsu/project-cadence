# M0 — Feel Test: Implementation Plan

**Milestone owner:** solo · **Budget:** 4–6 weeks (GDD §18) · **Status:** S0–S8 complete — the gate is ready to run (docs/M0_GATE.md) — the M0 thesis is testable

**Traces to:** GDD §18 (M0 item list), §4 (all of combat), §20 (architecture), §22 Q1
(Ultimates — scheduled for resolution here), §21 Risk 1 (fatal risk this milestone exists
to retire).

---

## 1. What M0 is

M0 answers exactly one question:

> **Is moving your position in the turn queue fun by itself?**

Everything in this plan exists to put that question in front of a player in a real
browser as fast as possible, at high enough fidelity that the answer is trustworthy.
The gate (§7) is a real stop condition, not a formality.

### In scope

The seven §18 items, plus three things they structurally require:

1. Tick scheduler + visible 8-slot queue
2. Hand, one card per turn, Weight moves the queue
3. **Ghost preview on hover** ← the whole game
4. Cooldown pile returning cards by tick
5. Guard with 1/tick decay
6. Poise/Stagger with diminishing returns
7. Three enemies with real intents
8. *(required by 2)* The **Wait** action — GDD §4.3; without it the hand can deadlock
9. *(required by 7)* Tick-scheduled **statuses** — the M0 enemies apply Poison and Slow
10. *(required by 9)* The **Speed curve** of §4.7 — Slow changes `effective_speed`, so the
    delay math needs the real formula, not a placeholder

### Explicitly out of scope

Map, Depths, nodes, Sanctum, Market · gems, frames, sockets, crafting, Insight ·
the Weave, Attunement, Saturation, resistances · economy, gold, materials, relics ·
XP, levels, Threat · riddles, wagers · save/resume · run structure and death handling ·
art and audio (the §15.1 framing is built with placeholder shapes), juice beyond what legibility requires · the second class, the other 11
enemy archetypes, all bosses.

If a task in this plan seems to need one of those, it does not — write the smallest
constant that lets the feel test proceed and note it.

---

## 2. Design decisions — resolved 2026-08-29

Ten gaps and one outright contradiction surfaced while planning M0. All are decided.
The eight that are **rules** were written into the GDD in the same pass, flagged
`[AMD]`; the two that are **M0-only choices** live here.

| # | Gap | Decision | Recorded in |
|---|---|---|---|
| D1 | **No authored card table.** §5.1 promises a fixed table and §17 budgets 16 skills, but none are written. | Provisional **12-card M0 deck** in `src/data/cards.m0.json` — 5 Light / 4 Standard / 2 Heavy / 1 Ultimate. Nothing in that file is a design commitment; what survives the gate is promoted into §5.1. | GDD §5.1 |
| D2 | **Poise is contradictory.** §4.6 calls it a *threshold* a single hit must meet; §4.8 and the BREAK frame call it *Poise damage* that accumulates. | **Threshold.** Poise never depletes, chip damage never staggers. BREAK restated as "+% damage counted for the Poise check". AoE checks each enemy against its own reduced damage. | GDD §4.6, §4.8, §6.2 |
| D3 | **Wait's Recovery is unspecified** (§4.3). | Wait is an action, not a card: no Cooldown entry, delay `ceil(3 × 100 / effective_speed)`. **No anti-spam rule** — Guard's 1/tick decay is the limiter. If turtling appears at the gate, the fix is rising Weight on consecutive Waits. | GDD §4.3 |
| D4 | **Hand overflow undefined** (hand cap 6, draw 1/turn). | Draw is **skipped**; the card stays on top of the draw pile. No discard, no reorder — no card is ever silently lost. | GDD §4.1, §4.3 |
| D5 | **Tie-break Speed is ambiguous** (§4.1 "higher Speed"). | **Effective** Speed, then lower actor index. Player is index 0 and wins mirror ties. Makes a well-timed Slow visibly flip the order. | GDD §4.1 |
| D6 | **Do enemies have Guard?** | Yes — Guard is a property of any actor. One damage pipeline. No M0 or v1 enemy actually gains Guard, so the gate is unaffected. | GDD §4.4 |
| D7 | **Bleed's magnitude decay** is unspecified (§4.5). | No decay; expires on duration. Poison punishes existing, Bleed punishes acting — Bleed scales with the victim's Speed, Poison deliberately does not. Built in S5, dormant in M0. | GDD §4.5 |
| D8 | **Draw decoupling above Speed 140** (§4.7) needs a countable unit. | Count **the actor's own committed actions**; draw on even-numbered ones. Local to the actor, survives queue reordering, introduces no shared turn counter (P6). Unreachable in M0. | GDD §4.7 |
| D9 | **How is damage computed with no Weave?** (M0-only) | **Flat**: card base value plus Empower/Weaken. Tags exist in the JSON as inert labels and multiply nothing. M0 measures the queue and nothing else; the Weave slots in at M1 as one function in the pipeline. | here |
| D11 | **Effective Speed has no lower bound** (§4.7), but the delay formula divides by it — enough Slow means division by zero. Found while implementing S1. | Floor at **20**, one fifth of base: punishing, still playable, never degenerate. | GDD §4.7 |
| D12 | **No opening hand size** (§4.9). §3 draws 1 per turn, which opens an encounter holding one card. | **Five** — one under the hand cap, so the first turn's draw is a real draw and not one skipped against a full hand. | GDD §4.9 |
| D13 | **Is Wait's draw the turn draw, or an extra?** (§4.3 vs §3). | **Extra.** The relic *Second Wind* ("Wait draws 2 instead of 1", §10) reads on the same understanding. Wait trades tempo for cards. If too strong at the gate, the lever is its Weight. | GDD §4.3 |
| D14 | **Is the deck shuffled at encounter start?** (§4.9 forbids reshuffling but is silent on the initial order.) | **Yes**, from the seeded `combat` stream. The no-reshuffle rule governs the Cooldown pile mid-encounter, not the initial deal. | GDD §4.9 |
| D10 | **Who plays the gate hour?** (M0-only) | **You, then one outsider.** You play the hour and answer the six questions; then one person who has not read the GDD plays 20 minutes cold. Their confusion is the signal the author cannot generate. | here, §7 |

**Open question 1 (Ultimates, §22)** is deliberately *not* resolved here — it is an M0
experiment, run in S8 with all three candidates behind a runtime toggle. See §4 S8.

---

## 3. Architecture spine

Per GDD §20 and `CLAUDE.md` §2. M0 builds this much of it:

```
/src
  /sim                    ← zero Phaser, zero DOM, zero ambient clock/randomness
    tick.ts               branded Tick + arithmetic
    rng.ts                seeded PRNG, named streams ('combat' only in M0)
    ids.ts                branded ActorId / CardId
    timeline.ts           min-heap on next_act_tick; seeding; tie-break
    speed.ts              effective_speed curve, delay math (§4.7, §4.1)
    state.ts              CombatState + readonly shapes
    actions.ts            Action union: play | wait | target
    combat.ts             reducer (State, Action) => { state, events }
    effects.ts            tick-scheduled statuses, Guard decay, cooldown returns
    poise.ts              Stagger threshold + diminishing ladder
    piles.ts              draw / hand / cooldown transitions
    intents.ts            enemy intent selection (pure, Rng-injected)
    events.ts             CombatEvent discriminated union
    forecast.ts           8-slot queue projection + ghost preview
  /data                   cards.m0.json, enemies.m0.json (validated on load)
  /scenes                 BootScene, CombatScene (wiring only)
  /ui                     QueueStrip, Hand, CardFace, ActorPanel, GuardMeter
  /sim-harness            headless driver + a random-policy agent
```

Two guard tests exist from S0 and never go green-to-red silently:
`no-phaser-in-sim.test.ts` (import scan) and `no-wallclock-in-sim.test.ts`
(`Math.random` / `Date` / `performance` / `setTimeout` scan).

---

## 4. Sprint breakdown

Eight sprints. Each lists its exit criteria; a sprint is not done until they hold and
`tsc --noEmit`, lint, and tests are clean (`CLAUDE.md` §8).

### S0 — Scaffolding (2 days)

Vite + TypeScript strict + Phaser **4.2.1** + Vitest + ESLint/Prettier. `tsconfig.json`
with the full §3.1 flag set. Folder skeleton above. Both architecture guard tests, each
proven by a deliberate temporary violation. A `BootScene` that renders one line of text.
`npm run dev`, `build`, `test`, `typecheck`, `lint`, `sim` scripts.

**Exit:** headless browser pass (`CLAUDE.md` §7.4) shows the Phaser v4 WebGL banner and
zero console output; guard tests fail when violated and pass when not.

### S1 — The scheduler (4 days)

The heart. Pure sim, no rendering yet — driven entirely by tests and a CLI dump.

- `Tick` brand and arithmetic; `Rng` interface + seeded implementation with named streams.
- `Timeline`: min-heap on `next_act_tick`, seeding at `ceil(600 / speed)` (§4.1),
  tie-break by effective Speed then actor index (D5).
- `speed.ts`: `effective_speed` curve with the 140 soft cap and 180 hard cap (§4.7),
  `delay = ceil(weight × 100 / effective_speed)` (§4.1), draw decoupling rule (D8).
- `CombatState`, `Action` union, and the reducer's skeleton: `play` and `wait` (D3)
  reschedule the actor and emit events. Damage is a flat number for now.
- A stub enemy that acts on a fixed Weight so the queue actually interleaves.
- `sim-harness`: `npm run sim -- --seed=N` prints the first 30 ticks as text.

**Exit:** player at SPD 100 seeds to tick 6 and a rat at 130 to tick 5; a Heavy card
(W10) puts the player behind two rat actions and the printed order proves it; determinism
test (same seed + same actions ⇒ identical event log) passes.

### S2 — Queue strip and hand on screen (4 days)

- `CombatScene` wiring only; `QueueStrip` renders 8 slots from `forecast.ts`, with the
  actor's mark, its name, and the tick each slot lands on. The player's slots use the
  held-card token, not a portrait — the player has no avatar (GDD §15.1).
- **Layout follows GDD §15.1**: first-person framing, hand held along the bottom of the
  frame, enemies facing the camera above it, queue strip across the top. In M0 that is
  flat rectangles, silhouettes, and type — placeholder shapes, no art (§1, out of scope).
  The framing is a layout decision and costs nothing now; getting it wrong later costs a
  rewrite of every view's coordinate assumptions.
- `Hand` + `CardFace`. **Weight and Recovery are as prominent as damage** (§15) — if the
  player has to hunt for Weight, the pillar fails and the sprint is not done.
- Click a card to play it; click to target; the strip re-renders from the new state.
- Provisional 12-card deck (D1) loaded from JSON through a validating parser.
- Wait button, always enabled.

**Exit:** a human can play cards against the stub enemy for two minutes in a browser and
watch the strip reorder. Screenshot shows a populated strip and a readable hand.

### S3 — Ghost preview (4 days) ← the sprint that matters

- `forecast.ts` exposes `previewAction(state, action)`: clone, reduce, project 8 slots,
  discard. **One code path with the real reducer** — no estimator (`CLAUDE.md` §2.2).
- Hovering a card renders the projected queue in ghost form over the live strip: which
  slots move, how far, which enemy actions now land before your next turn.
- Hovering also shows post-modifier damage against the current target (§15) — in M0 that
  is pre-Weave, but the value comes *from the sim*, never from UI multiplication.
- Ghost-preview equivalence test (`CLAUDE.md` §7.1): over generated states × legal
  actions, preview queue == post-commit queue. This is the highest-value test in the repo.

**Exit:** CDP hover over each card produces a ghost strip that matches the committed
result exactly; the equivalence test passes across ≥500 generated cases.

### S4 — Piles and Cooldown (3 days)

- Draw / hand (cap 6, D4) / Cooldown pile with `return_tick = now + recovery` (§4.9).
- Returns resolve in the scheduler at their tick, to the **bottom of the draw pile**.
- Empty draw pile on a draw = draw nothing. **No early reshuffle** — the wait is the cost.
- Cooldown pile visible in the UI with each card's return tick, so the wait is legible.
- Wait's real purpose becomes playable: waiting to bring a key card back.

**Exit:** a Heavy card (Recovery 26) is provably unavailable for 26 ticks and its return
is visible in the UI beforehand; a hand of all-cooldown cards auto-Waits after 1.5s (§4.3).

### S5 — Guard, damage, and statuses (5 days)

- Damage pipeline: Guard absorbs before HP, on every incoming hit (§4.4).
- Guard decays **1 per tick** in the scheduler, caps at 40, never negative.
- `GuardMeter` renders Guard *against the queue* — the player must be able to read
  whether Guard survives to the enemy's next action. That readability is the feature.
- `effects.ts`: tick-scheduled statuses — Poison (5-tick clock, −1 per proc, ignores
  Guard), Burn, Bleed (D7), Slow/Haste (modifies `effective_speed`), Weaken/Empower,
  Brittle. All resolve in the timeline, never in actor turns (§4.5).
- Property tests for the §7.1 tick invariants.

**Exit:** 12 Guard demonstrably absorbs one big hit *or* survives 12 ticks; Poison on the
player procs on its own 5-tick clock regardless of the player's Speed (the §4.5
clarification), proven by a test at SPD 100 and SPD 160.

### S6 — Poise and Stagger (3 days)

- Poise as a threshold (D2). A hit at or above it applies Stagger: `next_act_tick += 3`.
- Diminishing ladder per enemy per encounter: 3 → 2 → 1 → 1 → 1, floor 1 (§4.6).
- AoE applies the Poise check to each enemy independently at 60% damage (§4.8).
- The strip animates the staggered actor sliding later — this is the game's payoff moment
  and deserves the one piece of real juice in M0.

**Exit:** staggering the Warden four times in one encounter yields +3, +2, +1, +1 and the
strip shows each; a test asserts the ladder resets between encounters.

### S7 — Three enemies with real intents (5 days)

Chosen to exercise the whole spine (§12.2):

| Enemy | SPD | Teaches |
|---|---|---|
| **Poison Rat** | 130 | Fast chip, low Poise — free Stagger practice, and DoT on its own clock |
| **Warden** | 70 | Huge Poise, telegraphs a Weight-16 hit — the Stagger puzzle and the reason to read 8 slots ahead |
| **Chime Adept** | 115 | Applies Slow, punishes Heavy cards — makes Speed changes felt in the queue |

- `intents.ts`: each enemy telegraphs its next action *including its Weight*, so the
  8-slot forecast stays honest (§4.2). Intent icons and damage numbers on the strip.
- Targeting per §4.8: 1–4 enemies, sticky target, auto-advance on kill, click to change.
- Enemy scaling formulas (§12.1) implemented with level fixed at the M0 constant; Speed
  never scales, by rule.
- 4–6 hand-built encounters mixing the three, including one 3-enemy fight.

**Exit:** every enemy action visible on the strip before it happens matches what actually
happens; a full encounter is winnable and losable; the Warden's wind-up creates a real
"stagger it or eat it" decision.

### S8 — Feel pass, the Ultimate experiment, and the gate (5 days + play time)

- **Ultimates (GDD §22 Q1).** Weight 16 = four rat turns for one card. Build all three
  candidate rules behind a runtime toggle and play each for 20 minutes:
  **(a)** cast from the Cooldown pile with a wind-up the queue displays;
  **(b)** grants Insight on kill *(only a proxy in M0 — no Insight system exists to measure)*;
  **(c)** capstone-only with a Weight refund on kill.
  Decide, write the answer into GDD §22 and §4.1, delete the losing branches.
- Tuning console: live-edit Weights, Recovery, Guard cap/decay, Poise thresholds without
  a rebuild, so the hour of play can chase the feel instead of the compiler.
- Animation skip toggle (§15); confirm skipping never changes a sim result.
- Instrumentation for the gate (§7 below).

**Exit:** the gate is run and answered.

---

## 5. Test obligations carried through M0

Per `CLAUDE.md` §7, present by the sprint that introduces the system:

- Delay math, seeding, tie-breaks (S1) · determinism + golden event log (S1)
- **Ghost-preview equivalence** (S3) — the one that guards the core UX promise
- Pile transitions, no-early-reshuffle, hand overflow (S4)
- Guard absorption/decay/cap, Poison's independent clock, status scheduling (S5)
- Stagger ladder and per-encounter reset (S6)
- Intent honesty: telegraphed Weight == executed Weight (S7)
- Tick invariants as property tests, throughout
- The two architecture guards, from S0

---

## 6. Milestone risks

| Risk | Watch for | Response |
|---|---|---|
| **The gate fails** (GDD Risk 1, *fatal*) | Queue manipulation reads as bookkeeping, not tactics | Stop. Do not build M1 hoping gems rescue it. The GDD is explicit: gems decorate, they do not save |
| Ghost preview desyncs from the reducer | Any "fast path" that recomputes instead of reducing | Forbidden by construction (§2.2); the equivalence test is the tripwire |
| Guard's numbers are wrong (GDD Q6) | Fights trivial or brutal; Guard always full or always irrelevant | Tuning console in S8; cap and decay are config, not literals |
| Ultimates stay unplayable | Never played in the feel hour | That *is* the answer — resolve Q1 toward (a) or (c), or cut Weight 16 from M0's deck |
| Scope creep into M1 | "While I'm here, a socket would be easy" | `CLAUDE.md` §1.4 — it would not be easy, and it would contaminate the gate |
| Provisional cards flatter the design | Deck is tuned until anything feels good | The gate is judged on queue manipulation, not on card power |

---

## 7. The gate

**Protocol.** One uninterrupted hour of play, no gems, on the S8 build, answered in
writing. Then **one outsider who has not read the GDD plays 20 minutes cold** (D10) and
is asked questions 3, 4, and 5 unprompted — you already know what the queue means, so
your own answer to "is it legible" is not evidence.

The six questions:

1. Did you ever choose a *weaker* card because of where it left you in the queue?
   (If never — Weight is not a cost and P1 has failed.)
2. Did you use Wait deliberately, for a reason you could state? (§4.3 is a tactic or it
   is a crutch.)
3. Did the ghost preview change a decision, or only confirm one you had made?
4. Could you tell, before acting, whether your Guard would survive the next enemy hit?
5. Did the Warden's wind-up produce tension?
6. Which card did you never play, and why?

**Pass:** questions 1, 3, and 4 are yes, and 2 is yes at least a few times per
encounter — and the outsider reaches yes on 3 and 4 without being taught the queue.

**Ambiguous:** 1 and 3 yes but 4 no ⇒ Guard's presentation is the problem, not the design.
Re-run the gate after a Guard-readability pass. One re-run only.

**Fail:** 1 or 3 is no ⇒ the core is not fun. Stop and reconsider before M1 (GDD §18).

Record the answers in `docs/M0_GATE.md` and in the closing commit, with the browser
verification outcome (`CLAUDE.md` §7.4).

---

## 8. Schedule

| Sprint | Days | Cumulative |
|---|---|---|
| S0 Scaffolding | 2 | 2 |
| S1 Scheduler | 4 | 6 |
| S2 Queue + hand | 4 | 10 |
| S3 Ghost preview | 4 | 14 |
| S4 Piles + Cooldown | 3 | 17 |
| S5 Guard + statuses | 5 | 22 |
| S6 Poise + Stagger | 3 | 25 |
| S7 Three enemies | 5 | 30 |
| S8 Feel pass + gate | 5 | 35 |

≈ 7 working weeks at 5 days, ≈ 5 calendar weeks at 7 — inside the GDD's 4–6 week window
if the days are full, and the ordering is such that a slip in S5–S7 still leaves S3's
result (the actual thesis) already proven.

**First playable moment: end of S2 (day 10). First honest answer to the M0 question:
end of S3 (day 14).** Everything after that is making the answer trustworthy.
