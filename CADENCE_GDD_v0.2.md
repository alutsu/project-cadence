# CADENCE — Game Design Document
### v0.2 — supersedes v0.1
#### Amended 2026-08-29 — M0 decisions [AMD]

**Engine** Phaser v4 (TypeScript) · **Team** Solo · **Run length** 33–35 min

**What changed from v0.1:** two math errors corrected (§7.4 Weave floor, §6.1 HP economy), five missing systems specified (defense, status timing, targeting, the Wait action, the full economy), and the production sections a solo developer actually needs added (§15–§19). Changes are flagged **[FIX]** or **[NEW]**.

**Amendment 2026-08-30 (flagged [AMD]):** the M0 feel pass found the encounter set unthreatening — spamming the leftmost card in hand cleared it without dying. Three causes, all recorded here: HP was not persisting between encounters as §4.10 requires (an implementation bug); fights ran 2–5 decisions against an eight-slot forecast, so there was no future to plan toward (§12.2); and multi-enemy encounters were composed as if a second enemy cost only its own HP (§12.2). §4.10 gains M0's Sanctum stand-in; §12.2 gains the composition rules the retune established. Balance numbers themselves stay in data and stay provisional.

**Amendment 2026-08-29 (flagged [AMD]):** eight gaps and one contradiction found while planning M0 are resolved in-place — the Poise model (§4.6/§4.8/§6.2), tie-break Speed and hand overflow (§4.1), Wait's cost (§4.3), enemy Guard (§4.4), Bleed's decay (§4.5), the draw-decoupling counter and a Speed floor (§4.7), the piles (§4.9: opening hand, shuffling, return timing), and the provisional M0 deck (§5.1) — and the game's presentation is specified for the first time (§15.1: first-person, cards held in hand, enemies facing the camera). See `docs/M0_PLAN.md` §2. Open question 1 remains open by design and is scheduled for M0's S8.

---

## 1. Pitch

You are one adventurer descending a collapsing dungeon. You do not choose your cards — your class grants them as you level, the same ones every run. What you choose is what you carve into them.

Every skill card has sockets. Sockets are scarce and paid for in permanent maximum HP. Gems are not authored, they're rolled from scavenged materials, ARPG-style. Removing a gem destroys it.

Combat has no energy. Every card costs **time**. Play a heavy skill and the turn queue slides — the rat gets two actions before you act again. The queue is visible eight turns ahead, so this is a planning puzzle, not a gamble.

And the world's rules move. Each descent, some tags are Ascendant and others Suppressed, and the alignment shifts as you go deeper. There is no build to look up, because the correct build didn't exist until the run generated it.

**Hook:** *A deckbuilder where the cards are fixed, the time is the mana, and the meta is rerolled every run.*

---

## 2. Design pillars

**P1 — Time is the only cost.** No energy. Every card has a Weight in ticks. "Strong" and "fast" are incomparable by construction, so neither can be strictly better.

**P2 — The deck is given; the build is earned.** Card acquisition is deterministic. All expression flows into sockets and gems, where commitment is permanent.

**P3 — Value is unstable, not hidden.** The player always sees how good each tag is *right now*. They can't know it in advance, and it changes mid-run.

**P4 — Creativity is paid, not permitted.** Experimentation has its own currency.

**P5 — Legibility above all.** Six systems, two numbers on screen.

**P6 — Everything is measured in ticks. [NEW]** Damage over time, buffs, defense, cooldowns, and card recursion all use the same unit as the turn queue. No system in this game may use "turns" or "rounds" as a duration, because turns are asynchronous and per-actor. This is a hard architectural rule, not a preference — v0.1 violated it implicitly and it would have produced incoherent status effects.

---

## 3. Core loop

```
DESCEND → pick 2 of {Dungeon, Sanctum, Market} → Boss → Weave shifts → next Depth

  DUNGEON  3–4 encounters → XP, gold, materials, relic chance
  SANCTUM  heal OR craft (never both)
  MARKET   gold: remove cards, buy relics/materials, attempt sockets
```

Per encounter:

```
Timeline advances → lowest next_act_tick acts
  Player: draw 1 → play 1 card (or Guard) → card enters Cooldown → reschedule by Weight
  Enemy:  execute telegraphed intent → reschedule
  Between: tick-based effects resolve (DoT, Guard decay, buff expiry, Cooldown returns)
```

---

## 4. Combat: Conditional Turn Battle

### 4.1 The timeline

Integer tick counter. Each actor holds `next_act_tick`. Lowest acts; ties → higher Speed → lower actor index. **[AMD]** The tie-break uses **effective** Speed, i.e. after Slow and Haste, so a Slow landing before a contested tick genuinely changes the order. The player is actor index 0 and therefore wins a mirror tie.

```
delay = ceil(action.weight * 100 / actor.effective_speed)
actor.next_act_tick = now + delay
```

**Combat start [NEW]:** all actors are seeded at `next_act_tick = ceil(600 / speed)`. Faster actors act first; no coin flip. Player Speed 100 → tick 6; rat at 130 → tick 5.

| Stat | Player start | Notes |
|---|---|---|
| Speed | 100 | Capped, see §4.7 |
| Max HP | 70 | +6 per level → 136 at cap |
| Hand cap | 6 | Drawing into a full hand is skipped **[AMD]** |
| Draw | 1 per turn | |

**Weight classes**

| Class | Weight | Delay @ SPD 100 | Recovery |
|---|---|---|---|
| Light | 4 | 4 | 8 |
| Standard | 6 | 6 | 14 |
| Heavy | 10 | 10 | 26 |
| Ultimate | 16 | 16 | 60 |

**[AMD] Weight is resolved per play, never stored.** §7.1's Attunement moves it
by a tick and a gem's `weight_delta` moves it further, so the class table above
is a *base* rather than an answer. Riders are summed on top of it at the moment
a card is played and the result is floored at **1**: a Weight of 0 is a delay of
0, and an actor that acts again on the tick it just acted never stops. The class
table is never rewritten.

