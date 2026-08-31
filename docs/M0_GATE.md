# M0 — The Gate

**Status:** run 2026-08-30 — **ambiguous** (§5); the Guard and Stagger
legibility passes are in, the one re-run is owed · **Build:** M0/S8 +
legibility passes · **Traces to:** GDD §18 (M0 gate), §21 Risk 1

> Play it for an hour with no gems at all. If moving your position in the turn
> queue isn't fun by itself, stop. The gem system will not save it — it will
> decorate it. — GDD §18

This is the fatal-risk checkpoint. It is not a formality, and the honest outcome
of M0 is whatever the answers say, including "stop".

---

## 1. What to run

```bash
npm run dev        # http://localhost:5173
```

Or play the deployed build at **<https://alutsu.github.io/project-cadence/>**,
which is what to hand the outsider — asking someone to clone a repo and start a
dev server changes what is being tested.

Optional: `?seed=6` replays an exact shuffle. The seed in use is shown next to
the encounter name, so any hand worth talking about can be reproduced later.

Six encounters, in order, each isolating one system before the last asks for all
of them at once. Clearing one advances to the next on a click; dying sends you
back to the first.

**HP carries between fights** (GDD §4.10), in chains of two with a full restore
between them — M0's stand-in for §11's Sanctum. The banner names your position
in the chain and where the next rest is. This is where the pressure lives: no
individual fight is likely to kill you from full, but the second fight of a
chain is fought on whatever the first one left you.

| Key | |
|---|---|
| `T` | show / hide the tuning console |
| `U` | cycle the Ultimate rule (see §3) |
| `G` / `H` | Guard cap down / up |
| `J` / `K` | Guard decay down / up |
| `W` | cycle Wait's Weight |
| `A` | animations on / off |
| `S` | sound on / off |
| `R` | restart this fight · `N` next fight (whole, for isolated reading) |

Every tuning change restarts the encounter: rules live in combat state, so a
half-changed fight would not be a fair reading.

### On the sound

There are no audio files in the repo — every sound is synthesised from an
oscillator, which keeps GDD §15.1's budget intact. **A strike's pitch falls with
its Weight class**: Light is high and quick, Ultimate is low and long. That is
deliberate rather than decorative, and it is worth listening for during the
hour. If a Heavy card does not *sound* expensive, pillar P1 is being carried by
the numbers alone.

`S` mutes it. Play some of the hour muted: if the queue stops reading without
sound, the sound is compensating for something the strip should be saying.

### What the bots say it should feel like

`npm run sim -- --sweep` replays the set with four scripted policies. None of
them uses Guard or Stagger, so **read every number as a floor a competent human
should beat**, not as the difficulty itself.

`npm run sim -- --report --seeds 100` adds a per-card and per-enemy breakdown
underneath, which is what §4's findings below are measured from.

**[2026-08-30, 100 seeds, after the deck re-spread and `CHAIN_SIZE` 2]**

| Policy | clears fight 3 | clears fight 4 | clears fight 6 |
|---|---|---|---|
| `leftmost` — plays hand slot 0, always | 100% | 18% | 0% |
| `greedy` — biggest expected damage in hand | 100% | 74% | 0% |
| `tempo` — best expected damage per tick of Weight | 100% | 99% | 0% |
| `focus` — tempo, and kills the weakest enemy first | 100% | 100% | 0% |

Every one of the six is won 100% of the time *entered at full HP* (fight 6
excepted, which `focus` wins 60%). Fight 4 is now where skill separates —
18% against 100% is the widest that gap has been, and it is the claim under
test. Fight 6 is the ceiling and nothing clears it; see §4.

The gap between `leftmost` and `focus` is the whole claim under test: choosing
which card and which target should be worth real ground. It is currently worth
almost none — see §4 — which is a finding about the *chain*, not about choosing.
If play *feels* like it doesn't matter, that is a finding regardless of the
table.

---

## 2. The protocol

**One uninterrupted hour**, no gems, answered in writing below. Then **one
outsider who has not read the GDD plays 20 minutes cold** and is asked questions
3, 4 and 5 unprompted. You already know what the queue means; your own answer to
"is it legible" is not evidence.

