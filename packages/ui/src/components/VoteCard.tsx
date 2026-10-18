import { DoorOpen, Gavel } from 'lucide-react';
import type * as api from '../lib/api';
import { formatCountdown, secondsUntil } from '../lib/utils';
import { useNow } from '../hooks/useNow';

interface VoteCardProps {
  vote: api.Vote & { yesCount: number; noCount: number };
  currentUserId: number;
  /** null until I've voted */
  myBallot: boolean | null;
  onBallot: (voteYes: boolean) => void;
}

/**
 * The room's running vote — jail someone, or release someone jailed from this room —
 * docked above the control bar: countdown, tally, and the two ballot buttons.
 */
export function VoteCard({ vote, currentUserId, myBallot, onBallot }: VoteCardProps) {
  const now = useNow(true);
  const lift = vote.kind === 'lift';
  const isTarget = vote.targetUserId === currentUserId;
  const name = vote.targetDisplayName;
  const needed = Math.floor(vote.eligibleCount / 2) + 1;
  const pct = (n: number) => (vote.eligibleCount > 0 ? Math.min(100, (n / vote.eligibleCount) * 100) : 0);
  const starter = vote.initiatedBy.id === currentUserId ? 'you' : vote.initiatedBy.displayName;

  // "Yes" is the action (jail / release); its colour follows what it does
  const yesWord = lift ? 'release' : 'jail';
  const noWord = lift ? 'keep in jail' : 'keep';
  const yesBar = lift ? 'bg-green-500' : 'bg-red-500';
  const noBar = lift ? 'bg-red-500' : 'bg-green-500';
  const yesButton = lift
    ? 'bg-green-600 text-white hover:bg-green-500 focus-visible:ring-green-400'
    : 'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400';
  const button = 'px-3 py-1 text-xs font-medium rounded-lg transition-colors focus-visible:ring-2';

  return (
    <div
      role="group"
      aria-label={lift ? `Vote to release ${name}` : `Vote to jail ${name}`}
      className="pointer-events-auto w-full max-w-[460px] px-3.5 py-3 rounded-2xl border border-amber-500/40 bg-white/85 dark:bg-zinc-800/85 backdrop-blur-xl shadow-lg animate-[fadeSlideIn_0.2s_ease-out]"
    >
      <div className="flex items-center gap-2 text-[13px]">
        {lift
          ? <DoorOpen size={15} className="text-amber-500 shrink-0" />
          : <Gavel size={15} className="text-amber-500 shrink-0" />}
        <span className="min-w-0 truncate">
          <b className="font-semibold text-amber-600 dark:text-amber-400">
            {lift ? `Vote to release ${name} from jail` : `Vote to jail ${isTarget ? 'you' : name}`}
          </b>
          {!lift && <span className="text-zinc-500"> · {Math.round(vote.durationSecs / 60)} min</span>}
        </span>
        <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          {formatCountdown(secondsUntil(vote.expiresAt, now))}
        </span>
      </div>

      <div className="my-2.5 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex">
        <span className={`${yesBar} transition-[width]`} style={{ width: `${pct(vote.yesCount)}%` }} />
        <span className={`${noBar} ml-auto transition-[width]`} style={{ width: `${pct(vote.noCount)}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="min-w-0">
          {vote.yesCount} {yesWord} · {vote.noCount} {noWord} · needs {needed} of {vote.eligibleCount} — started by {starter}
        </span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {isTarget ? (
            <span className="font-medium text-red-500 dark:text-red-400">You're being voted on</span>
          ) : myBallot === null ? (
            <>
              <button onClick={() => onBallot(true)} className={`${button} ${yesButton}`}>
                {lift ? 'Release' : 'Jail'}
              </button>
              <button
                onClick={() => onBallot(false)}
                className={`${button} bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 focus-visible:ring-indigo-500`}
              >
                {lift ? 'Keep in jail' : 'Keep'}
              </button>
            </>
          ) : (
            <span className="font-medium">You voted {myBallot ? yesWord : noWord}</span>
          )}
        </div>
      </div>
    </div>
  );
}