### 4.2 The visible queue

Next **8** turn slots render as a strip at the top of combat. Enemy intents are telegraphed, so their next Weight is known and the forecast is honest.

Hovering a card **re-renders the queue in ghost form**. This is the core UX of the entire game; build it first (§18).

### 4.3 The Guard action [NEW]

**[AMD 2026-08-31] It was called Wait.** The name stated the cost and not the
point: the action is Weight 3, **draw 1, and put Guard up**, and a playtester
reported that "Wait" communicated none of that. It is called **Guard**, which is
also what it grants — the word does double duty deliberately, because "I guard"
→ "I gain Guard" is the shortest possible path from the button to the rule. The
one thing lost is the reading of it as a pure tempo play, which nobody was
making anyway.

**Gap in v0.1:** the player could be forced to play a bad card, or hold a hand of cards all on cooldown with no legal action.

The player may always **Guard**: Weight 3, draw 1, gain 3 Guard. It is a real tactic — letting a key card come off Cooldown, or ducking under an enemy's wind-up so their big hit lands while you're already recovering. If the hand is empty and no card can be played, it is auto-selected after a 1.5s beat.

**[AMD] The draw is an extra one.** §3's loop already draws 1 at the start of every player turn, so this action's "draw 1" is a second card, not a restatement of the first. The relic *Second Wind* (§10) reads "the Guard action draws 2 instead of 1" on the same understanding. It therefore trades tempo for cards and defence, which is what makes it a tactic rather than a pass. If it proves too strong, the lever is its Weight, not its draw.

**[AMD] Its cost and limits.** It is an action, not a card: it enters no Cooldown pile and reschedules by the standard `ceil(3 * 100 / effective_speed)`. There is **no anti-spam rule**. **[AMD 2026-08-31]** That rested on 3 Guard barely outrunning a 1-per-tick decay, which §4.4 has now changed to one per three ticks — so repeated Guarding banks more than it used to and turtling is worth watching for. The lever remains a rising Weight on consecutive uses rather than a special-case restriction.

**[AMD] Drawing into a full hand** (§4.1, hand cap 6) is **skipped**: the card stays on top of the draw pile and nothing is discarded. A full hand means the draw is waiting for you — holding cards has a cost, and no card is ever silently lost.

### 4.4 Defense: Guard [NEW]

**[AMD 2026-08-31] Guard decays one point every three ticks, not one per tick.**
v0.2's rate made Guard arithmetic that never mattered: the Guard action grants
3, so it was gone in three ticks of a forty-tick fight. Three consecutive
playtests recorded Guard absorbing **nothing** in 23 of 25 and then 8 of 9
fights — §4.4 makes Guard the game's only mitigation, so one of the six systems
was inert while looking implemented. `docs/M0_GATE.md` §4 predicted this in as
many words ("3 Guard gained at t6 is 0 Guard at t9") and M0's gate question 4
answered *no* on the strength of it.

The decay is computed from **absolute ticks** rather than a running total —
`floor(to / 3) − floor(from / 3)` — so it sums correctly however finely the
scheduler advances. A per-advance `floor(elapsed / 3)` would round three
separate one-tick steps down to nothing each time and Guard would never fall off
at all.

This is §22 Q6 answered on evidence rather than closed by assumption; the cap of
40 remains untested.

**This was the largest hole in v0.1** — the document had no mitigation system at all, and StS-style Block ("expires at start of your turn") is incoherent when turns are asynchronous and one actor may take three turns to another's one.

**Guard is time-shaped.** Gaining *N* Guard means: absorb up to *N* damage, and Guard **decays by 1 per tick**.

- 12 Guard is 12 ticks of protection, or one big hit, whichever comes first.
- Guard is checked and consumed before HP on every incoming hit.
- Guard does not stack past **40**.
- **[AMD] Enemies use the same Guard system.** Guard is a property of any actor, not a player mechanic, so defensive archetypes need no separate mitigation model. No v1 enemy in §12.2 gains Guard.
- Because Guard decays in the same unit the queue uses, the player can read the queue and see *exactly* whether their Guard survives to the enemy's next action. Defense becomes a timing puzzle rather than a resource-per-turn calculation.

This is the single most important addition in v0.2 and it should be prototyped alongside the queue.

### 4.5 Status effects and durations [NEW]

Every duration is in ticks. Never in turns.

| Effect | Behaviour |
|---|---|
| **Poison** X | Deals X damage every **5 ticks**; X decreases by 1 per proc. Ignores Guard. |
| **Bleed** X | Deals X damage whenever the afflicted actor **takes an action**. Duration in ticks. **[AMD]** X does not decay; Bleed ends when its duration expires. Poison punishes existing, Bleed punishes acting — so Bleed scales with the victim's Speed and Poison deliberately does not. |
| **Burn** X | Deals X damage every 5 ticks; does not decay; expires after 20 ticks. |
| **Slow** X | −X effective Speed for D ticks. |
| **Haste** X | +X effective Speed for D ticks. |
| **Weaken / Empower** | ±% damage dealt, for D ticks. |
| **Brittle** | −Poise for D ticks. |

Tick-based effects resolve in the timeline scheduler, not in actor turns, so a slow actor is not punished twice by DoT.

**Poison Rat clarified:** stacking Poison on a fast actor is nasty because the rat gets more actions, but its Poison damage is on a fixed 5-tick clock and doesn't scale with the victim's speed. Fast player builds are not disproportionately punished by DoT. This was ambiguous in v0.1.

### 4.6 Poise and Stagger

Enemies have **Poise**. A single hit at or above the Poise threshold applies **Stagger**: `next_act_tick += 3`.

**[AMD] Poise is a threshold, not a pool.** v0.2 described it both ways — as a threshold here and as accumulating "Poise damage" in §4.8 and §6.2 — which are different mechanics. It is a **threshold**: Poise does not deplete, chip damage never staggers, and the player's question is the single comparison *"can this card break it?"* rather than *"how many more hits?"*. This keeps Stagger a planned act and costs the UI no per-enemy tracked state (P5).