### The six questions

1. **Did you ever choose a *weaker* card because of where it left you in the
   queue?** If never, Weight is not a cost and pillar P1 has failed.
2. **Did you use Wait deliberately, for a reason you could state?** GDD §4.3 is
   a tactic or it is a crutch.
3. **Did the ghost preview change a decision, or only confirm one you had
   already made?**
4. **Could you tell, before acting, whether your Guard would survive the next
   enemy hit?**
5. **Did the Warden's wind-up produce tension?**
6. **Which card did you never play, and why?** The end-of-encounter summary
   names them, so this one does not rely on memory.

### Reading the result

- **Pass** — 1, 3 and 4 are yes, and 2 is yes at least a few times per
  encounter, *and* the outsider reaches yes on 3 and 4 without being taught the
  queue.
- **Ambiguous** — 1 and 3 yes but 4 no. Guard's *presentation* is the problem,
  not the design. Re-run the gate after a Guard-readability pass. One re-run
  only.
- **Fail** — 1 or 3 is no. The core is not fun. Stop and reconsider before M1
  (GDD §18). Do not start the build layer hoping gems rescue it.

---

## 3. Open question 1 — Ultimates (GDD §22)

> Weight 16 means four rat turns for one card. Hard to justify.

Three candidates are implemented and switchable live with `U`. Play **20 minutes
on each** and answer: *did you ever play Cataclysm on purpose, and did it feel
worth it?*

| Rule | What it does | What it is testing |
|---|---|---|
| `immediate` | Weight 16 paid up front, as written | the baseline the question doubts |
| `windup` | Committed now, lands at +16; you keep acting after 4 | whether the cost should be commitment and exposure rather than four lost turns. The queue shows the strike arriving in its own slot |
| `refund` | Paid up front, half the Weight back on a kill | whether Ultimates are finishers rather than openers |

Candidate (b) from the GDD — *grants Insight on kill* — is **not implemented**
and cannot be tested in M0: there is no Insight system to reward. It is a proxy
at best and should be judged in M1.

**Decide, then:** write the winner into GDD §4.1 and §22, delete the losing
branches from `src/sim/combat.ts` and `src/sim/rules.ts`, and remove the `U` key.

---

## 4. Also worth deciding while playing

