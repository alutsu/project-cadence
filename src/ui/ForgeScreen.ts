import Phaser from 'phaser';
import { socketPrice, socketsOf, type SocketPrice, type SocketRefusal } from '../run/socket.ts';
import { maxHpFloor, socketRefusalFor, type RunState } from '../run/RunState.ts';
import { FRAMES, GEM_TIERS, type Frame, type GemTier } from '../sim/gem.ts';
import { frameTable, rangeAt, type FrameRoll } from '../data/frames.ts';
import { MATERIAL_NAMES } from '../run/materials.ts';
import type { CardId } from '../sim/ids.ts';
import { COLORS, DANGER_INK, FONT, INK, LAYOUT, MUTED, PLAYER_INK, TYPE } from './theme.ts';

/**
 * The forge (GDD §6.1, §6.2, §15.2).
 *
 * P5 budgets six systems and two numbers on screen, and the combat screen has
 * already spent that on the queue and the hand. The build is *made* here and
 * *used* there, so keeping them apart costs the fight nothing.
 *
 * **This screen was a debug affordance and read like one.** A playtester
 * understood nothing on it: it listed ten frame names with no hint of what any
 * did, offered keys for acts that could not be afforded, and never showed which
 * card was selected — so "1-9 pick a deck card" pointed at a choice with no
 * visible result. What it needed was not more information but the three things
 * a player acts on: **what is selected**, **what each act would cost**, and
 * **why an act is unavailable**.
 *
 * §15.2: "no undo, but confirm dialogs on all irreversible acts". Socketing
 * spends Max HP whether it succeeds or not, and removal destroys the gem, so
 * both ask twice.
 */

export interface ForgeAction {
  readonly kind: 'craft' | 'socket' | 'seat' | 'unseat' | 'reroll' | 'upgrade';
  readonly card: CardId | null;
  readonly frame: Frame | null;
  readonly tier: GemTier;
}

/** What the player has set up on this screen. Presentation, not game state. */
export interface ForgeSelection {
  readonly selected: CardId | null;
  readonly frame: Frame;
  readonly tier: GemTier;
  /** Why the last act did nothing, if it did nothing. */
  readonly notice: string;
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
  private readonly catalogue: Phaser.GameObjects.Text;
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
        .setAlpha(1),
    );
    this.body = scene.add
      .text(LAYOUT.width / 2 - LAYOUT.forge.width / 2, LAYOUT.forge.top, '', {
        fontFamily: FONT,
        fontSize: TYPE.forgeRow,
        color: INK,
        lineSpacing: 8,
      })
      .setOrigin(0, 0);
    this.catalogue = scene.add
      .text(LAYOUT.forge.catalogueLeft, LAYOUT.forge.top, '', {
        fontFamily: FONT,
        fontSize: TYPE.forgeRow,
        color: INK,
        lineSpacing: 8,
      })
      .setOrigin(0, 0);
    this.prompt = scene.add
      .text(LAYOUT.width / 2, LAYOUT.forge.promptY, '', {
        fontFamily: FONT,
        fontSize: TYPE.button,
        color: PLAYER_INK,
      })
      .setOrigin(0.5, 0.5);

    this.view.add([this.body, this.catalogue, this.prompt]);
    this.setOpen(false);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Opens or closes. The caller renders, since only it knows the selection. */
  toggle(): boolean {
    this.setOpen(!this.open);
    this.pending = null;
    return this.open;
  }

  /**
   * Takes an act, or arms it. An irreversible one is armed on the first press
   * and taken on the second — the confirm §15.2 asks for, expressed as a state
   * of the screen rather than as a modal that steals the keyboard.
   */
  act(action: ForgeAction, run: RunState): void {
    const armed = this.pending?.action;
    this.pending = null;

    // The same act again is the confirmation §15.2 asks for.
    if (armed?.kind === action.kind && armed.card === action.card) {
      this.options.onAct(armed);
      return;
    }

    if (!IRREVERSIBLE.includes(action.kind)) {
      this.options.onAct(action);
      return;
    }

    // A *different* irreversible act arms itself rather than merely cancelling
    // the last one. Cancelling silently meant changing your mind cost three
    // presses and looked like the key had done nothing.
    //
    // Armed, not taken: the caller re-renders, which is what puts the warning on
    // screen, because §15.2 wants the second press to be an informed one.
    this.pending = { action, warning: warningFor(action, run) };
  }

  render(run: RunState, showing: ForgeSelection): void {
    if (!this.open) return;
    this.catalogue.setText(catalogueLines(run, showing).join('\n'));
    const { selected, frame, notice } = showing;

    this.body.setText(
      [
        'THE FORGE',
        '',
        ...selectionLines(run, selected, frame),
        '',
        'YOUR CARDS   (press 1-7 to choose one)',
        ...deckLines(run, selected),
        '',
        'GEMS YOU HAVE MADE, NOT YET SET',
        ...pouchLines(run),
      ].join('\n'),
    );

    // A pending confirmation outranks a notice; both outrank the resting line.
    const line = this.pending?.warning ?? (notice.length > 0 ? notice : 'F  ·  leave the forge');
    this.prompt.setText(line);
    this.prompt.setColor(this.pending !== null || notice.length > 0 ? DANGER_INK : MUTED);
  }

  destroy(): void {
    this.view.destroy(true);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.view.setVisible(open);
  }
}