**[FIX] Diminishing Stagger.** Each Stagger applied to the same enemy in one encounter is worth half the previous: 3 → 2 → 1 → 1 → 1 (floor 1). Without this, a Break build denies a slow boss every turn and the encounter becomes a non-game. v0.1 flagged this as an open question; it is now a rule.

### 4.7 Speed cap and diminishing returns [FIX]

**Bug in v0.1:** Speed multiplied turn frequency, card draw, *and* cooldown cycling simultaneously. Three multiplicative benefits on one stat is a runaway — a Haste build would trivialize the game.

```
effective_speed = 100 + gain            if gain <= 40
effective_speed = 140 + (gain - 40)/2   if gain > 40
hard cap = 180
```

**[AMD] Effective Speed has a floor of 20.** The formula above has no lower bound, and `delay = ceil(weight * 100 / effective_speed)` divides by it — a large enough Slow stack drives effective Speed to zero and the delay to infinity. The floor is one fifth of base: punishing, still playable, never degenerate. Discovered while implementing §4.1 in M0/S1.

Additionally, **draw is decoupled from Speed above 140**: beyond that threshold, the player draws 1 card every *other* turn. Extra actions still accrue; extra cards do not. **[AMD]** "Every other turn" counts **the actor's own committed actions** — draw on even-numbered ones. The count is local to the actor and survives any reordering of the queue; there is no shared turn counter in this game and none may be introduced (P6). Speed remains excellent, but it stops being the only stat worth having.

### 4.8 Targeting and encounter composition [NEW]

- Encounters hold **1–4 enemies**. No positioning, no lanes — targeting is a click.
- Default target persists between turns; killing a target auto-advances to the nearest.
- **AoE** cards hit all enemies at reduced damage (typically 60%). **[AMD]** The Poise *check* is made against each enemy independently, using that enemy's own reduced damage figure — so an AoE that staggers a rat will usually not stagger a Warden. (This previously read "apply Poise damage", which implied a pool; see §4.6.)
- Enemy AI targets the player only (single-hero design), so "threat" and "taunt" mechanics do not exist and should not be added.

### 4.9 Cards and the Cooldown pile

Played cards enter the **Cooldown pile** with `return_tick = now + recovery`, then return to the **bottom of the draw pile**. Empty draw pile on a draw = draw nothing (the wait is the cost; do not reshuffle early).

**[AMD] The opening hand is 5.** The document never stated one, and §3's loop draws 1 at the start of each player turn — which would open an encounter holding a single card. Five leaves exactly one space under the hand cap of 6, so the first turn's draw is a real draw rather than one skipped against a full hand (§4.3 [AMD]).

**[AMD] The draw pile is shuffled at encounter start**, from the seeded `combat` stream (§20.2). "Do not reshuffle early" governs the Cooldown pile mid-encounter; it does not mean the deck is played in authored order.

**[AMD] Cooldown returns resolve in the scheduler**, in tick order, *before* the turn of the actor whose tick they fall on. A card whose Recovery ends exactly on your turn is therefore back in the pile in time to be drawn that turn.

Deck size 12–16.

### 4.10 End of combat

All Guard, statuses, and Cooldowns clear. Cooldown cards return to the deck. HP, Max HP loss, and Saturation persist.

**[AMD] M0 stands in for the Sanctum with a chain of three.** Persisting HP is only survivable because §11 lets a run heal at a Sanctum node; M0 has no map, so its six encounters are cut into chains of three, restored to full between them. The arithmetic forces the issue rather than taste: six fights on one 70 HP pool with no heal caps every fight at under 12 HP of damage, which is another way of saying no fight is allowed to matter. Chain length is the smallest stand-in that keeps §4.10's attrition real, and it is deleted when the map lands. **The fight, not the encounter, is the unit of tension; the chain is the unit of attrition.**

---

## 5. Progression in a run

### 5.1 Levels and skills

Fixed authored skill table. Level *N* grants skill *N*, always, in order. **There is no card selection screen anywhere in the game.**

| Level | Grants | Deck size | Max HP |
|---|---|---|---|
| 1 | 4 starters + 1 signature | 5 | 70 |
| 2–11 | 1 skill each | 6–15 | 76–124 |
| 12 (cap) | Capstone | 16 | 136 |

**[AMD] The skill table is not yet authored.** §17 budgets 16 class skills; none are specified in this document. M0 runs on a **provisional 12-card deck** (5 Light / 4 Standard / 2 Heavy / 1 Ultimate) in `src/data/cards.m0.json`, sized to make the Cooldown pile bite. Whatever survives the M0 gate is promoted into this section as the real table; nothing in that file is a design commitment until then.

**[AMD] The signature card, and a card that inflicts something.** §6.1 opens the
run with one socket on "their signature card", which the unwritten table above
does not name — until it is written, the signature is a **Standard** card, so
the free socket sits on something the player actually reaches for. Separately,
**a card must be able to apply a status**: the LINGER frame (§6.2) extends
status durations, and with every status coming from enemy intents it had nothing
to act on and would have shipped as decoration.

**[FIX] Max HP grows +6 per level.** v0.1 had a fixed 70 Max HP while charging 8–18 Max HP per socket — socketing six cards would have consumed the entire health pool. A growing pool makes the socket cost a real but survivable trade, and it's necessary for boss scaling regardless.

### 5.2 XP

```
xp = base_xp * clamp(1 + 0.18 * (enemy_level - player_level), 0.10, 1.80)
```

### 5.3 Threat

Each dungeon node entered raises world **Threat** by 1. `enemy_level = depth_base + floor(Threat / 2)`. Farming pushes enemies past you rather than behind you — self-limiting, no timer UI.

---

## 6. Build system: sockets and gems

### 6.1 Sockets [FIX — economy rebalanced]

