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

**HP carries between fights** (GDD §4.10), in chains of three with a full
restore between them — M0's stand-in for §11's Sanctum. The banner names your
position in the chain and where the next rest is. This is where the pressure
lives: no individual fight is likely to kill you from full, but the third fight
of a chain is fought on whatever the first two left you.

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

| Policy | reaches |
|---|---|
| `leftmost` — plays hand slot 0, always | dies on fight 3, 90% of runs |
| `greedy` — biggest damage in hand | dies on fight 3, 54% of runs |
| `tempo` — best damage per tick of Weight | usually dies on fight 5 |
| `focus` — tempo, and kills the weakest enemy first | usually dies on fight 6 |

The gap between `leftmost` and `focus` is the whole claim under test: choosing
which card and which target should be worth roughly six fights' difference. If
play *feels* like it doesn't matter, that is a finding regardless of the table.

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
rather than one noticed afterwards — the Warden's Poise of 20 against a hand
where only Crush, Sunder and Cataclysm clear it is the fight that should now
read as a puzzle rather than as arithmetic. If it still doesn't, the finding is
that the deck, not the label, is the problem (§4, GDD §5.1 [AMD]).

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