/**
 * What is selected, and what each act would do to it right now.
 *
 * The three lines a player acts on. An act that cannot be taken says so and
 * says why, rather than being a key that silently does nothing — which is what
 * every key on this screen used to be when the purse was empty.
 */
function selectionLines(run: RunState, selected: CardId | null, frame: Frame): readonly string[] {
  if (selected === null) {
    return ['  pick a card below with 1-7, then choose what to do to it', ''];
  }

  const sockets = socketsOf(run.build.sockets, selected);
  const price = socketPrice({
    sockets,
    maxHp: run.maxHp,
    floor: maxHpFloor(run),
    insight: run.insight,
  });
  const seated = sockets.gems.map((id) => run.build.gems[id]?.frame ?? '?');
  const held = GEM_TIERS.reduce((total, tier) => total + run.materials[tier], 0);
  const next = run.pouch[0];

  return [
    `  SELECTED: ${String(selected)}  —  ${String(sockets.opened)} socket(s), holding [${seated.join(', ') || 'nothing'}]${sockets.scarred ? '  (scarred: a failed attempt costs half again)' : ''}`,
    '',
    `  S  open a socket   ${socketOffer(run, selected, price)}`,
    `  C  craft a ${frame} gem   ${craftOffer(held)}`,
    `  E  set a gem in it   ${seatOffer(run, sockets.opened - sockets.gems.length, next)}`,
    `  X  take a gem out   ${seated.length > 0 ? 'destroys it — a removed gem is gone' : '— nothing set in this card'}`,
    `  R  reroll a gem's numbers   ${run.insight > 0 ? 'costs 1 insight, keeps the frame' : '— no insight'}`,
    `  U  three of a material become one of the next   ${held >= 3 ? 'ready' : '— not enough'}`,
  ];
}

/**
 * What opening a socket would cost, or the run's own reason it cannot.
 *
 * The refusal comes from `socketRefusalFor`, which is §6.1's rule — the view
 * used to re-derive the floor check and could therefore have disagreed with the
 * forge that applies it.
 */
function socketOffer(run: RunState, card: CardId, price: SocketPrice | null): string {
  const refusal = socketRefusalFor(run, card);
  if (refusal !== null) return REFUSALS[refusal.reason];
  if (price === null) return '— this card is full';

  const insight = price.insight > 0 ? ` and ${String(price.insight)} insight` : '';
  return `costs ${String(price.maxHp)} max HP${insight}, permanently · ${String(Math.round(price.chance * 100))}% to succeed`;
}

const REFUSALS: Readonly<Record<SocketRefusal['reason'], string>> = {
  no_socket_left: '— this card is full',
  would_breach_floor: '— would take your maximum health below its floor',
  not_enough_insight: '— you have no insight for a third socket',
};

function craftOffer(held: number): string {
  return held > 0 ? 'spends 1 material · the numbers roll' : '— no materials (win a fight)';
}

function seatOffer(run: RunState, open: number, next: string | undefined): string {
  if (next === undefined) return '— no gem made yet';
  if (open <= 0) return '— no open socket on this card';
  return `${run.build.gems[next]?.frame ?? '?'} into an open socket · permanent`;
}

/** One line each, because ten bare frame names told a playtester nothing. */
/**
 * The gem catalogue: every frame you could craft, listed at once.
 *
 * It used to be one frame at a time behind a cycling key, which is a list you
 * cannot read — comparing ten options meant remembering nine of them. §6.3's
 * anti-meta argument only works if the player can *see* the shapes on offer and
 * still not know the numbers; hiding the shapes as well just makes crafting a
 * lottery. So the frames and their drawbacks are all on screen, and the rolled
 * values remain unknown until spent.
 *
 * P3 (value is unstable, not hidden) is why the selected frame shows its roll
 * *ranges* at the chosen tier. The player commits knowing the spread and not
 * the outcome, which is the intended trade and not a hidden one.
 */