Cards have 0–3 sockets. **The player starts with one socket already open on their signature card** — v0.1 began the run with zero build expression, meaning the first two Depths had no gem play at all. Onboarding hole, now closed.

Socket cost is a **percentage of current Max HP**, so it scales with level automatically:

| Socket # on a card | Cost | Success |
|---|---|---|
| 1st | 8% Max HP | 100% |
| 2nd | 12% Max HP | 75% |
| 3rd | 18% Max HP + 1 Insight | 45% |

Cost is **maximum** HP, not current. Healing cannot refund it — this closes the "healer socketed everything" exploit at the root instead of taxing it with RNG.

**[NEW] Floor:** Max HP cannot be reduced below **40% of the level baseline**. Prevents a death-spiral build that cannot survive a single boss hit, and prevents an unwinnable-state softlock.

On failure: HP spent, no socket, card flagged **Scarred** (+50% cost on its next attempt, does not stack past +50%).

### 6.2 Gems

```json
{
  "id": "gem_7f3a", "frame": "REPEAT", "tier": 2,
  "tags": ["Multi", "Physical"],
  "weight_delta": 2,
  "effects": [
    { "type": "EXTRA_STRIKE", "value": 1 },
    { "type": "DAMAGE_MULT", "value": -0.35 }
  ],
  "affixes": [{ "type": "RECOVERY_DELTA", "value": -3 }]
}
```

**Frames** (player-chosen) determine the effect family. **Values** roll.

| Frame | Effect | Drawback |
|---|---|---|
| REPEAT | +1 strike, damage split | +Weight |
| CHARGE | Gain a Charge on kill | Dead socket until charged |
| SPEND | Consume Charges for damage | Dead without a Charge source |
| SIPHON | Heal % of damage dealt | −Damage |
| BREAK | +% damage counted for the Poise check, +Stagger **[AMD]** | −Damage |
| HASTE | −Weight or −Recovery | −Damage or −Duration |
| KINDLE | Convert damage to a tag | Exposes you to that tag's Weave value |
| ECHO | Card returns to hand instead of Cooldown, 1×/fight | +Recovery permanently |
| **WARD** [NEW] | Card also grants Guard | +Weight |
| **LINGER** [NEW] | Extend status durations | −Status magnitude |

WARD and LINGER exist because v0.1's frame list was entirely offensive, which would have made defensive play unbuildable.

**Crafting:** spend materials → material rarity sets Tier (1–4) → choose a Frame → values roll → spend **1 Insight** to reroll values (not the Frame).

**Socketing is permanent.** Removal is free but destroys the gem.

### 6.3 Why this doesn't become Path of Exile

PoE's meta is rigid *because of* its depth: a huge but static option space with fixed values makes looking up the answer more rational than experimenting. Cadence breaks that with three coupled constraints — gems are **rolled** so the answer can't be a list; sockets are **scarce and permanent** so the question is "which do I commit to now" not "which is best"; and tag values **move every run** so the optimum is a function of run state, not of the patch.

---

## 7. The Weave

