import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import StudentSource, {
  parseQuickNames,
  type SourceMode,
} from '../components/StudentSource';
import { db, type Student } from '../db';
import { shuffle } from '../lib/shuffle';

type Slot = string | null;

interface Match {
  id: string;
  round: number;
  slotIndex: number;
  playerA: Slot;
  playerB: Slot;
  winner: Slot;
}

function buildBracket(players: string[]): Match[][] {
  const size = 1 << Math.ceil(Math.log2(Math.max(2, players.length)));
  const padded: Slot[] = [...players, ...Array(size - players.length).fill(null)];
  const rounds: Match[][] = [];

  const first: Match[] = [];
  for (let i = 0; i < size / 2; i++) {
    const a = padded[i * 2];
    const b = padded[i * 2 + 1];
    first.push({
      id: `r0-m${i}`,
      round: 0,
      slotIndex: i,
      playerA: a,
      playerB: b,
      winner: a && !b ? a : !a && b ? b : null,
    });
  }
  rounds.push(first);

  let prev = first;
  let round = 1;
  while (prev.length > 1) {
    const next: Match[] = [];
    for (let i = 0; i < prev.length / 2; i++) {
      next.push({
        id: `r${round}-m${i}`,
        round,
        slotIndex: i,
        playerA: prev[i * 2].winner,
        playerB: prev[i * 2 + 1].winner,
        winner: null,
      });
    }
    rounds.push(next);
    prev = next;
    round++;
  }

  return rounds;
}

export default function TournamentPage() {
  const [mode, setMode] = useState<SourceMode>('class');
  const [classId, setClassId] = useState<number | null>(null);
  const [quickText, setQuickText] = useState('');
  const [bracket, setBracket] = useState<Match[][]>([]);

  const classStudents = useLiveQuery<Student[]>(
    () =>
      mode === 'class' && classId
        ? db.students.where('classId').equals(classId).sortBy('number')
        : Promise.resolve([] as Student[]),
    [mode, classId],
  );

  const names = useMemo(() => {
    if (mode === 'class') return classStudents?.map((s) => s.name) ?? [];
    return parseQuickNames(quickText);
  }, [mode, classStudents, quickText]);

  function generate() {
    if (names.length < 2) return;
    const shuffled = shuffle(names);
    setBracket(buildBracket(shuffled));

    if (mode === 'class' && classId) {
      db.history.add({
        classId,
        tool: 'tournament',
        title: `토너먼트 ${shuffled.length}명`,
        payload: { players: shuffled },
        createdAt: Date.now(),
      });
    }
  }

  function pickWinner(roundIdx: number, matchIdx: number, winner: Slot) {
    if (!winner) return;
    const next = bracket.map((r) => r.map((m) => ({ ...m })));
    next[roundIdx][matchIdx].winner = winner;

    const nextRound = next[roundIdx + 1];
    if (nextRound) {
      const parent = nextRound[Math.floor(matchIdx / 2)];
      if (matchIdx % 2 === 0) parent.playerA = winner;
      else parent.playerB = winner;
      parent.winner = null;
      for (let r = roundIdx + 2; r < next.length; r++) {
        const idxInR = Math.floor(matchIdx / (1 << (r - roundIdx)));
        const m = next[r][idxInR];
        if (matchIdx % (1 << (r - roundIdx)) < 1 << (r - roundIdx - 1)) {
          m.playerA = null;
        } else {
          m.playerB = null;
        }
        m.winner = null;
      }
    }
    setBracket(next);
  }

  const champion = useMemo(() => {
    if (bracket.length === 0) return null;
    return bracket[bracket.length - 1][0]?.winner ?? null;
  }, [bracket]);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-4">1대1 토너먼트</h1>

      <div className="mb-4">
        <StudentSource
          mode={mode}
          onModeChange={setMode}
          classId={classId}
          onClassChange={setClassId}
          quickText={quickText}
          onQuickTextChange={setQuickText}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-white border border-slate-200 rounded-lg">
        <button
          onClick={generate}
          disabled={names.length < 2}
          className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:bg-slate-300"
        >
          대진표 생성
        </button>
        <span className="text-sm text-slate-600">
          참가자 {names.length}명
          {names.length < 2 && (
            <span className="ml-2 text-red-600">2명 이상 필요합니다.</span>
          )}
        </span>
      </div>

      {champion && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg text-center">
          <div className="text-sm text-amber-700">우승</div>
          <div className="text-2xl font-bold text-amber-900">🏆 {champion}</div>
        </div>
      )}

      {bracket.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex gap-6 min-w-max">
            {bracket.map((round, ri) => (
              <div key={ri} className="flex flex-col justify-around gap-4 min-w-[180px]">
                <div className="text-xs text-slate-500 text-center font-semibold">
                  {ri === bracket.length - 1
                    ? '결승'
                    : ri === bracket.length - 2
                      ? '준결승'
                      : `${ri + 1}라운드`}
                </div>
                {round.map((m, mi) => (
                  <div
                    key={m.id}
                    className="bg-white border border-slate-200 rounded-md overflow-hidden"
                  >
                    {(['playerA', 'playerB'] as const).map((key) => {
                      const p = m[key];
                      const isWinner = m.winner && p === m.winner;
                      return (
                        <button
                          key={key}
                          disabled={!p}
                          onClick={() => pickWinner(ri, mi, p)}
                          className={`block w-full text-left px-3 py-2 text-sm border-b last:border-b-0 transition ${
                            isWinner
                              ? 'bg-slate-900 text-white font-semibold'
                              : p
                                ? 'hover:bg-slate-100 text-slate-800'
                                : 'text-slate-300 bg-slate-50'
                          }`}
                        >
                          {p ?? '부전승'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
