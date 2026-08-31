# M1 — Build Layer: Implementation Plan

**Milestone owner:** solo · **Budget:** 6–8 weeks (GDD §18) · **Status:** planned,
not started

**Traces to:** GDD §18 (M1 item list and gate), §6 (sockets and gems), §7 (the
Weave), §9 (materials), §12.2 (enemy resistance), §15.2 (the panel), §20
(architecture), §22 Q1/Q3/Q4/Q5, §23 (the anti-meta thesis this milestone tests).

---

## 1. What M1 is

> **Can two players, handed the same seed and the same deck, end up wanting
> different things?**

M0 proved the queue is a game. M1 asks whether the build layer on top of it
generates real divergence, or only decoration. The gate (§7) is a real stop
condition, exactly as M0's was.

### In scope

The five §18 items, plus four things they structurally require:

1. **Sockets** — §6.1: 0–3 per card, Max-HP cost, success rates, Scarred, the floor
2. **Gems** — §6.2: 10 frames × 4 tiers, rolled values, affixes
3. **Generative crafting** — §6.2: materials set Tier, the player picks the Frame,
   values roll, 1 Insight rerolls values
4. **The Weave panel** — §7, §15.2: one row per tag — glyph, name, final clamped
   multiplier, floor indicator
5. **Saturation** — §7.3: the 6-encounter window, +6/−5, cap 30%
6. *(required by 4)* **The tag taxonomy** — §7 multiplies per tag and the GDD never
   lists them (D15)
7. *(required by 4)* **Attunement** — §7.1: 2 Ascendant / 2 Suppressed, and the shift
   schedule
8. *(required by 4)* **Enemy resistance** — §7.2: the middle term of the formula
9. *(required by 1, 3, 5)* A minimal **run layer** — sockets, Saturation and
   Attunement are all run-scoped, and run state today is private fields on a Phaser
   scene

### Explicitly out of scope

Map, Depths, nodes, Sanctum, Market · gold, card removal, the §9 ledger · relics ·
XP, levels, Threat · riddles, wagers · elites and their hard immunity · bosses ·
save/resume · the second class, the other 11 archetypes · art and audio beyond what
the panel needs.

Same rule as M0: if a task here seems to need one of those, it does not — write the
smallest stand-in that lets the gate proceed, mark it `[M1 STAND-IN]` in the source
the way `CHAIN_SIZE` is marked today, and record it in §2.

---

## 2. Design decisions

Numbering continues M0's, so a code comment citing `D9` or `D21` is unambiguous
about which document to open. Decisions marked **GDD** are written into the GDD in
the same change, flagged `[AMD]` (CLAUDE.md §1.1).