**[NEW] The tags.** v0.2 multiplied per tag without ever listing them. There are
**six**, and a card carries **exactly one**: **Physical, Fire, Frost, Arcane,
Shadow, Storm**. Six is load-bearing — §7.1 raises two and pushes two down, so
six leaves two neutral and roughly a third of a deck moves on each roll: enough
to force adaptation, not enough to brick a build (§7.4's concern).

Words like *Multi*, *Charge* and *Break*, which §6.2 and §8.1 also call "tags",
are **gem and frame vocabulary, not Weave tags**. They name what a gem does; the
Weave has nothing to multiply them by.

One panel. Every tag shows one final multiplier.

```
final = clamp(attunement × (1 − enemy_resist) × (1 − saturation), 0.30, 2.00)
```

### 7.1 Attunement

Run start rolls **2 Ascendant** (×1.35, −1 Weight) and **2 Suppressed** (×0.70, +1 Weight) tags.

**[FIX] Shift schedule.** With only 4 Depths, v0.1's "announce one Depth ahead" left Depth 1 unannounced and Depth 4 pointless. Corrected: the full Attunement is visible at run start; it re-rolls one Ascendant and one Suppressed slot at the **start of Depth 2 and Depth 3 only**, each announced at the end of the preceding Depth. Two shifts per run — enough to force adaptation, few enough to plan around.

### 7.2 Enemy resistance

Generated enemies carry 0–60% tag resistance. Hard immunity exists on **elites only**, one tag maximum, always shown on the map node **before you commit**.

**[AMD] Immunity is not 100% resistance.** Feeding `resist = 1` through §7's
formula produces ×0, which the mandatory clamp then raises back to **×0.30** —
turning "immune" into "70% resistant" silently. Immunity is therefore its own
case, outside the clamp, and yields ×0. The distinction has to exist in the type
from the start: retrofitting it after the clamp has shipped means auditing every
call site instead of one.

### 7.3 Saturation [NEW math]

Tracks the tag dealing most of your damage over the last 6 encounters.

- **+6%** per encounter where one tag exceeds 50% of your damage
- **−5%** per encounter otherwise
- **Cap 30%**

### 7.4 The floor [FIX — this was a real bug]

v0.1 multiplied three reductions without a floor. Worst case: `0.70 × 0.40 × 0.70 = 0.196` — an 80% damage reduction, which flatly contradicts the claim that nothing bricks a build. **The clamp of 0.30 in the formula above is mandatory.** A player at the floor is in serious trouble and should be, but they can still play.

The Weave panel must display the *final clamped* number, and show a distinct icon when the floor is active so the player understands why the math stopped moving.

---

## 8. Insight — paying for creativity

Single currency, earned only by doing what a cautious player wouldn't. Spent on gem rerolls and third sockets — it converts directly into build power.

### 8.1 Riddles

3 per run, generated at start, revealed as hints. Verified by predicates over the combat event log.

> *Deal 40 damage in one action with a Charge-tagged skill.*
> *Win an encounter never holding more than 3 cards.*
> *Stagger one enemy three times before it acts twice.*

Reward: 2 Insight + materials. **[NEW]** Run-long riddles are checked at run end; encounter-scoped riddles resolve immediately with a visible toast.

### 8.2 Wagers

| Wager | Reward | Failure |
|---|---|---|
| No Heavy or Ultimate | 2 Insight | −15 gold |
| Zero damage taken in one encounter | 1 Insight + material | — |
| Clear with ≤4 distinct cards played | 3 Insight | −1 Insight |

### 8.3 Saturation

The always-on passive push away from single-solution play (§7.3).

---

## 9. Economy [NEW — entirely missing from v0.1]

v0.1 spent gold in three places and never said where gold came from. Full ledger:

**Sources**

| Source | Gold | Materials | XP | Insight |
|---|---|---|---|---|
| Normal encounter | 15–25 | 35% chance T1 | base | — |
| Elite | 40–60 | T2 guaranteed | ×2.5 | — |
| Boss | 100–140 | T3 guaranteed | ×4 | 1 |
| Riddle | — | 1 tier-scaled | — | 2 |
| Wager | — | sometimes | — | 1–3 |

**Sinks**

| Sink | Cost |
|---|---|
| Card removal (Market) | 60 → 120 → 240 → 480 gold |
| Relic (Market) | 90–160 gold |
| Materials (Market) | 40 (T1) / 90 (T2) / 200 (T3) |
| Socket attempt | Max HP (+1 Insight for 3rd) |
| Gem reroll | 1 Insight |
| Sanctum | free, but costs the node |

**Materials taxonomy:** Shard (T1) → Core (T2) → Heart (T3) → Sigil (T4). Three of a tier upgrade into one of the next. This gives low-tier drops a permanent floor of value and prevents dead loot late in a run.

**Expected run totals** (for balance sim targets): ~450 gold, ~9 materials, ~7 Insight, 5–7 sockets opened, 4–6 gems crafted.

**[AMD] Where removal happens, and how far it goes.** The sinks table above
annotated two rows "(Market)" and left card removal unplaced, which left the
only gold-spending node ambiguous. Removal is a **Market** act — it is the third
thing gold buys, and there is nowhere else to spend it. Two bounds follow from
the ladder having exactly four rungs and no fifth:

- **The ladder is the cap.** Four removals cost 900 gold against an expected run
  total of ~450, so the wallet runs out well before the rungs do. A fifth
  removal is refused rather than priced by extrapolation.
- **The deck floor is 4.** §5.1 starts the player on four starters plus a
  signature, and below four cards the hand cap of six and the Cooldown pile stop
  meaning anything — every turn collapses into Guard (§4.9). The **signature is
  never removable**: §6.1 opens its socket at run start, so removing it would
  delete the build layer's own on-ramp.
- Anything socketed into a removed card goes with it, which is already §6.2's
  rule for taking a gem out of a socket rather than a new one. §15.2 confirms it.

**Nothing carries between runs.** Insight, gold, and materials are all zeroed on run end.

---

## 10. Relics [NEW — referenced five times in v0.1, never specified]

Passive permanent modifiers, 1 per elite kill (choice of 2) plus Market purchases. Target **24 for v1**. Relics are the second variance source that makes run 1 differ from run 50, and they must not simply add damage.

| Category | Example |
|---|---|
| **Timeline** | *Metronome* — your first action each encounter costs 0 Weight |
| **Timeline** | *Undertow* — Stagger you apply lasts +1 tick, but −10 Speed |
| **Economy** | *Prospector's Eye* — +1 material tier from elites, −20% gold |
| **Weave** | *Prism* — Suppressed tags are only ×0.85, Ascendant only ×1.15 |
| **Weave** | *Zealot's Blinders* — Saturation cap becomes 50%, but Ascendant becomes ×1.7 |
| **Socket** | *Bone Ledger* — socket attempts cost 4% less Max HP, but failures also Scar an adjacent card |
| **Deck** | *Second Wind* — the Guard action draws 2 instead of 1 |
| **Risk** | *Glass Sigil* — +30% damage dealt and taken |

Every relic should carry a real drawback. Pure upgrades create a known-correct relic ranking, which is exactly the meta this design exists to avoid.

**[AMD] Two of the examples above stated no drawback**, and the closing rule
above says every relic must carry one — so the table contradicted itself.
Metronome and Second Wind are now:

- *Metronome* — your first action each encounter costs 0 Weight, **and every
  action after it costs 1 more**.
- *Second Wind* — the Guard action draws 2 instead of 1, **and puts up 1 less
  Guard**.

Both drawbacks are authored here rather than chosen by the implementation: the
rule that every relic costs something is a design rule, and a relic shipped
without one would have been the known-correct pick the paragraph above forbids.

**[AMD] Holding two relics that write the same value takes the worse of the
two**, not whichever was acquired later. Prism caps Ascendant at ×1.15 and
Zealot's Blinders raises it to ×1.7; a player holding both gets ×1.15. Acquisition
order is not a game rule, and the alternative is a relic whose drawback can be
cancelled by shopping.

---

## 11. Map and run structure

**4 Depths.** Each offers 2 Dungeons, 1 Sanctum, 1 Market; the player takes **2 nodes**, then the Boss.

The node types pay in **different currencies** (XP vs. HP vs. gold), so they can't be ranked against each other — there's nothing to solve.

**Commitment before information:** a Dungeon node shows only its Threat rating and one **Omen tag** hinting at the resistance profile. Composition is unknown until entered.

**Timing budget** (tunable):

| Segment | Count | Avg | Subtotal |
|---|---|---|---|
| Normal | 12 | 65s | 13:00 |
| Elite | 4 | 100s | 6:40 |
| Boss | 4 | 150s | 10:00 |
| Out-of-combat | — | — | ~5:00 |
| **Total** | | | **≈ 34:40** |

If long in playtest, cut Depth 2 to a single Dungeon node before touching encounter pacing.

---

## 12. Enemies and bosses

### 12.1 Generation

`archetype + modifier + level`. Scaling formulas [NEW]:

```
enemy_hp     = base_hp * (1 + 0.22 * level)
enemy_damage = base_dmg * (1 + 0.16 * level)
enemy_poise  = base_poise * (1 + 0.12 * level)
enemy_speed  = base_speed        // never scales — Speed is the player's axis
```

Speed deliberately does not scale with level. If enemy Speed grew, the entire queue-planning skill would degrade over a run.

### 12.2 Archetypes (v1 target: 14)

**[AMD] Only Speed is a design commitment here.** HP, Poise, and intent damage for the three M0 archetypes are provisional in exactly the way §5.1's deck is, and live in `src/data/archetypes.ts`. What the M0 tuning pass fixed is worth carrying forward as a rule rather than as numbers:

- **An archetype's base statline is its *add* strength** — what it is worth standing beside something bigger. A solo fight raises the enemy's **level** (§12.1) instead of writing a second statline, so one archetype covers both roles.
- **A second enemy adds its whole damage output while adding only its own HP to the pool.** A duo must therefore be built from cheaper parts than the solo fight before it, and a trio from cheaper parts again. Encounters that ignore this are unwinnable long before they look it.
- **Fast chip enemies bound fight length.** Any readable per-hit number, multiplied by the thirty-odd actions a Speed-130 pair takes across a long fight, is lethal. A fight built on fast chippers is a short fight by construction; length comes from slow, lumpy enemies like the Warden.

| Name | SPD | Role |
|---|---|---|
| Poison Rat | 130 | Fast chip, low Poise — free Stagger practice |
| Bleeding Berserker | 90 | High HP, self-damage burst |
| Emberhide | 100 | 50% Fire resist, retaliates on hit |
| Warden | 70 | Huge Poise, telegraphs a Weight-16 hit |
| Chime Adept | 115 | Applies Slow, punishes Heavy cards |
| Glutton | 80 | Heals by consuming its own allies |

**[AMD] Resistance is authored, and does not scale.** An archetype's tag
resistance is part of what it *is*, like its Speed — a level says how much of it
there is, not what it shrugs off. A resistance that grew with depth would make
the Weave a tax on progress rather than a question about which card to reach for.

### 12.3 Boss design rules [NEW]

Each boss must attack a different assumption:

1. **Depth 1 — The Clockeater.** Teaches the queue. Long wind-up, high Poise; the fight is a Stagger puzzle. Beatable by any build.
2. **Depth 2 — The Twin Censers.** Two bodies, one shared HP pool, opposite resistances. Punishes mono-tag builds; the first real test of Saturation awareness.
3. **Depth 3 — The Archivist.** Copies your most-played card and uses it against you. Punishes low-variety play directly.
4. **Depth 4 — The Hollow Hour.** Its Speed rises each time it acts. A pure DPS race with a hard timer, testing whether the build can actually close.

No boss may have a hard immunity. No boss may apply unavoidable Max HP loss.

---

## 13. Death, failure, and run end [NEW — undefined in v0.1]

- HP ≤ 0 ends the run immediately. No revives, no second chances.
- Run summary: depth reached, build snapshot (cards + sockets + gems), Weave state, riddles completed, seed.
- All currencies zeroed. Only **unlocks** persist (§14).
- **[NEW] Seed replay:** the summary offers "Retry this seed." Free, no reward penalty. This is how players learn that a loss was a decision and not a dice roll — an important trust mechanism in a game with this much randomness.

---

## 14. Meta-progression

**Rule: unlocks widen the option space and never grant raw power.**

Unlockable: gem Frames, relics, dungeon types, riddles, enemy archetypes, alternate starting loadouts (sidegrades only).

Never unlockable: +HP, +damage, +starting gold, or anything making run 50 numerically stronger than run 1. Power-based metaprogression manufactures a known-correct unlock order — the exact meta this design exists to avoid.

**[NEW] Unlock pacing:** ~1 unlock per 2 runs for the first 20 runs, then slowing. Unlocks are earned by *milestones*, not currency (first Depth-3 clear, first 3-socket card, first run with zero Heavy cards played), so they double as a tutorial for advanced play.

**[NEW] Post-clear difficulty: Depths.** After the first win, optional modifiers stack (Depth I–X): higher Threat floor, a third Suppressed tag, Saturation cap raised, elite immunity on normals. Standard roguelite retention structure; without it, the game ends at first win.

---

## 15. UX and accessibility [NEW]

### 15.1 Presentation: first person, deliberately plain [AMD]

**The camera is the player's own eyes.** There is no player avatar on screen. The hand
is rendered as cards **held in the player's hands** along the bottom of the frame, angled
as if looked down at; enemies stand **in front of the camera**, facing you, at the depth
their position in the encounter implies. Nothing else occupies the play space.

This is a presentation decision, not a new system, and it is chosen for three reasons:

- It is **the cheapest thing to build well** — a solo developer shipping a 35-minute
  roguelite gets one readable screen, not a diorama. Flat card faces, enemy silhouettes,
  and typography carry the whole game.
- It matches the design. This is a **single-hero** game (§4.8): no party, no positioning,
  no lanes. A third-person view would show one figure standing alone, which communicates
  nothing the queue strip does not already say better.
- It puts the hand where the attention is. The player's two loops are *read the queue*
  and *choose a card*; holding the cards in frame makes the second one physical.

**[AMD] Cards fan on an arc, not by rotation.** The hand curves — outer cards sit lower, as if held — but the cards themselves stay upright. Phaser 4.2.1's WebGL renderer corrupts glyphs inside rotated containers, and it corrupts them on exactly the Weight and damage numbers §15 says must be unmissable. Legibility outranks the flourish (P5). Revisit if the engine issue is resolved.

**Visual budget.** Flat colour, glyphs, and text. Enemies are silhouettes with an intent
badge. No environment art, no particle systems beyond a hit flash, no camera movement
except a Stagger nudge (§4.6) — that one moment is the game's payoff and earns its
animation. Everything here is skippable per the animation rule below.

**[AMD] The queue drains one turn at a time.** Committing an action used to move the
strip in a single jump: the player's card, every enemy turn it ceded, and the next
decision all landed in one frame, and the turns in between could only be reconstructed
from the HP that had gone missing. The queue is the game (§4.2), so it now **plays the
same resolution back as a sequence of beats** — one turn per beat, the resolved slot
marching off the front, the rest stepping up, until the player is due again. This is a
second animation that earns its place beside the Stagger nudge, and for the same reason:
it is the moment the strip is actually saying something.

It changes nothing about what happens. Every beat is read from a resolution the reducer
has already completed, so the board it ends on is the board the single jump produced —
byte-identical. Per the animation rule below it is fully skippable: the toggle plays the
whole resolution at once, and a click during a drain jumps to its end.

**[AMD] Consequence — the player has no portrait.** §15's queue strip lists "portraits",
which assumes every actor has a face to show. The player never sees their own, so the
player's slots in the strip are marked with a **distinct non-portrait token** (the held-card
glyph), not an invented avatar. It must remain the single most identifiable mark in the
strip: the player's own position is the one thing they are always looking for.

