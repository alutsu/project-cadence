# M0 — The Gate

**Status:** not yet run · **Build:** M0/S8 · **Traces to:** GDD §18 (M0 gate), §21 Risk 1

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

Optional: `?seed=6` replays an exact shuffle. The seed in use is shown next to
the encounter name, so any hand worth talking about can be reproduced later.

Six encounters, in order, each isolating one system before the last asks for all
of them at once. Clearing or losing one advances to the next on a click.

| Key | |
|---|---|
| `T` | show / hide the tuning console |
| `U` | cycle the Ultimate rule (see §3) |
| `G` / `H` | Guard cap down / up |
| `J` / `K` | Guard decay down / up |
| `W` | cycle Wait's Weight |
| `A` | animations on / off |
| `R` | restart this fight · `N` next fight |

Every tuning change restarts the encounter: rules live in combat state, so a
half-changed fight would not be a fair reading.

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

**Date:** · **Seed(s):** · **Build:**

1. Weaker card for queue position?
2. Deliberate Wait?
3. Preview changed a decision?
4. Guard readable against the queue?
5. Warden tension?
6. Never played, and why?

**Outsider (20 minutes, cold):** questions 3, 4, 5 —

**Ultimate rule chosen:** ·

**Verdict:** pass / ambiguous / fail —
