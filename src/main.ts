import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.ts';
import { CombatScene } from './scenes/CombatScene.ts';
import { MapScene } from './scenes/MapScene.ts';
import { RunScene } from './scenes/RunScene.ts';
import { SanctumScene } from './scenes/SanctumScene.ts';
import { SummaryScene } from './scenes/SummaryScene.ts';
import { LAYOUT } from './ui/theme.ts';

/**
 * The session's seed (GDD §13, §20.2). Taken from `?seed=` when present so a
 * run can be replayed exactly — which is what "Retry this seed" is built on,
 * and what lets a playtester report the run they were looking at.
 */
function readSeed(): number {
  const requested = new URLSearchParams(window.location.search).get('seed');
  const parsed = requested === null ? Number.NaN : Number(requested);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const SEED = readSeed();
const SESSION = `seed${String(SEED)}-${String(Date.now())}`;

// GDD §16: design at 1920x1080, scale down to 1280x720.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: LAYOUT.width,
  height: LAYOUT.height,
  backgroundColor: '#0b0d12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // RunScene owns the run and starts the rest; the others render one view
  // of it and report back (CLAUDE.md §4.1).
  scene: [
    BootScene,
    new RunScene(SEED, SESSION),
    MapScene,
    CombatScene,
    SanctumScene,
    SummaryScene,
  ],
});
