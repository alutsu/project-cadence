import Phaser from 'phaser';
import { TAG_GLYPHS, TAGS, type Tag } from '../sim/tag.ts';
import { NO_RESISTANCE, weaveRows, type TagVerdict } from '../sim/weave.ts';
import type { CombatState } from '../sim/state.ts';
import { findActor, livingEnemies } from '../sim/state.ts';
import type { ActorId } from '../sim/ids.ts';
import { DANGER_INK, FONT, GUARD_INK, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The Weave panel (GDD §15.2).
 *
 * > Collapsible, always accessible, one row per tag: glyph, name, final
 * > multiplier, floor indicator.
 *
 * Every number here is read from `weaveRows`, which returns a *verdict* — the
 * final clamped multiplier and whether the clamp bound. The panel is not
 * allowed to multiply anything (CLAUDE.md §2.1), and §7.4 requires the floor to
 * be shown as its own mark so the player understands why the number stopped
 * moving rather than assuming the display is broken.
 *
 * §15.2 is emphatic that a tag must never be encoded in colour alone, so every
 * row leads with its glyph and states its multiplier in numerals, never a bar.
 */
export class WeavePanel {
  private readonly view: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Text[] = [];
  private open = false;

  constructor(scene: Phaser.Scene) {
    const { left, top, rowHeight } = LAYOUT.weave;
    this.view = scene.add.container(left, top);

    this.title = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: TYPE.slotIntent, color: MUTED })
      .setOrigin(0, 0);
    this.view.add(this.title);

    for (const [index] of TAGS.entries()) {
      const row = scene.add
        .text(0, rowHeight * (index + 1), '', {
          fontFamily: FONT,
          fontSize: TYPE.weaveRow,
          color: INK,
        })
        .setOrigin(0, 0);
      this.rows.push(row);
      this.view.add(row);
    }

    this.setOpen(false);
  }

  toggle(): boolean {
    this.setOpen(!this.open);
    return this.open;
  }

  /**
   * Rendered against the enemy the player is pointing at, because §7's formula
   * has the defender's resistance in the middle of it — a multiplier with no
   * defender named would be a different number from the one the card deals.
   */
  render(state: CombatState, target: ActorId | null): void {
    const against = target === null ? livingEnemies(state)[0] : findActor(state, target);
    const rows = weaveRows(state.weave, against?.resistances ?? NO_RESISTANCE);

    this.title.setText(
      against === undefined ? 'THE WEAVE' : `THE WEAVE  ·  against ${against.name}`,
    );

    for (const [index, verdict] of rows.entries()) {
      const row = this.rows[index];
      if (row === undefined) continue;
      row.setText(lineFor(verdict));
      row.setColor(colourFor(verdict));
    }
  }

  destroy(): void {
    this.view.destroy(true);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.view.setVisible(open);
  }
}

const NAME_WIDTH = 9;

/**
 * One row, as text. §15.2: glyph, name, final multiplier, floor indicator —
 * and the multiplier is printed exactly as the sim computed it.
 */
function lineFor(verdict: TagVerdict): string {
  const name = padded(verdict.tag);
  const glyph = TAG_GLYPHS[verdict.tag];
  const multiplier = verdict.multiplier.toFixed(2);
  return `${glyph} ${name} ×${multiplier}${markFor(verdict)}`;
}

/**
 * The floor mark (GDD §7.4): "a distinct icon when the floor is active, so the
 * player understands why the math stopped moving". Immunity gets its own,
 * because ×0 is not the floor and reading it as one would be worse than
 * useless.
 */
function markFor(verdict: TagVerdict): string {
  if (verdict.resistance.kind === 'immune') return '  ⊘ immune';
  if (verdict.atFloor) return '  ▁ floor';
  if (verdict.atCeiling) return '  ▔ cap';

  // Two very different facts can print the same number: a Suppressed tag and a
  // neutral one the defender happens to resist both read ×0.70. Naming the
  // cause is the difference between "the world moved" — wait for the shift —
  // and "this enemy is armoured" — bring another card (P3).
  const causes = [
    verdict.resistance.value > 0 ? 'resisted' : '',
    verdict.saturation > 0 ? 'saturated' : '',
  ].filter((cause) => cause.length > 0);

  return causes.length === 0 ? '' : `  · ${causes.join(', ')}`;
}

function colourFor(verdict: TagVerdict): string {
  if (verdict.resistance.kind === 'immune' || verdict.atFloor) return DANGER_INK;
  if (verdict.attunement === 'ascendant') return PLAYER_INK;
  if (verdict.attunement === 'suppressed') return GUARD_INK;
  return INK;
}

function padded(tag: Tag): string {
  return tag.padEnd(NAME_WIDTH, ' ');
}