function catalogueLines(run: RunState, showing: ForgeSelection): readonly string[] {
  const { frame, tier } = showing;
  const held = run.materials[tier];
  const affordable = held > 0;

  const rows = FRAMES.map((candidate) => {
    const marker = candidate === frame ? '\u25b8' : ' ';
    return `  ${marker} ${candidate.padEnd(8)} ${FRAME_NOTES[candidate]}`;
  });

  return [
    'GEMS YOU CAN MAKE',
    `  Q  moves the pick     T  changes tier`,
    '',
    ...rows,
    '',
    `  ${frame} at tier ${String(tier)} (${MATERIAL_NAMES[tier]}), if you craft it now:`,
    ...rollLines(frame, tier),
    '',
    affordable
      ? `  you hold ${String(held)} ${MATERIAL_NAMES[tier]}  —  press C to craft it`
      : `  you hold no ${MATERIAL_NAMES[tier]}  —  T picks another tier`,
  ];
}

/**
 * What the selected frame would roll, at this tier. Ranges, never a single
 * number: the frame is chosen and the values are not (§6.2).
 */
function rollLines(frame: Frame, tier: GemTier): readonly string[] {
  const recipe = frameTable()[frame];
  if (recipe === undefined) return ['    (no recipe)'];

  const rolls = recipe.rolls.map((roll) => `    ${atomLine(roll, tier)}`);
  return [...rolls, `    the cost of it: ${recipe.drawback}`];
}

function atomLine(roll: FrameRoll, tier: GemTier): string {
  const { low, high } = rangeAt(roll, tier);
  const label = ATOM_LABELS[roll.type] ?? roll.type.toLowerCase().replace(/_/gu, ' ');
  return `${label.padEnd(22)} ${spread(low, high)}`;
}

/** A range reads as one number when it cannot vary, which most tiers cannot. */
function spread(low: number, high: number): string {
  const fixed = Number.isInteger(low) && Number.isInteger(high);
  const show = (value: number): string =>
    fixed ? String(value) : `${String(Math.round(value * 100))}%`;

  return low === high ? show(low) : `${show(low)} to ${show(high)}`;
}

/**
 * Plain English for each effect atom. The atom names are the registry's
 * vocabulary (docs/M1_PLAN.md D33) and belong in code, not in a player's face.
 */
const ATOM_LABELS: Readonly<Record<string, string>> = {
  EXTRA_STRIKE: 'extra strikes',
  DAMAGE_MULT: 'damage',
  WEIGHT_DELTA: 'Weight',
  RECOVERY_DELTA: 'Recovery',
  GUARD_GAIN: 'Guard granted',
  SIPHON_HIT: 'healed per hit',
  POISE_FACTOR: 'counted against Poise',
  STAGGER_BONUS: 'extra Stagger',
  STATUS_DURATION: 'status lasts',
  STATUS_MAGNITUDE: 'status strength',
  CONVERT_TAG: 'changes the tag to',
  CHARGE_ON_KILL: 'charges stored on a kill',
  CONSUME_CHARGES: 'charges spent',
  SPEND_CHARGES: 'damage per charge',
  RETURN_TO_HAND: 'returns to hand',
  MARK_USED: 'once a fight',
};

const FRAME_NOTES: Readonly<Record<Frame, string>> = {
  REPEAT: 'strikes twice, each for less',
  CHARGE: 'stores a charge on a kill',
  SPEND: 'turns stored charges into damage',
  SIPHON: 'heals you for part of the damage',
  BREAK: 'counts for more against Poise',
  HASTE: 'costs less time',
  KINDLE: 'changes the card to another tag',
  ECHO: 'returns to hand once a fight',
  WARD: 'puts Guard up as well',
  LINGER: 'its effect lasts longer, and hits softer',
};

/**
 * One line per distinct card, with what its next socket would cost. The price
 * comes from the sim's own table — the forge never works out a percentage
 * (CLAUDE.md §2.1), which matters here because it is the number the whole
 * decision turns on.
 */
function deckLines(run: RunState, selected: CardId | null): readonly string[] {
  return [...new Set(run.deck)].map((card, index) => {
    const sockets = socketsOf(run.build.sockets, card);
    const seated = sockets.gems.map((id) => run.build.gems[id]?.frame ?? '?').join(', ');
    const empty = '○'.repeat(Math.max(0, sockets.opened - sockets.gems.length));
    const held =
      sockets.opened === 0 ? 'no sockets' : `${seated}${seated && empty ? ' ' : ''}${empty}`;

    return (
      `  ${card === selected ? '▸' : ' '} ${String(index + 1)}  ` +
      `${String(card).padEnd(13, ' ')}${held}${sockets.scarred ? '   scarred' : ''}`
    );
  });
}

function pouchLines(run: RunState): readonly string[] {
  if (run.pouch.length === 0) return ['  none yet — C crafts one, if you have a material'];

  return run.pouch.map((id, index) => {
    const gem = run.build.gems[id];
    if (gem === undefined) return `  ${String(index + 1)}  ?`;
    const rolled = gem.effects.map((effect) => `${effect.type} ${String(effect.value)}`).join(', ');
    return `  ${String(index + 1)}  T${String(gem.tier)} ${gem.frame}  ${rolled}  W${String(gem.weightDelta)}`;
  });
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
