import Phaser from 'phaser';
import { MATERIAL_NAMES } from '../run/materials.ts';
import { socketPrice, socketsOf } from '../run/socket.ts';
import { maxHpFloor, type RunState } from '../run/RunState.ts';
import { FRAMES, GEM_TIERS, type Frame, type GemTier } from '../sim/gem.ts';
import type { CardId } from '../sim/ids.ts';
import { COLORS, DANGER_INK, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The forge (GDD §6.1, §6.2) — a screen of its own, not a panel.
 *
 * P5 budgets six systems and two numbers on screen, and the combat screen has
 * already spent that on the queue and the hand. The build is *made* here and
 * *used* there, so keeping them apart costs the fight nothing.
 *
 * §15.2: "no undo, but confirm dialogs on all irreversible acts (socketing, gem
 * removal, card removal)". Socketing spends Max HP whether it succeeds or not
 * and removal destroys the gem, so both ask twice.
 */

export interface ForgeAction {
  readonly kind: 'craft' | 'socket' | 'seat' | 'unseat' | 'reroll' | 'upgrade';
  readonly card: CardId | null;
  readonly frame: Frame | null;
  readonly tier: GemTier;
}

export interface ForgeOptions {
  readonly scene: Phaser.Scene;
  readonly onAct: (action: ForgeAction) => void;
  readonly onClose: () => void;
}

/** An act that cannot be taken back, waiting on a second press (§15.2). */
interface Pending {
  readonly action: ForgeAction;
  readonly warning: string;
}

const IRREVERSIBLE: readonly ForgeAction['kind'][] = ['socket', 'seat', 'unseat'];

export class ForgeScreen {
  private readonly options: ForgeOptions;
  private readonly view: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Text;
  private readonly prompt: Phaser.GameObjects.Text;
  private pending: Pending | null = null;
  private open = false;

  constructor(options: ForgeOptions) {
    this.options = options;
    const { scene } = options;
    this.view = scene.add.container(0, 0).setDepth(50);

    this.view.add(
      scene.add
        .rectangle(
          LAYOUT.width / 2,
          LAYOUT.height / 2,
          LAYOUT.width,
          LAYOUT.height,
          COLORS.background,
        )
        .setAlpha(0.97),
    );
    this.body = scene.add
      .text(LAYOUT.width / 2 - LAYOUT.forge.width / 2, LAYOUT.forge.top, '', {
        fontFamily: FONT,
        fontSize: TYPE.forgeRow,
        color: INK,
        lineSpacing: 8,
      })
      .setOrigin(0, 0);
    this.prompt = scene.add
      .text(LAYOUT.width / 2, LAYOUT.height - 120, '', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: PLAYER_INK,
      })
      .setOrigin(0.5, 0.5);

    this.view.add([this.body, this.prompt]);
    this.setOpen(false);
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(run: RunState): boolean {
    this.setOpen(!this.open);
    this.pending = null;
    if (this.open) this.render(run);
    return this.open;
  }

  /**
   * Takes an act, or arms it. An irreversible one is armed on the first press
   * and taken on the second — the confirm §15.2 asks for, expressed as a state
   * of the screen rather than as a modal that steals the keyboard.
   */
  act(action: ForgeAction, run: RunState): void {
    if (this.pending !== null) {
      const armed = this.pending.action;
      this.pending = null;
      if (armed.kind === action.kind && armed.card === action.card) this.options.onAct(armed);
      else this.render(run);
      return;
    }

    if (!IRREVERSIBLE.includes(action.kind)) {
      this.options.onAct(action);
      return;
    }

    this.pending = { action, warning: warningFor(action, run) };
    this.render(run);
  }

  render(run: RunState): void {
    if (!this.open) return;

    this.body.setText(
      [
        'THE FORGE',
        '',
        purse(run),
        '',
        'DECK',
        ...deckLines(run),
        '',
        'POUCH',
        ...pouchLines(run),
        '',
        'FRAMES',
        framesLine(),
        '',
        keysLine(),
      ].join('\n'),
    );

    this.prompt.setText(this.pending === null ? 'F  close the forge' : this.pending.warning);
    this.prompt.setColor(this.pending === null ? MUTED : DANGER_INK);
  }

  destroy(): void {
    this.view.destroy(true);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.view.setVisible(open);
  }
}

function purse(run: RunState): string {
  const held = GEM_TIERS.map((tier) => `${MATERIAL_NAMES[tier]} ${String(run.materials[tier])}`);
  return `${held.join('   ')}   ·   Insight ${String(run.insight)}   ·   HP ${String(run.hp)}/${String(run.maxHp)}   ·   floor ${String(maxHpFloor(run))}`;
}

/**
 * One line per distinct card, with what its next socket would cost. The price
 * comes from the sim's own table — the forge never works out a percentage
 * (CLAUDE.md §2.1), which matters here because it is the number the whole
 * decision turns on.
 */
function deckLines(run: RunState): readonly string[] {
  const distinct = [...new Set(run.deck)];

  return distinct.map((card, index) => {
    const sockets = socketsOf(run.build.sockets, card);
    const price = socketPrice({
      sockets,
      maxHp: run.maxHp,
      floor: maxHpFloor(run),
      insight: run.insight,
    });
    const seated = sockets.gems.map((id) => run.build.gems[id]?.frame ?? '?').join(', ');
    const cost =
      price === null
        ? 'full'
        : `next ${String(price.maxHp)} Max HP${price.insight > 0 ? ' + 1 Insight' : ''} at ${String(Math.round(price.chance * 100))}%`;

    return `  ${String(index + 1)}  ${String(card).padEnd(12, ' ')} ${String(sockets.opened)} socket(s)${sockets.scarred ? ' ✕' : ''}  [${seated}]  ${cost}`;
  });
}

function pouchLines(run: RunState): readonly string[] {
  if (run.pouch.length === 0) return ['  (empty — craft one)'];

  return run.pouch.map((id, index) => {
    const gem = run.build.gems[id];
    if (gem === undefined) return `  ${String(index + 1)}  ?`;
    const rolled = gem.effects.map((effect) => `${effect.type} ${String(effect.value)}`).join(', ');
    return `  ${String(index + 1)}  T${String(gem.tier)} ${gem.frame}  ${rolled}  W${String(gem.weightDelta)}`;
  });
}

function framesLine(): string {
  return `  ${FRAMES.join('  ')}`;
}

function keysLine(): string {
  return [
    '  C craft (tier 1)   1-9 pick a deck card   S attempt a socket   E seat a gem',
    '  X remove a gem (destroys it)   R reroll (1 Insight)   U upgrade materials',
  ].join('\n');
}

/** What the confirm actually warns about. Never generic — §15.2's point is
 * that the player knows which irreversible thing they are about to do. */
function warningFor(action: ForgeAction, run: RunState): string {
  if (action.kind === 'unseat') return 'press again — removing the gem DESTROYS it';
  if (action.kind === 'seat') return 'press again — socketing is PERMANENT';

  const card = action.card;
  const sockets = card === null ? null : socketsOf(run.build.sockets, card);
  const price =
    sockets === null
      ? null
      : socketPrice({ sockets, maxHp: run.maxHp, floor: maxHpFloor(run), insight: run.insight });

  return price === null
    ? 'press again to confirm'
    : `press again — spends ${String(price.maxHp)} Max HP even if it fails (${String(Math.round(price.chance * 100))}%)`;
}