| # | Gap | Decision | Recorded in |
|---|---|---|---|
| D15 | **There is no tag taxonomy.** §7 multiplies per tag; §6.2's example uses `["Multi","Physical"]` and §8.1's riddle says "Charge-tagged", but no list is ever authored. | **Six elemental tags, exactly one per card:** Physical, Fire, Frost, Arcane, Shadow, Storm. 2 Ascendant + 2 Suppressed out of 6 leaves two neutral, so a third of the deck moves on each roll — enough to force adaptation, not enough to brick (§7.4's concern). Mechanical words (Multi, Charge, Break) are **gem and frame vocabulary, not Weave tags**; they name what a gem does, and the Weave has nothing to multiply them by. | GDD §7 |
| D16 | **All twelve cards are `Physical`**, so the Attunement roll would touch everything or nothing. | Re-spread the deck across the six tags. M0's repeats were honest *because* class and reach were the only axes (`cards.ts:parseDeck` says so); the tag is a third axis, so distinct cards stop being cards you would never choose. The Weight curve stays 5 Light / 4 Standard / 2 Heavy / 1 Ultimate — that curve makes the Cooldown pile bite and it survived the gate. | GDD §5.1, here |
| D17 | **Weight and Recovery riders cannot be `Tick`.** §7.1 gives Ascendant −1 Weight and HASTE gives −Weight or −Recovery, but `tick()` throws on a negative — a `weightDelta: Tick` field fails at JSON load, not at combat time. | Riders are **signed `number`**, summed as numbers, clamped, and branded **exactly once** at the end of resolution. `WEIGHT_CLASSES` is never rewritten. `MIN_WEIGHT = 1`: Ascendant (−1) plus HASTE (−3) on a Light card (4) is 0, and a Weight-0 actor acts twice at the same tick and hangs `advanceToDecision`. | GDD §4.1 |
| D18 | **§6.1's Max HP floor is "40% of the level baseline" and there are no levels** (XP is M2). | Baseline is `PLAYER_MAX_HP` (70), so the floor is **28**. `[M1 STAND-IN]` — the constant becomes the level table's value when §5.1 lands in M2. | here |
| D19 | **No Insight source exists.** §8's Riddles, Wagers and bosses are M2–M3, but the 3rd socket and every reroll cost Insight. | Stand-in grants: clearing an encounter yields a material always and Insight sometimes, both tunable from the console. Tuned to hit §9's stated run totals — **5–7 sockets opened, 4–6 gems crafted** — across the six-encounter chain, so the gate reads a realistic build, not an abundant one. | here |
| D20 | **Materials have a taxonomy but no source.** §9 defines Shard/Core/Heart/Sigil and the 3-of-a-tier upgrade. | The **ladder and the upgrade rule are M1's**, because material rarity is what sets gem Tier (§6.2). Gold, the Market and card removal stay M2's. | GDD §9, here |
| D21 | **Attunement never shifts without Depths.** §7.1 re-rolls one Ascendant and one Suppressed at the start of Depth 2 and Depth 3. | M0's encounter chain is already the stand-in for §11's structure: six encounters, `CHAIN_SIZE` 2, three chains. Treat a chain as a Depth — shift at the start of chains 2 and 3, **exactly the two shifts §7.1 asks for**, each announced at the end of the preceding chain. | here |
| D22 | **Enemies have no resistances.** §7.2's `(1 − enemy_resist)` is the middle term of the formula and `EnemyArchetype` has no field for it. | Hand-author 0–60% per-tag resistance on the three M0 archetypes, **shown on the encounter banner before the fight starts** (§7.2: "always shown before you commit"). | GDD §12.2 |
| D23 | **GDD §22 Q3 — "are three sockets too many for legibility? May cap at 2."** | **Do not resolve it by writing code that assumes an answer** (CLAUDE.md §1.1). Build all three; make the cap a rule knob so the gate can compare 2 against 3 in play, the way M0 compared three Ultimate rules behind `U`. | GDD §22 Q3 |
| D24 | **GDD §22 Q4 — "Insight reroll cost of 1 is a guess. If rerolling is cheap, generative crafting collapses into deterministic crafting and P3 dies."** | Same treatment: the cost is a knob, and the gate measures rerolls-per-gem. This is the most direct threat to the milestone's own thesis, so it is instrumented rather than assumed. | GDD §22 Q4 |
| D25 | **GDD §22 Q1 — Ultimates.** M0 left it open: candidate (b), *grants Insight on kill*, could not be judged with no Insight system to reward. | There is one now. Add `insight` as a fourth `UltimateRule` and settle Q1 in M1's gate hour, then delete the losing branches and the `U` key as `docs/M0_GATE.md` §3 specifies. | GDD §22 Q1 |
| D26 | **GDD §22 Q5 — "does the player need any way to gain Max HP back?"** The only direction is down, and M1 is the milestone that makes it go down. | Ship without one and **measure it**: the harness reports Max HP at run end across seeds. If the D18 floor is hit routinely, the answer is yes and the GDD gets a decision. Answering before the data exists is guessing. | GDD §22 Q5 |
| D27 | **Two damage paths already disagree.** A wind-up Ultimate snapshots `damagePerTarget` at commit and skips `damageScale`; an immediate strike applies it. The Weave would double the divergence. | **One path.** `effects.ts:strikeOne` is deleted; both paths call the same `resolveHit` + `applyDamage`. A `PendingStrike` carries a `ResolvedCard`, not a number, and **resolves at impact** — `landStrike` already expands AoE targets at impact, so a snapshotted number was never a real snapshot. Consequence, and it is the right one: Empower applied *during* a wind-up now boosts the landing blow. Fixes the existing Empower/Weaken bug in the same change. | GDD §4.2, §4.5, §22 Q1 |
| D28 | **`damage_dealt` carries no tag**, and Saturation (§7.3) is a share of damage *by tag*. | Add `tag: Tag \| null` to `damage_dealt` (null for enemy intents). A member field does not break `format.ts`'s exhaustive switch, but printing it deliberately breaks the stored golden log — which is the signal you want when damage attribution changes. Re-bless once. Two genuinely new kinds, `gem_triggered` and `healed`, *are* compile errors in `format.ts`, which is the intended behaviour. | here |
| D29 | **§15.2 requires confirm dialogs on irreversible acts** — socketing, gem removal, card removal — in an undo-free design. | Socketing and gem removal get them in M1. Card removal is M2's (it costs gold). | GDD §15.2 |
| D30 | **No card is designated the signature.** §5.1 gives "4 starters + 1 signature" and §6.1 starts the player with one socket open on it; M0's deck has starters only. | Name one of the Standard cards the signature and open its socket at run start. Standard, not Light: the free socket should sit on a card the player actually reaches for, and §6.1's point is that the first two Depths must not be socketless. | GDD §5.1 |
| D31 | **Hard immunity cannot be `resist = 1.0`.** §7's clamp would raise `×0` to **×0.30**, silently turning "immune" into "70% resistant". | Model resistance as a union — `{kind:'resist', value}` or `{kind:'immune'}` — so the clamp cannot swallow it, and the multiplier is `0` iff immune. Elites are M2, but the *type* is authored now: retrofitting it after the clamp has shipped means auditing every call site. | GDD §7.2 |
| D32 | **Attunement rolls would consume the wrong PRNG stream.** §20.2 requires that changing one system does not reshuffle another; rolling Attunement off `map` or `gemRoll` breaks exactly that. | Add a fifth named stream, **`weave`**. And a shift must draw a **fixed number of times regardless of outcome** — a re-roll that loops until it picks a different slot makes the stream position depend on the result, so a resumed run diverges from a saved one. | GDD §20.2 |
| D33 | **Ten frames must not mean ten handlers.** CLAUDE.md §4.2's own example is `effectHandlers.register('EXTRA_STRIKE', fn)`, and §6.2's gem JSON is already `{frame, effects[], affixes[]}`. | **Frames are data; effect atoms are code.** A Frame is a crafting recipe in `frames.json` naming which atoms it rolls and their tier-scaled ranges. ~16 registered atoms cover all ten frames. An eleventh frame composed of existing atoms is **pure JSON, zero code** — strictly stronger than a handler-per-frame registry, where a new frame always costs a file. | GDD §6.2 |

M1 therefore retires **four** of GDD §22's six open questions (1, 3, 4, 5) and
leaves 2 and 6 where they are. That is not scope creep: all four are questions
*about* the build layer, and §22's own rule is prototype → decide → update the GDD
→ implement.

---

## 3. Architecture spine

New files marked `+`. The guards in `tests/architecture/` are unchanged and still
fail the build on any `/sim` → `phaser | /ui | /scenes | /run` import.

```
/src
  /sim
+   tag.ts          the six-tag taxonomy and its glyphs (D15)
+   weave.ts        Attunement, resistance, the §7 formula and its clamp
+   build.ts        Gem, Frame, Tier, BuildState — plain serializable data
+   gemEffects.ts   the effect-atom registry and CardModifier (D33)
+   standardEffects.ts  registers the ~16 atoms; the one composition point
+   resolve.ts      CardDefinition + gems + Attunement ⇒ ResolvedCard
+   strike.ts       ResolvedCard + defender + Weave ⇒ ResolvedHit; applyDamage
+   saturation.ts   the §7.3 fold — pure math, no history
    card.ts         `tags: readonly string[]` becomes `tag: Tag` (D15)
    state.ts        CombatState gains `build` and `weave`
    actor.ts        Actor gains `resistances`
    events.ts       damage_dealt gains `tag`; + gem_triggered, healed (D28)
    ids.ts          + GemId brand
    rng.ts          + 'weave' stream (D32)
    piles.ts        sendToCooldown takes a recovery, stops reading the card
    combat.ts       strikeAll resolves once; applyDamage moves to strike.ts
    effects.ts      strikeOne deleted — one damage path (D27)
  /data
+   frames.json     10 frames × 4 tiers: which atoms, and their roll ranges
+   affixes.json    the shared 20-affix pool
+   cards.m1.json   the deck, re-spread across six tags (D16)
    archetypes.ts   per-tag resistance on the three M0 archetypes (D22)
  /run              ← empty until now
+   RunState.ts     HP, Max HP, deck, sockets, gems, materials, Insight,
                    Attunement, Saturation history, every stream position
+   socket.ts       cost, success roll, Scarred, the Max HP floor (§6.1)
+   forge.ts        craft and reroll, on the gemRoll stream (§6.2)
  /ui
+   WeavePanel.ts   one row per tag: glyph, name, final multiplier, floor icon
+   ForgeScreen.ts  crafting and socketing — off the combat screen (P5)
    CardFace.ts     socket pips and the gem glyph
```

### 3.1 The Weave is math in `/sim`; its inputs are memory in `/run`

`weave.ts` exposes a **verdict**, not components — the final clamped multiplier,
whether the clamp bound, and the ±1 Weight rider. §7.4 requires a distinct icon
when the floor is active, which cannot be inferred from a number alone, and
CLAUDE.md §2.1 forbids the UI from multiplying. `weaveRows(weave, resistances)`
renders the whole panel in one call.

The snapshot lives on `CombatState` next to `rules`, for the reason `rules.ts`
already gives: a tuning value outside the state can make two identical states
behave differently. Resistances live on the **actor**, because an AoE hits four
enemies with four different tables and resolution is per-target anyway.

**The ±1 Weight rider never touches the delay math.** `speed.ts:actionDelay` and
`actor.ts:actorDelay` are untouched — they turn a Weight into a delay, and a Weight
*rider* is not their business. The rider is applied in `resolveCard`, before
anything calls `actionDelay`. The UI keeps calling `actorDelay`, but gets its
Weight from `resolvedWeight(state, card)` rather than `card.weight`.

### 3.2 Two resolution layers, because KINDLE forces the split

`resolveCard` is **target-independent**: damage before the Weave, strikes, effective
Weight and Recovery, Guard granted, the tag after a KINDLE conversion, BREAK's Poise
factor and Stagger bonus, SIPHON's share, ECHO's return.

`resolveHit` is **per-target**: it applies the defender's own Weave verdict and
`damageScale`, and yields the final `amount` plus the `poiseAmount` the §4.6 check
compares. `poise.ts` is unchanged — BREAK arrives as a different number passed in,
and its +Stagger arrives as `rules.firstStagger + staggerBonus`, which shifts the
whole 3→2→1 ladder and leaves the diminishing rule intact.

`applyDamage` moves from `combat.ts` to `strike.ts` and both paths call it.
`combat.ts` imports `effects.ts`; `effects.ts` does not import `combat.ts`; both
importing `strike.ts` introduces no cycle.

**Exactly two roundings, both in `/sim`, both visible on screen:** the existing AoE
round in `damagePerTarget` (the figure the card face prints) and one final round in
`resolveHit`. A test pins that there is no third.

**`previewAction` needs one additive field and no logic change.** It runs the real
reducer, so post-Weave numbers reach `ActionPreview.hits` for free — §15's "hovering
shows post-Weave damage, not base" is satisfied by construction. `PreviewHit` gains
`tag` only so the hover can say *why*.

### 3.3 The build lives on `CombatState` — and it is not a close call

```ts
readonly build: BuildState;   // gems, sockets keyed by card id, per-fight runtime
readonly weave: WeaveSnapshot;
```

`CombatSetup` takes both as optional-with-default, mirroring `rules?`, so every
existing test and the whole harness keep compiling.

The decisive argument is a fact about the code: **`previewAction` does not clone.**
It passes `state` straight to `reduce` and trusts the reducer not to mutate. If
CHARGE's charge counter lived in a closure or a module variable, *hovering a SPEND
card would spend a charge* — a preview-equivalence failure of exactly the kind
CLAUDE.md §7.1 calls the highest-value test in the codebase.

A pre-baked per-encounter catalogue was also rejected: it cannot bake KINDLE (the
number depends on which defender is hit), it cannot bake stateful frames, it would
make the save record derived numbers — CLAUDE.md §7.2 wants an encounter to replay
from its serialized start — and the harness would have to duplicate the bake, which
is a second arithmetic path.

**Determinism.** `BuildState` carries no `Rng` and no unrolled ranges. All rolling
happens in `/run` at craft time on the `gemRoll` stream and is baked into the gem as
fixed numbers. The sim consumes only constants, so `gemRoll` can never advance
during combat. Rolling is a run-layer act; applying is a sim-layer act.

### 3.4 The effect-atom registry (D33)

A handler receives the value rolled at craft time, the gem's per-fight runtime, and
the card or trigger — and **nothing else**. No `Rng`, no `CombatState`, no clock. It
*cannot* be nondeterministic and it cannot read another gem's state. The registry is
a module-level `Map`, which is fine: the ban on `Map` is on persisted shapes, and a
registry is not state.

Two phases, as a discriminated union rather than optional methods (§3.2): `modify`
handlers return a `CardModifier` that `resolveCard` folds in socket order; `react`
handlers fire on `played` / `hit` / `killed` and return the gem's new runtime plus
any heal or Guard.

The union forces a pattern that is a feature: **SPEND is two atoms**
(`SPEND_CHARGES` modify + `CONSUME_CHARGES` react), and so is **ECHO**
(`RETURN_TO_HAND` gated on `uses === 0`, plus `MARK_USED`). Composition happens in
the data layer, not in conditionals inside a handler. `parseGemCatalogue` rejects
any effect type not in the registry at load, naming the offending gem id (§5.4).

---

## 4. Sprint breakdown

Eight sprints, ~34 days. The riskiest thing is **not** the Weave formula — it is
unifying the two damage paths without breaking preview equivalence or the golden
log. That is S2, and S1 and S2 deliberately ship **before any gem exists**, so the
structural change is reviewable as a no-op.

A sprint is not done until its exit criterion holds and `typecheck`, `lint`, `test`
and `format:check` are clean (CLAUDE.md §8).

| # | Days | Scope | Exit criterion |
|---|---|---|---|
| **S1** | 3 | `Tag` union and glyphs, `weave.ts`, `Actor.resistances`, `CombatState.weave`, the deck re-spread across six tags (D16), enemy resistances (D22) | `weaveVerdict` matches §7 including the floor and immunity (D31); with a neutral Weave and no resistance the golden log is **byte-identical to M0's** |
| **S2** | 4 | **Strike unification.** `resolve.ts`, `strike.ts`, `PendingStrike.resolved`, `damage_dealt.tag`, `applyDamage` moved, `effects.ts:strikeOne` deleted (D27) | A wind-up and an immediate Ultimate deal identical damage under identical Empower — today's bug, now a test; preview equivalence green; golden log re-blessed exactly once |
| **S3** | 5 | Gem data, the atom registry, **modify-phase atoms only**; `BuildState` on state; `sendToCooldown(order)`; validating parsers in the `ParseResult` shape | A hand-authored loadout changes damage, Weight and Recovery identically in the reducer and in the hover; an unregistered effect type fails at load naming the gem id |
| **S4** | 4 | React-phase atoms: CHARGE, SPEND, ECHO, SIPHON, WARD, LINGER; `GemRuntime`; `gem_triggered` and `healed` events | Charges survive a `structuredClone` round trip; ECHO fires exactly once per fight; **previewing a SPEND card leaves the real state deep-equal** |
| **S5** | 4 | `RunState`, the `weave` stream (D32), the Attunement roll and the two D21 shifts, Saturation folded from the log, D19 grants; `CombatScene`'s run fields deleted | Same seed ⇒ same Attunement and same second shift; a mono-tag run reaches 30% Saturation and the panel's number falls to match |
| **S6** | 5 | Sockets and generative crafting in `/run`: the 8/12/18% table, 100/75/45%, Scarred, the D18 floor, tier → frame → roll → 1-Insight reroll | Property test: Max HP never below 28 over 10,000 random socket sequences; a failure spends HP, opens nothing, and sets Scarred once and never twice |
| **S7** | 4 | UI: the Weave panel, socket pips and gem glyphs on card faces, the Forge screen, confirm dialogs (D29) | Every on-screen number traces to a sim function; a scan of `/ui` finds no arithmetic on a game number |
| **S8** | 5 | Harness: build-aware policies, 10k seeds, §19's build-diversity metric; `dominatedCards()` learns about tags; settle §22 Q1/Q3/Q4/Q5; then the gate | The gate (§7) is run and answered; no frame in >40% of winning builds; the §7.4 browser pass recorded |

**First moment the build layer is visible: end of S6.** Everything before it is
structure, and it is deliberately front-loaded — if preview equivalence cannot
survive a single multiplier it will not survive sixteen atoms, and finding that out
on day 7 costs a week instead of a month.

---

## 5. Test obligations carried through M1

Per CLAUDE.md §7, present in the sprint that introduces the system:

- **Ghost-preview equivalence, extended** (S2, S4) — generated states now carry
  gems, a rolled Attunement, live Saturation, and **enemy lines with mixed
  resistances**, which is the M1-only divergence case: an AoE rounds per target
  against different multipliers.
- **Preview purity** (S4) — `deepFreeze` the state, run `previewAction` for every
  legal action, assert `structuredClone` equality afterwards. A frozen object turns
  an in-place write into a throw. This is what stops a hover spending a charge.
- Weave clamp as a property test: `multiplier === 0` iff immune, otherwise always
  inside `[0.30, 2.00]` (S1).
- Effective Weight ≥ 1 and Recovery ≥ 0 over every card × every authored gem up to
  three sockets (S3).
- Max HP never below the D18 floor over 10,000 random socket sequences (S6).
- Socket cost, success rates, and Scarred's non-stacking +50% (S6).
- Saturation: `attributeDamage` totals equal the player's own tagged damage and
  enemy hits contribute exactly zero; the +6 / −5 / cap-30 fold over a synthesised
  history (S5).
- **Socket order is stable** (S3) — `CardSockets.gems` is an array, never a record,
  because `convertTag` is last-wins and `damageMult` is a product. A test asserts
  `[A,B]` and `[B,A]` differ, and that each is stable across 1,000 repetitions.
- Determinism: a full encounter leaves `gemRoll` and `weave` stream positions
  untouched; a full run's `weave` position is a fixed constant for a fixed seed
  (catching D32's rejection-sampling trap).
- A golden event log for a fixed *socketed* scenario, alongside M0's.
- **A third architecture guard** (S3) — the `tests/architecture/scan.ts`
  infrastructure already exists; add a scanner that finds numeric literals in
  `src/sim/**` and `src/run/**` outside `export const` initialisers, allowing only
  `0`, `1`, `2`, `-1`. M1 roughly triples the tunable surface and CLAUDE.md §5.1's
  no-magic-numbers rule needs teeth to survive it.
- The two existing guards keep passing.

---

## 6. Milestone risks

| Risk | Watch for | Response |
|---|---|---|
| **The gate fails** — same seed, same builds | Both testers socket the same cards in the same order and craft the same frames | The destabilisers are named in §7 and §23: the shift schedule, the Saturation rate, the reroll cost. Move those before adding content. If they cannot move it, the anti-meta thesis is wrong and §23 is a fiction |
| **A handler mutates in place** | Hovering changes the board | The preview-purity test (§5), written in S4 alongside the first stateful atom, not after |
| **The Weave applied twice** | Damage that is the square of the multiplier off by a rounding | `damage_dealt.amount === round(base × multiplier × damageScale)` asserted on both Ultimate rules |
| Rerolling is too cheap and crafting goes deterministic (§22 Q4) | Testers reroll to a known-best roll | D24 — instrumented, and the cost is a knob at the gate |
| The panel needs the player to multiply | Any figure on screen that is the product of two others shown beside it | The sim returns a verdict, not components (§3.1) |
| Legibility collapses — six systems, two numbers (P5) | The panel, the forge and the queue competing for attention | §15.2's budget: new UI removes something or justifies its cost. The forge is not on the combat screen |
| Max HP death-spiral (§22 Q5) | Runs ending at the 28 floor | D26 — measured, not guessed |
| Scope creep into M2 | "the Market would make crafting make sense" | CLAUDE.md §1.4. The D19 stand-in grants exist precisely so it does not |

---

## 7. The gate

**GDD §18: two testers reach materially different builds from the same seed.**

**Protocol.** Both testers play the same seeded six-encounter chain to the end.
Their build snapshots — which cards carry sockets, which frames sit in them, which
tags they leaned on — are captured at run end and compared. Then the owner plays an
hour and answers the questions below.

*Materially different* is defined **before** the run, so the result cannot be talked
into passing:

- they socketed a **different set of cards**, and
- at least **half** their socketed frames differ, and
- their Saturation-dominant tag at run end differs.

Two of three is ambiguous; one or none is a fail.

The questions:

1. Did you ever *decline* to socket a card you could afford, and could you say why?
   (If never, the Max HP cost is not a cost and §6.1 has failed.)
2. Did the Weave panel change which card you played, or only explain it afterwards?
3. When a tag shifted between chains, did you change what you were building — or
   just take the damage?
4. Did you ever reroll a gem, and did the Insight it cost buy something? (§22 Q4)
5. Was the third socket worth 18% of your Max HP and a 45% chance? (§22 Q3)
6. Which frame did you never craft, and why?

**Pass:** the three material-difference criteria hold, and questions 1 and 2 are yes.
**Ambiguous:** the criteria hold but the panel only explained (2 is no) ⇒ a
Weave-legibility pass, then one re-run — the remedy M0's gate used.
**Fail:** the builds converge ⇒ the destabilisers are too weak. Fix §7's numbers
before building M2 on top of them.

Alongside the human gate, the harness answers §19's key metric directly: **build
diversity among winning runs — if the top 3 frame/card combinations account for more
than 35% of wins, the thesis is failing.** It is the early warning two testers
cannot give.

Recorded in `docs/M1_GATE.md`, in the format `docs/M0_GATE.md` established.

---

## 8. Verification

Per CLAUDE.md §8, every sprint closes green on all of these; the milestone
additionally closes on §7.4's browser pass.

```bash
npm run typecheck     # tsc --noEmit, zero errors
npm run lint          # no new disabled rules
npm run test          # vitest run — includes all three architecture guards
npm run format:check
npm run sim -- --report --seeds=2000   # balance report, now with build diversity
```

**Headless browser pass** (CLAUDE.md §7.4), at the end of each sprint that touches
the screen:

```bash
npm run dev &
brave --headless=new --disable-gpu --no-sandbox --enable-unsafe-swiftshader \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --enable-logging=stderr --v=0 --window-size=1280,720 \
  --screenshot=/tmp/cadence-m1.png http://localhost:8080/
```

Passes only when the process exits 0, the console shows the `Phaser v4 (WebGL | Web
Audio)` banner, there are **zero** console errors or warnings, and the screenshot
shows what the sprint built. Kill Brave and vite **by PID** afterwards — `pkill -f`
kills the shell itself.

Driven over CDP (`--remote-debugging-port=9222` in place of `--screenshot`, plus
`Emulation.setFocusEmulationEnabled`), the M1-specific assertions are:

- Hovering a card with a gem in it shows a ghost queue and a damage figure that
  **match the committed result exactly** — M0's assertion, now with the build layer
  in the path.
- The Weave panel's number for a tag equals the sim's verdict for that tag, and the
  floor indicator is on exactly when the clamp bound.
- A socket attempt at the Max HP floor is refused, and says why.

Never assert animation durations from a headless run — software WebGL runs the page
in slow motion. Sim assertions are safe; presentation timing is not.

**Manual pass.** M0's gate was feel; M1's is *divergence*, and that is equally
unmeasurable headlessly. Play the chain twice from the same seed, deliberately
making different calls, and see whether the two builds end up wanting different
cards — or whether the Weave is decoration on a fixed best line.

Record both passes in the closing commit (CLAUDE.md §8.11).