### 15.2 Rules

**Critical:** tags carry mechanical meaning and are the game's core language. They must **never** be encoded in color alone. Every tag has a distinct glyph, and the Weave panel shows numerals, not bars.

- **Queue strip** — 8 slots, portraits, intent icons, damage numbers, ghost preview on hover.
- **Weave panel** — collapsible, always accessible, one row per tag: glyph, name, final multiplier, floor indicator.
- **Card face** — Weight and Recovery are as prominent as damage. If the player has to hunt for Weight, the pillar fails.
- **Damage preview** — hovering a card shows post-Weave damage against the current target, not base damage. The player should never do multiplication in their head.
- **Speed / animation** — full skip toggle. A 35-minute run cannot afford unskippable animation. **[AMD]** A click during the queue drain (§15.1) skips that drain, so the toggle is the setting and the click is the impulse.
- **Text size** setting, minimum 16px equivalent.
- **[NEW] Undo-free design** — no undo, but confirm dialogs on all irreversible acts (socketing, gem removal, card removal).

---

## 16. Save, platform, and input [NEW]

- **Target:** desktop web + Steam wrapper. Mouse-first; the queue-hover interaction needs a real pointer. **Touch is out of scope for v1** — hover-preview has no touch equivalent and faking it with tap-to-preview degrades the core loop.
- **Mid-run save:** mandatory. A 35-minute run must be resumable. Serialize full run state + all PRNG stream positions to IndexedDB after every node transition and every encounter end. Never mid-encounter — an encounter is atomic; resume replays it from its start state.
- **Save format is versioned.** Migration or invalidation on schema change, decided before the first public build.
- **Resolution:** 16:9, design at 1920×1080, scale down to 1280×720.

