import Phaser from 'phaser';
import type { RunState } from '../run/RunState.ts';
import { maxHpFloor } from '../run/RunState.ts';
import { saturationOf } from '../sim/saturation.ts';
import { TAG_GLYPHS, TAGS } from '../sim/tag.ts';
import { weaveVerdict, NO_RESISTANCE } from '../sim/weave.ts';
import { DANGER_INK, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The run summary (GDD §13).
 *
 * Everything here is read from run state or from the sim — the Weave row uses
 * `weaveVerdict`, the same function the combat panel reads, so the number the
 * summary reports is the number the run was actually playing with
 * (CLAUDE.md §2.1).
 */

export interface RunSummaryState {
  readonly run: RunState;
  readonly won: boolean;
  readonly depths: number;
}

export interface RunSummaryOptions {
  readonly scene: Phaser.Scene;
  readonly onRetrySeed: () => void;
  readonly onNewRun: () => void;
}

export class RunSummaryView {
  private readonly options: RunSummaryOptions;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly buttons: Phaser.GameObjects.Container;

  constructor(options: RunSummaryOptions) {
    this.options = options;
    const { scene } = options;

    this.heading = scene.add
      .text(LAYOUT.width / 2, 180, '', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: INK,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
    this.body = scene.add
      .text(LAYOUT.width / 2, 300, '', {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: MUTED,
        align: 'left',
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.buttons = scene.add.container(0, 0);
  }

  render(state: RunSummaryState): void {
    const { run } = state;
    this.heading.setText(
      state.won
        ? 'THE RUN IS YOURS'
        : `THE RUN ENDS AT DEPTH ${String(run.position.depth)} OF ${String(state.depths)}`,
    );
    this.heading.setColor(state.won ? PLAYER_INK : DANGER_INK);
    this.body.setText(summaryLines(run).join('\n'));

    this.buttons.removeAll(true);
    // §13: "Retry this seed." Free, and no reward penalty — the point is to let
    // a player prove to themselves the loss was a decision.
    this.button('RETRY THIS SEED', LAYOUT.width / 2 - 230, this.options.onRetrySeed);
    this.button('A NEW SEED', LAYOUT.width / 2 + 230, this.options.onNewRun);
  }

  destroy(): void {
    this.heading.destroy();
    this.body.destroy();
    this.buttons.destroy(true);
  }

  private button(label: string, x: number, onPress: () => void): void {
    const { scene } = this.options;
    const panel = scene.add
      .rectangle(x, LAYOUT.height - 160, 380, 84, 0x151a23)
      .setStrokeStyle(2, 0x2b3342);
    panel.setInteractive({ useHandCursor: true });
    panel.on('pointerdown', onPress);

    const text = scene.add
      .text(x, LAYOUT.height - 160, label, {
        fontFamily: FONT,
        fontSize: TYPE.slotName,
        color: PLAYER_INK,
      })
      .setOrigin(0.5, 0.5);

    this.buttons.add([panel, text]);
  }
}

/** §13's list: depth, build, Weave state, seed. */
function summaryLines(run: RunState): readonly string[] {
  const build = Object.entries(run.build.sockets)
    .filter(([, sockets]) => sockets.opened > 0)
    .map(([card, sockets]) => {
      const frames = sockets.gems.map((id) => run.build.gems[id]?.frame ?? '?');
      const empty = sockets.opened - sockets.gems.length;
      const slots = [...frames, ...Array.from({ length: empty }, () => 'empty')];
      return `    ${card}  [${slots.join(', ')}]${sockets.scarred ? '  scarred' : ''}`;
    });

  const saturation = saturationOf(run.saturation);
  const weave = TAGS.map((tag) => {
    const verdict = weaveVerdict({
      tag,
      weave: { attunement: run.attunement, saturation },
      resistances: NO_RESISTANCE,
    });
    return `${TAG_GLYPHS[tag]} ${tag} ×${verdict.multiplier.toFixed(2)}`;
  });

  return [
    `  seed ${String(run.seed)}`,
    `  level ${String(run.level)} · ${String(run.deck.length)} cards · threat ${String(run.threat)}`,
    `  ${String(run.hp)}/${String(run.maxHp)} HP · Max HP floor ${String(maxHpFloor(run))}`,
    // §13's summary is the run's ledger, so it reports what §9 tracks. Gold was
    // missing because until now nothing in the game had any.
    `  ${String(run.gold)} gold · insight ${String(run.insight)} · ${String(run.removals)} cards removed`,
    '',
    '  BUILD',
    ...(build.length === 0 ? ['    nothing socketed'] : build),
    '',
    '  THE WEAVE, unresisted',
    `    ${weave.slice(0, 3).join('   ')}`,
    `    ${weave.slice(3).join('   ')}`,
  ];
}
