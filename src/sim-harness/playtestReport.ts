import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EncounterRecord,
  NodeRecord,
  PlaytestEvent,
  RunSummaryRecord,
} from '../run/telemetry.ts';

/**
 * Reading a playtest back (GDD §19).
 *
 * The harness's policies are a floor and a *relative* instrument
 * (docs/M2_PLAN.md D35a) — they told us S1 was a regression when a human found
 * it fine. This is the other half of that lesson: a record of what actually
 * happened when a person played, in the same units the balance report uses, so
 * the two can be read against each other instead of one being guessed from the
 * other.
 *
 * Everything printed is straight from the log. Nothing is inferred.
 */

const PLAYTEST_DIR = 'playtest';

export function latestSession(dir: string = PLAYTEST_DIR): string | null {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
    .map((entry) => join(dir, entry.name));

  if (files.length === 0) return null;

  return files.reduce((newest, path) =>
    statSync(path).mtimeMs > statSync(newest).mtimeMs ? path : newest,
  );
}

export function readSession(path: string): readonly PlaytestEvent[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line): PlaytestEvent | null => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isEvent(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((event): event is PlaytestEvent => event !== null);
}

function isEvent(value: unknown): value is PlaytestEvent {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

/** Where a fight sat: how long, how much it cost, and what it was against. */
function encounterLine(record: EncounterRecord): string {
  const hp = `${pad(record.hpBefore, 3)}→${pad(record.hpAfter, 3)}`;
  const verdict = record.won ? '  ' : '☠ ';
  return (
    `  ${verdict}d${String(record.depth)}  ${pad(record.ticks, 4)}t  ` +
    `${pad(record.decisions, 3)} dec  HP ${hp}  ` +
    `-${pad(record.damageTaken, 3)}  grd ${pad(record.guardAbsorbed, 3)}  ` +
    `stg ${pad(record.staggers, 2)}  ${record.enemies.join(' + ')}` +
    (record.killedBy === null ? '' : `   ← ${record.killedBy}`)
  );
}

function nodeLine(record: NodeRecord): string {
  return (
    `\n  ── depth ${String(record.depth)} · ${record.kind}${record.elite ? ' (elite)' : ''}` +
    ` · rating ${String(record.rating)} · threat ${String(record.threat)}` +
    ` · enemies lvl ${String(record.level)}` +
    ` · you lvl ${String(record.playerLevel)}, ${String(record.deck)} cards,` +
    ` ${String(record.hp)}/${String(record.maxHp)} HP` +
    (record.omen === null ? '' : ` · omen ${record.omen}`)
  );
}

function summaryLines(summary: RunSummaryRecord): readonly string[] {
  const build = Object.entries(summary.build)
    .filter(([, frames]) => frames.length > 0)
    .map(([card, frames]) => `${card}[${frames.join(',')}]`);

  return [
    '',
    summary.won ? 'RUN WON' : `RUN ENDED at depth ${String(summary.depthReached)}`,
    `  seed ${String(summary.seed)} · level ${String(summary.level)} · threat ${String(summary.threat)}` +
      ` · ${String(summary.hp)}/${String(summary.maxHp)} HP`,
    `  build: ${build.length === 0 ? '(nothing socketed)' : build.join('  ')}`,
    // §19 names this directly, and it is the cheapest balance finding there is.
    `  never played: ${summary.cardsNeverPlayed.length === 0 ? '(all cards used)' : summary.cardsNeverPlayed.join(', ')}`,
    `  saturation window: ${summary.saturation.map((tag) => tag ?? '-').join(' ')}`,
  ];
}

/**
 * What the session says, and what to look at.
 *
 * The flags at the end are §19's red lines and this project's own findings —
 * they are stated as questions rather than verdicts, because a playtest is one
 * person's evening and the harness is the thing that runs ten thousand seeds.
 */
export function playtestReport(events: readonly PlaytestEvent[]): string {
  const lines: string[] = [];
  const encounters: EncounterRecord[] = [];

  for (const event of events) {
    if (event.kind === 'run_started') {
      lines.push(`SESSION seed ${String(event.seed)}`);
    } else if (event.kind === 'node_entered') {
      lines.push(nodeLine(event.node));
    } else if (event.kind === 'encounter_ended') {
      encounters.push(event.encounter);
      lines.push(encounterLine(event.encounter));
    } else if (event.kind === 'run_ended') {
      lines.push(...summaryLines(event.summary));
    }
  }

  if (encounters.length === 0) return 'the session recorded no encounters';

  return [...lines, '', ...findings(encounters)].join('\n');
}

function findings(encounters: readonly EncounterRecord[]): readonly string[] {
  const ticks = encounters.map((record) => record.ticks);
  const longest = Math.max(...ticks);
  const shortest = Math.min(...ticks);
  const played = new Map<string, number>();
  for (const record of encounters) {
    for (const [card, count] of Object.entries(record.cardsPlayed)) {
      played.set(card, (played.get(card) ?? 0) + count);
    }
  }
  const turns = [...played.values()].reduce((total, count) => total + count, 0);

  const found: string[] = ['WHAT TO LOOK AT'];
  found.push(
    `  ${String(encounters.length)} fights · ` +
      `${String(Math.round(ticks.reduce((a, b) => a + b, 0) / ticks.length))} ticks each on average` +
      ` (${String(shortest)}–${String(longest)})`,
  );

  // §19's red flag: any encounter with a duration variance above 2x.
  if (longest > shortest * 2) {
    found.push(
      `  ! fight length varies more than 2x (${String(shortest)} to ${String(longest)} ticks) — §19 flags this`,
    );
  }

  // §19's other one: any card played in under 5% of turns.
  const rare = [...played.entries()].filter(([, count]) => count / turns < 0.05);
  if (rare.length > 0) {
    found.push(`  ! barely played (<5% of turns): ${rare.map(([card]) => card).join(', ')}`);
  }

  const died = encounters.filter((record) => !record.won);
  if (died.length > 0) {
    const last = died[died.length - 1];
    found.push(
      `  ! died at depth ${String(last?.depth ?? 0)} to ${last?.killedBy ?? 'something'}` +
        ` with ${String(last?.hpBefore ?? 0)} HP entering`,
    );
  }

  const unguarded = encounters.filter((record) => record.guardAbsorbed === 0);
  if (unguarded.length > encounters.length / 2) {
    // M0's gate answered "no" to whether Guard was readable; if it is never
    // absorbing anything, that answer has not really changed.
    found.push(
      `  ! Guard absorbed nothing in ${String(unguarded.length)} of ${String(encounters.length)} fights`,
    );
  }

  const nostagger = encounters.filter((record) => record.staggers === 0);
  if (nostagger.length > encounters.length / 2) {
    found.push(
      `  ! nothing was staggered in ${String(nostagger.length)} of ${String(encounters.length)} fights`,
    );
  }

  return found;
}

/** The most recent session, read and reported. */
export function reportLatest(dir: string = PLAYTEST_DIR): string {
  const path = latestSession(dir);
  if (path === null) return `no playtest sessions in ${dir}/ — play with \`npm run dev\` first`;

  return `${path}\n\n${playtestReport(readSession(path))}`;
}