---

## 17. Content budget for v1 [NEW]

The number a solo developer most needs and v0.1 didn't have.

| Content | v1 target | Notes |
|---|---|---|
| Classes | **1** | A second doubles content cost; ship one, polish it |
| Class skills | 16 | The full level table |
| Starting loadout variants | 3 | Cheap variance; unlock-gated |
| Gem frames | 10 | × 4 tiers |
| Gem affixes | 20 | Shared pool |
| Enemy archetypes | 14 | |
| Enemy modifiers | 8 | Multiplies archetypes to ~112 combinations |
| Bosses | 4 | |
| Elites | 6 | |
| Relics | 24 | |
| Riddles | 30 | |
| Dungeon types | 5 | |

Content is authored in JSON. Nothing on this list requires new code once the systems in §4–§8 exist — which is the point of building the sim layer first.

---

## 18. Build order and milestones [NEW]

**M0 — Feel test (4–6 weeks).** Do not build the map, gems, economy, or art.
1. Tick scheduler + visible 8-slot queue
2. Hand, one card per turn, Weight moves the queue
3. **Ghost preview on hover** ← the whole game
4. Cooldown pile returning cards by tick
5. Guard with 1/tick decay
6. Poise/Stagger with diminishing returns
7. Three enemies with real intents

**Gate:** play it for an hour with no gems at all. If moving your position in the turn queue isn't fun by itself, stop. The gem system will not save it — it will decorate it.

**M1 — Build layer (6–8 weeks).** Sockets, gems, generative crafting, the Weave panel, Saturation.
**Gate:** two testers reach materially different builds from the same seed.

**M2 — Run layer (6 weeks).** Map, economy, relics, XP/Threat, save/resume, one boss.
**Gate:** a complete 35-minute run.

**M3 — Content (8–10 weeks).** Fill §17. Four bosses, riddles, wagers, unlocks.
**M4 — Balance and polish (open-ended).** §19.

---

## 19. Balance methodology [NEW]

A solo developer cannot balance a system this combinatorial by hand. The headless `/sim` layer (§20) is what makes this tractable — this is the primary reason for that architecture.

- **Automated runs:** scripted policy agents (greedy-damage, greedy-tempo, random) run 10,000 seeds nightly. Track win rate by Depth, encounter duration, damage-taken distribution, and time-to-kill.
- **Red flags:** any gem frame appearing in >40% of winning builds; any card played in <5% of turns; any encounter with a duration variance above 2×.
- **Telemetry from playtesters:** run seed, build snapshot at each Depth, death cause, encounter durations, cards never played. Opt-in, anonymous, and disclosed in-game.
- **The key metric for this design specifically:** *build diversity among winning runs*. If the top 3 gem/skill combinations account for more than 35% of wins, the anti-meta thesis is failing and the destabilizers in §7 need strengthening.

---

## 20. Implementation notes (Phaser v4, TypeScript)

