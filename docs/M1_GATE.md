# M1 — The Gate

**Status:** not yet run — S1–S8 are complete and the build is ready to play ·
**Build:** M1/S8 · **Traces to:** GDD §18 (M1 gate), §19, §23

> Two testers reach materially different builds from the same seed. — GDD §18

M0's gate asked whether the queue was fun. This one asks whether the layer on
top of it *generates divergence*, or only decorates. It is the anti-meta thesis
of §23 put on trial, and like M0's it is a real stop condition.

---

## 1. What to run

```bash
npm run dev        # the port vite reports
```

`?seed=6` replays an exact run — the same Attunement, the same shuffle, the
same craft rolls. **Both testers must use the same seed**, or the gate is
measuring seeds rather than choices.

| Key | |
|---|---|
| `V` | show / hide the Weave panel |
| `F` | open / close the forge |
| `1`–`7` | (in the forge) pick a deck card |
| `C` | craft at tier 1 · `S` attempt a socket · `E` seat a gem |
| `X` | remove a gem (destroys it) · `R` reroll (1 Insight) · `U` upgrade materials |
| `T` | tuning console · `U` cycle the Ultimate rule |
| `A` | animations · `S` sound · `R` restart · `N` next fight |

Socketing and removal ask twice, and the second prompt names what is about to
happen — "spends 9 Max HP even if it fails (75%)" (GDD §15.2).

### What to look at first

The Weave panel is the whole build layer in six lines. On `?seed=6` it opens
with Physical and Storm Ascendant and Frost and Arcane Suppressed, which makes
Lunge a Weight-3 card that hits for 15 and Hammerfall a Weight-7 card that hits
for 11 — the same two cards that were W4/11 and W6/16 in M0.

Shadow reads `×0.70 · resisted` against a Poison Rat while Frost reads `×0.70`
with no note. Same number, different cause: one is the world, one is this
enemy. If that distinction is not legible in play, question 2 below is a no.

---

## 2. The protocol

Both testers play the same seeded six-encounter chain to the end. Their build
snapshots — which cards carry sockets, which frames sit in them, which tag they
leaned on — are compared. Then the owner plays an hour and answers §3.

**"Materially different" is defined before the run**, so the result cannot be
talked into passing:

- they socketed a **different set of cards**, and
- at least **half** their socketed frames differ, and
- their Saturation-dominant tag at run end differs.

**Pass:** all three hold, and questions 1 and 2 are yes.
**Ambiguous:** the three hold but the panel only explained after the fact
(2 is no) ⇒ a Weave-legibility pass, then one re-run. Same remedy M0 used.
**Fail:** the builds converge ⇒ §7's destabilisers are too weak. Fix those
numbers before building M2 on top of them.

### The six questions

1. Did you ever *decline* to socket a card you could afford, and could you say
   why? (If never, the Max HP cost is not a cost and §6.1 has failed.)
2. Did the Weave panel change which card you played, or only explain it
   afterwards?
3. When a tag shifted between chains, did you change what you were building —
   or just take the damage?
4. Did you ever reroll a gem, and did the Insight it cost buy something? (§22 Q4)
5. Was the third socket worth 18% of your Max HP and a 45% chance? (§22 Q3)
6. Which frame did you never craft, and why?

---

## 3. The open questions this gate closes

M1 built all four so they could be *decided* rather than guessed. Each is a
live knob on the build, not a number baked into the source.

| # | Question | How to answer it |
|---|---|---|
| §22 Q1 | Are Ultimates unplayable? | `U` now cycles **four** rules, not three. Candidate (b) — *grants Insight on kill* — could not be tested in M0 because there was no Insight to grant (docs/M0_GATE.md §3); it exists now as `insight`. Play 20 minutes on each and answer: did you play Cataclysm on purpose, and was it worth it? |
| §22 Q3 | Are three sockets too many for legibility? | Play a run capping yourself at two, then one using all three. Does the third socket read as a decision or as bookkeeping? |
| §22 Q4 | Is an Insight reroll cost of 1 too cheap? | Count rerolls per gem. If you reroll until you get the roll you wanted, generative crafting has collapsed into deterministic crafting and P3 is dead — the cost has to rise. |
| §22 Q5 | Does the player need a way to gain Max HP back? | Watch whether the run ends near the 28 floor. The harness says the poor builders land around 41–45 Max HP and **never** reach the floor, which is evidence against needing one — but a competent player sockets more. |

Decide, write each answer into GDD §22 and the section it governs, then delete
the losing branches and the `U` key, exactly as `docs/M0_GATE.md` §3 specifies.

---

## 4. What the harness already says

`npm run sim -- --builds --seeds=30` runs six builders against four policies
over the whole set. Two findings are worth carrying into the hour:

**Nothing wins.** Zero of 720 runs cleared all six encounters. This is *not* an
M1 regression — the M0-era gauntlet reported "finished the set 0%" as well, and
the last encounter has been a wall since the difficulty pass. It does mean
GDD §19's key metric (**build diversity among winning runs**) cannot be read
yet, and the report says so rather than printing a meaningless 0%.

**The deepest runs carry no gems.** Among the runs that got furthest, the
commonest build is `(none)` — the ascetic that never socketed. Random frames
seated without reading the Weave are currently a net loss against the Max HP
they cost. That is *plausibly correct* — these builders are deliberately poor
and none of them reads the panel before choosing — but it is the first thing to
check against a human hour. If a thinking player also finds socketing a losing
trade, §6.1's costs are too steep and the gate has found something real.

**Sockets and Max HP.** The builders open 3.6–4.1 sockets a run and end around
41–45 Max HP from a baseline of 70. §9 budgets 5–7 sockets, so the stand-in
grants (docs/M1_PLAN.md D19) are slightly tight rather than generous.

---

## 5. Answers

*Fill in during the hour. Then record the outcome in the closing commit, with
the browser verification result (CLAUDE.md §7.4).*

**Date:** — · **Seed(s):** — · **Build:** —

1. **Declined a socket you could afford? —**
2. **Panel changed a play, or only explained one? —**
3. **Changed the build when a tag shifted? —**
4. **Rerolled, and was the Insight worth it? —**
5. **Was the third socket worth it? —**
6. **Frame never crafted, and why? —**

**Tester A build:** —
**Tester B build:** —
**Materially different on:** cards ☐ · frames ☐ · dominant tag ☐

**Ultimate rule chosen:** —
**Verdict:** —