**Wait-spam against a single weak enemy is currently unkillable.** Wait grants
+3 Guard at Weight 3, and Guard decays 1/tick, so Waiting on a loop holds Guard
at roughly 3 forever — enough to absorb a Poison Rat's whole bite. It falls
apart against two enemies or any real hit, so it may be a non-issue. Watch for
whether it is ever the *tempting* line; if it is, GDD §4.3 already names the
lever (Wait's Weight, not its draw).

**[2026-08-30] The opposite showed up first.** Making the verdict visible made
it visible that there usually isn't one: 3 Guard gained at t6 is 0 Guard at t9,
and the rats in fight 1 are three ticks out. Outside the Wait-loop above, Wait's
Guard is routinely dead before anything swings at it — which is the mechanical
reason answer 2 came back "attack is worth it more than defence". Both readings
point at the same knob (`J`/`K`, decay), and the hour is the place to settle it.


**[2026-08-30] The solo Warden now has exactly one key, by one point.** Making
Cleave, Sweep and Cataclysm AoE (GDD §4.8) drops Cataclysm from 44 to 26, and
fight 2's Warden is scaled to Poise 25 — so Cataclysm is the only card in the
deck that can stagger it, and it clears by a single point. Crush (24) no longer
can, and after the re-spread Sunder is an AoE landing 13. That is a Weight-16, Recovery-60 answer to a fight that runs
on a 16-tick wind-up, which may be the tension §5 answer 5 already liked or may
be a fight with one line in it. It is a *scaling* finding, not an AoE one:
`SOLO_LEVEL` is what put the Warden at 25, and lowering it is the lever.

**[2026-08-30] The chain of three costs more HP than the pool holds.** 100
seeds, every policy, every encounter: each of the six is won at full HP, and
every policy still dies in fight 3. The three fights of chain 1 cost roughly 34,
31 and 33 HP entered fresh — about 98 against a pool of 70 (GDD §5.1). The
lever is `CHAIN_SIZE`, the encounter levels, or `PLAYER_MAX_HP`; the reading is
that HP attrition, not any single fight, is what M0 is currently tuned to.

**[2026-08-30, playtest] "Reaching the third encounter feels impossible to win.
I tried a lot and passed it only once."** Confirmed, and the encounter was not
the problem. Fight 3 is won 100% of the time by *every* policy — `leftmost`
included, which plays hand slot 0 and nothing else — when entered at full HP. It
cost 27 HP; fights 1 and 2 cost about 23 and 25 before it, so a chain of three
asked for 75 HP out of a pool of 70. It was lost on arrival however well it was
played. `CHAIN_SIZE` is now 2, which is the knob the code already marks as the
M0 stand-in for §11's Sanctum, so nothing published in the GDD moved.

**[2026-08-30] Fight 6 is unwinnable in a gauntlet, and left that way.** Full
Consort costs about 67 HP entered fresh and `focus` still loses it 40% of the
time from full; fight 5 costs 41 before it, so no chain arrangement delivers a
player who can take it. That is the ceiling rather than a wall in the middle,
and a run that ends at the last fight of the set is a legitimate run end (GDD
§13). Revisit it if the hour says the finale feels unfair rather than final —
the levers are the §12.1 levels of its three enemies, not the chain.

**[2026-08-30] The AoE pass is most of that regression, measured.** Same 100
seeds with `targeting: "all"` stripped from the three cards and nothing else
changed:

| clears fight 3 | single-target | AoE |
|---|---|---|
| `leftmost` | 13% | 0% |
| `greedy` | 44% | 0% |
| `tempo` | 61% | 4% |
| `focus` | 61% | 4% |

Four of the six encounters field one or two enemies, where 60% reach is a
straight 40% damage cut and nothing is bought back. Only fight 6 improves
(`focus` from 58% lost to 44%). That is the trade §4.8 describes working exactly
as written — it is the *deck*, not the rule, that has three AoE cards in a set
that is mostly duels.

**[2026-08-30] Nine of the twelve cards were strictly dominated — fixed.** Cards
in a Weight class share Weight and Recovery from the §4.1 table, and M0 tags are
inert, so within a class and reach only damage differs and the lower number was
never the right play. Lunge beat every other Light; Hammerfall beat Pin; Crush
beat Sunder; Cleave beat Sweep. The deck reads as variety and played as four
cards, which is the arithmetic behind gate answer 6.

The catalogue is now **one card per (Weight class × reach)** — the most a
non-dominated M0 deck can hold, since those are the only axes the milestone has
— and the twelve the player holds are repeats drawn from those seven:

| | one enemy | all enemies |
|---|---|---|
| Light (W4/R8) | Lunge 11 ×3 | Sweep 6 each ×2 |
| Standard (W6/R14) | Hammerfall 16 ×2 | Cleave 8 each ×2 |
| Heavy (W10/R26) | Crush 24 ×1 | Sunder 13 each ×1 |
| Ultimate (W16/R60) | — | Cataclysm 26 each ×1 |

Each AoE beats its single-target sibling from two enemies on, which is one rule
to learn rather than four numbers to compare. The Weight curve is unchanged
(5 Light, 4 Standard, 2 Heavy, 1 Ultimate), so hand density and the shape of a
turn are the same. Measured after: **nothing dominated, nothing left unplayed**,
every card picked at least 10% of the hands that held it, and damage per tick
spread narrowed from 1.50–3.10 to 2.31–3.06.

**What to watch for in the re-run:** whether a second Lunge in hand feels
different from the Strike it replaced. Repeats are honest — a Strike was a Lunge
you would never choose — but if the hand now reads as *thinner* rather than
clearer, the finding is that M0 cannot carry twelve cards and the deck should be
seven (§5.1 [AMD]).

These are the numbers the GDD itself flags as guesses. The tuning console exists
so they can be chased inside the hour rather than between builds.

- **Guard cap 40 and decay 1/tick** (GDD §22 Q6). Guard is the only mitigation;
  wrong here makes the game trivial or brutal.
- **Wait's Weight of 3** (§4.3). If Wait is the answer to everything, its Weight
  is the lever — not its draw, and not a special-case restriction.
- **Whether the Ultimate belongs in the M0 deck at all** — the provisional deck
  is not a design commitment (§5.1 [AMD], plan D1).

---

## 5. Answers

*Fill in during the hour. Then record the outcome in the closing commit, with
the browser verification result (CLAUDE.md §7.4).*

**Date:** 2026-08-30 · **Seed(s):** not recorded · **Build:** M0/S8 + difficulty
pass (`6fac677`)

1. **Weaker card for queue position? — Yes.** "Very often I choose a combination
   of weaker cards that will deal more damage instead of a heavy one, to also
   avoid damage." Both halves of P1 are live: the queue position is paid for in
   damage, and the reason to pay is what the enemy does in the gap.
2. **Deliberate Wait? — No.** "Not really, I very often thought that attack is
   worth it then defense." Wait was never the stated plan; attacking always
   read as the better line.
3. **Preview changed a decision? — Yes.** The same choice as in 1: the ghost
   queue is what turned the light-card combination from an idea into the play.
4. **Guard readable against the queue? — No.** "The information isn't clear
   enough." Guard and the incoming hit are both on screen, but the comparison
   between them is left to the player to do in their head.
5. **Warden tension? — Yes.** "I had to calculate the weight and the damage so
   that I could defeat him without taking too much damage." The wind-up is
   doing its job: it turns a fight into an arithmetic problem with a deadline.
6. **Never played, and why? — Can't tell.** "I think I have played all of them,
   specially ultimates to end the fight." The end-of-encounter summary did not
   settle it, so this reading is unresolved. The one signal in it: Ultimates
   were used as *finishers*.

**Outsider (20 minutes, cold):** not run.

**Ultimate rule chosen:** undecided — the 20-minutes-per-rule comparison in §3
was not run, and answer 6 is not evidence for a rule. GDD §22 open question 1
stays open.

**Verdict: ambiguous** — 1 and 3 are yes, 4 is no. Per §2 this is Guard's
*presentation*, not the design; the gate gets one re-run after a
Guard-readability pass.

Answers 2 and 4 are one finding, not two. A player who cannot tell whether
Guard survives the next hit cannot price defence, so attacking is correctly the
safer read every time — Wait's disuse follows from Guard's illegibility rather
than from Wait's Weight. Fix 4 before touching the §4 Wait lever; if Wait is
still never worth stating a reason for once Guard is readable, *then* its
Weight is the thing to move.

**Still owed before the re-run is a complete gate reading:** the outsider pass
(§2) and the Ultimate comparison (§3).

---

### The Guard-readability pass (2026-08-30)

What the re-run is answering question 4 against. Every number below is computed
in `/sim` and read by the UI, never worked out on screen (CLAUDE.md §2.1).

- **The queue slot that hits you says whether Guard survives it.** The next
  enemy blow's caption becomes `2 dmg · 1 through`, or `2 dmg · guard holds` in
  Guard blue. It is the answer to question 4, printed inside the thing §4.4
  claims you can already read it from. Only that one slot carries it: a second
  blow's arithmetic depends on what the first one ate, and a verdict the sim
  cannot stand behind is worse than none.
- **A slot you meet with no Guard keeps its ordinary caption.** "6 through" and
  "Gnaw 6" say the same thing; only one of them is worth the width (P5).
- **The hover line says what the ticks cost, not what the enemies advertise.**
  `you act at t25 on 54 HP` — after Guard, after every hit, after every Poison
  proc on the way, which is a different number from the "6 incoming" beside it.
  It comes from running the same `advanceToDecision` the commit will run, on a
  copy, so it cannot drift from what happens.
- **`GUARD 5 holds to t39` now reads the decay rate off the rules.** It assumed
  1/tick, so it silently lied the moment `J`/`K` moved it — which is exactly
  during the hour this console exists for.

**What to watch for in the re-run:** whether the verdict appears often enough to
be a tool. If Guard is nearly always gone before the blow lands, question 4 is
answered "no, because there is nothing to survive" — a tuning finding, not a
presentation one, and the §4 note above is where it goes.

### The Stagger legibility pass (2026-08-30)

Reported during the same run, unprompted and outside the six questions: *"I
can't see if an enemy will be staggered or not. Also what the 'Poise X' means
on the rat and on the other enemies."*

Two separate failures, both of them on one line of the silhouette.

- **`POISE 8` was a number with no verb.** GDD §4.6 [AMD] builds the whole
  mechanic on the player making one comparison — *"can this card break it?"* —
  and never said what the number had to be compared against. It now reads
  `POISE 8 · one hit of 8+`, which also carries the [AMD] rule that chip damage
  never staggers however much of it lands.
- **The Stagger verdict named the delay but not who takes it.** `STAGGER +3`
  appeared only in the hover readout; with two rats on screen that is not an
  answer. The enemy a hovered card would stagger now says `STAGGER +3 ticks` on
  itself, in the player's own gold.
- **The threshold printed is `effectivePoise`, not `actor.poise`** — the value
  Brittle actually moves (GDD §4.5). The old line would have gone on printing a
  threshold the reducer had stopped using, which is a P3 bug waiting for M1.

**What to watch for in the re-run:** whether Stagger becomes a *planned* act
rather than one noticed afterwards. Fight 4 is the one to judge it on — the
Warden there has Poise 20, and Crush (24) and Cataclysm (26) clear it while
Hammerfall (16) and Sunder (13 each) do not, so there is a choice to make. If it still doesn't read, the finding is that the
deck, not the label, is the problem (§4, GDD §5.1 [AMD]).

### The first action of every fight was silent (2026-08-30)

Also from the run: *"I can't hear the sound."*

The audio context was built from the scene's own `POINTER_DOWN` handler, and
Phaser dispatches a game object's `pointerdown` *before* the scene-level one —
so a card's strike, its impact and every enemy turn that resolved behind it were
all raised against a context that did not exist yet. Every sound of the first
action of every encounter was dropped, which is exactly the click that has to
prove the sound is worth leaving on. It is built at the first sound now, which
is inside the gesture either way.

Measured off the fixed build, in case the hour still finds it thin: strikes peak
at −16 dBFS, Wait at −21, and Stagger — the payoff moment — at −22, the quietest
figure in the set. `VOLUME` is not a GDD number, so it can move if the hour says
it should; the §1 note about listening for a Heavy card's pitch is the thing to
judge it by.

### Cleave, Sweep and Cataclysm hit the line (2026-08-30)

Asked for directly, and implemented to GDD §4.8 as written: an AoE hits every
living enemy for 60% of its printed damage, and each enemy's Poise is checked
against the figure *it* took — so Cleave's 8 breaks a rat and leaves a Warden
standing, which is the [AMD] case §4.8 names.

The reduced figure is what the card face prints, under a `HITS ALL ENEMIES`
line: an AoE's printed damage is a number no enemy ever takes, and the hand is
not allowed to advertise one (P3). The hover readout collapses a whole shaken
line into one entry — `2 STAGGERS +3, +3` — because which enemy took which
delay is already on the silhouettes.

**What to watch for in the re-run:** whether Cleave at 8-to-all is ever chosen
over Hammerfall at 16-to-one. Two rats is the break-even by arithmetic; if the
answer is still "always Hammerfall", the 60% share is the lever (§4.8 says
"typically", so it is a tunable) rather than the idea.

### Telling two of the same enemy apart (2026-08-30)

Also from the run: *"where there is more than one enemy of the same type, for
example, two rats, add a label to them, like 'Rat 1', 'Rat 2', so that I will
know which rat belongs the attack on the lane."*

The queue names an actor, and "Poison Rat" in four of eight slots points at no
silhouette in particular — so the strip's whole claim, that you can read what is
coming and act on it, stopped at the first duplicated name. Duplicates are now
numbered in seat order at the start of the encounter, and the ordinal is fixed:
Rat 2 stays Rat 2 after Rat 1 dies, because the strip is pointing at an identity
and not at a position. A name with nothing to be told apart from is left plain.

The opening report needed the same fix from the other side — it read `Poison Rat
2, Poison Rat 2`, where both numbers were damage. It now reads `Poison Rat 1 for
2, Poison Rat 2 for 2`.