### 20.1 Separate simulation from rendering

The combat model is a **pure, headless, deterministic module with zero Phaser imports.** Non-negotiable. It enables §19's automated balance, makes the ghost preview trivial (clone state, apply action, read queue), and means an engine change costs only `/scenes` and `/ui`.

```
/src
  /sim          ← no Phaser
    timeline.ts   min-heap scheduler on next_act_tick
    combat.ts     reducer: (State, Action) => State
    effects.ts    tick-based status resolution
    weave.ts      tag multiplier math (§7)
    rng.ts        seeded PRNG
  /data         ← JSON: cards, gems, frames, affixes, enemies, relics, riddles
  /run          ← run state, map gen, save/serialize
  /scenes       ← Phaser scenes
  /ui           ← queue strip, hand, weave panel, forge
```

### 20.2 Determinism

One run seed, **separate PRNG streams** for map, gem rolls, enemy generation, and combat variance — so changing one system doesn't reshuffle the others during testing. Stream positions are part of the save (§16). Enables seed replay (§13) and daily challenges for free.

**[AMD] Fixed draws.** Any roll that picks from a pool — an Attunement shift, a
socket attempt — must draw a **fixed number of times whatever it picks**.
Rejection sampling makes a stream's position depend on its own outcome, and a
position that depends on its outcome cannot be resumed from a save: the resumed
run silently diverges from the one that was written. A socket attempt therefore
draws even at 100%. The named streams are `map`, `gemRoll`, `enemyGen`,
`combat`, and **`weave`** — the last added so an Attunement roll cannot reshuffle
a fight.

### 20.3 Combat as a reducer

`(State, Action) => State`, immutable, emitting an event log. Riddles, achievements, telemetry, replays, and the ghost preview all read that log. No game logic in Phaser update loops.

### 20.4 Data-driven everything

Cards, gems, frames, affix pools, enemies, relics, riddles in JSON. As a solo developer, rebalancing without recompiling is the difference between shipping and not.

### 20.5 Engine caveat

Verify Phaser v4 API specifics against current documentation — v4 changed enough from v3 that older tutorials will mislead. The `/sim` split limits the blast radius of any engine surprise.

---

## 21. Risk register [NEW]

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Queue-planning isn't fun on its own | **Fatal** | M0 gate before any other work |
| 2 | Fixed deck makes runs feel identical | High | Starting loadout variants (§17), relics (§10) — *not* card choice |
| 3 | Generative gems produce mostly junk, so crafting feels bad | High | Tier floors on roll ranges; a Tier-3 gem is never worse than a Tier-1 |
| 4 | Weave feels random rather than strategic | High | Announce shifts one Depth ahead; final multipliers always visible |
| 5 | Max HP economy makes players never socket | Medium | Instrument socket-attempt rate in telemetry; target 5–7 per run |
| 6 | 35-minute target slips to 50+ | Medium | Cut nodes, not encounter pacing |
| 7 | Ultimates never worth playing | Medium | See open question 1 |
| 8 | Solo scope overrun | **High** | One class. §17 is a ceiling, not a wishlist |

---

## 22. Open questions

1. **Ultimates (Weight 16) may be unplayable.** **[AMD 2026-08-31]** Candidate
(b) — *grants Insight on kill* — is now implemented as a fourth switchable rule,
`insight`, because M1 built the Insight system it needed to mean anything. All
four are live under `U` and the decision belongs to M1's gate (`docs/M1_GATE.md`
§3). Separately, a wind-up Ultimate is now **priced at impact rather than at
commit**: `landStrike` already expanded its AoE over the line standing when it
arrived, so a damage figure frozen against a different board than the targets it
lands on was never a real snapshot. Empower gained during a wind-up now boosts
the landing blow. Four rat turns for one card is hard to justify. Candidate fixes: Ultimates are cast from the Cooldown pile with a wind-up the queue displays; or they grant Insight on kill; or they exist only as capstone payoffs with a Weight refund on kill. **Unresolved — resolve in M0.** **[AMD]** Two of the three candidates are now implemented and switchable while playing (`U` in the M0 build): *immediate* (the baseline as written) and *windup* (committed now, lands at +Weight, the player keeps acting after 4 — and the queue shows the strike arriving in its own slot). A third, *refund*, returns half the Weight on a kill. Candidate (b), Insight on kill, is **not** implemented: there is no Insight system in M0 to reward, so it can only be judged in M1. The decision is made during the gate hour and written back here; see `docs/M0_GATE.md` §3.
2. **Is the fixed deck too deterministic?** If yes, the fix is loadout variants, never a card-choice screen.
3. **Are three sockets too many for legibility?** May cap at 2.
4. **Insight reroll cost of 1 is a guess.** If rerolling is cheap, generative crafting collapses into deterministic crafting and pillar P3 dies.
5. **Does the player need any way to gain Max HP back?** Currently the only direction is down. A rare relic or Sanctum option may be needed to prevent a fragility death-spiral, but it partly undermines the socket cost.
6. **Guard cap of 40 and decay of 1/tick are untested.** Guard is the game's only mitigation; getting this wrong makes the game either trivial or brutal. **[AMD 2026-08-31] Half answered.** The decay was measured across three playtests and found to be doing nothing at all — Guard absorbed nothing in 23 of 25, then 8 of 9 fights — and is now one point every three ticks (§4.4). The **cap of 40 is still untested**: nothing in play has come close to it, so the question stays open on that half.

---

## 23. Anti-meta audit

| Cause of meta-gravitation | Addressed by | Strength |
|---|---|---|
| Static, knowable content | Rolled gems, shifting Attunement, generated enemies | Strong |
| Single measurement axis | Time cost, Poise/Stagger as a second win condition, non-comparable node currencies | Strong |
| Free acquisition | Max-HP socket cost, permanent gem commitment, escalating removal | Strong |

The deck itself remains fully knowable — deliberately. That's the mastery floor players need before they'll risk experimenting at all.
