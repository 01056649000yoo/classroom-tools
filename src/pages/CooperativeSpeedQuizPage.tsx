import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import defaultProblemDeck from '../data/idioms.json';
import proverbProblemDeck from '../data/proverbs.json';
import grade3ProblemDeck from '../data/grade3_vocab.json';
import grade4ProblemDeck from '../data/grade4_vocab.json';
import grade5ProblemDeck from '../data/grade5_vocab.json';
import grade6ProblemDeck from '../data/grade6_vocab.json';
import { db, type HistoryEntry } from '../db';
import { type SeatResultSeat } from '../lib/backup';
import { shuffle } from '../lib/shuffle';
import { sfx } from '../lib/sfx';

type ProblemCard = {
  phrase: string;
  meaning: string;
  hint?: string;
};

type PairTeam = {
  id: string;
  label: string;
  members: string[];
  row?: number;
  cols?: number[];
};

type TurnParticipantRole = {
  solver: string;
  explainer: string;
};

type PairTurnResult = {
  questionIndex: number;
  problemIndex: number | null;
  questionNumber: number | null;
  phrase: string;
  answer: string;
  hint?: string;
  outcome: 'correct' | 'pass';
};

type PairTurn = {
  pairId: string;
  order: number;
  roles: TurnParticipantRole;
  questionIndices: Array<number | null>;
  results: PairTurnResult[];
  score: number;
  startedAt: number;
  finishedAt?: number;
};

type SpeedQuizPayload = {
  format: 'cooperative-speed-quiz/v1';
  classId: number;
  seatSignature: string;
  pairs: PairTeam[];
  selectedPackId: string;
  rangeStart: number;
  rangeEnd: number | null;
  questionCount: number;
  timeLimitSec: number;
  turns: PairTurn[];
  status: 'in_progress' | 'completed';
  currentTurnIndex: number;
  createdAt: number;
  finishedAt?: number;
};

type SpeedQuizSession = SpeedQuizPayload & {
  historyId: number | null;
};

type SpeedQuizPackId =
  | 'idiom'
  | 'proverb'
  | 'grade3-vocab'
  | 'grade4-vocab'
  | 'grade5-vocab'
  | 'grade6-vocab';

const DEFAULT_PACK_ID: SpeedQuizPackId = 'idiom';
const PACK_OPTIONS: Array<{ id: SpeedQuizPackId; label: string }> = [
  { id: 'idiom', label: '사자성어 기본팩' },
  { id: 'proverb', label: '속담 기본팩' },
  { id: 'grade3-vocab', label: '3학년 필수 어휘' },
  { id: 'grade4-vocab', label: '4학년 필수 어휘' },
  { id: 'grade5-vocab', label: '5학년 필수 어휘' },
  { id: 'grade6-vocab', label: '6학년 필수 어휘' },
];

function readString(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeMeaningPromptPack(input: unknown): ProblemCard[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).items)
      ? ((input as Record<string, unknown>).items as unknown[])
      : [];

  return source.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const phrase = readString(raw, ['phrase', 'question', 'quiz', 'title']);
    const answer = readString(raw, ['answer', 'meaning', 'description']);
    const explanation = readString(raw, ['meaning', 'description']);
    const hint = readString(raw, ['hint', 'category', 'type']) || undefined;
    const meaning = answer && explanation && answer !== explanation
      ? `${answer}\n뜻: ${explanation}`
      : answer;
    if (!phrase || !meaning) return [];
    return [{ phrase, meaning, hint }];
  });
}

function normalizeVocabularyPack(input: unknown): ProblemCard[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).items)
      ? ((input as Record<string, unknown>).items as unknown[])
      : [];

  return source.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const word = readString(raw, ['word', 'term']);
    const definition = readString(raw, ['definition']);
    const example = readString(raw, ['example']);
    const hint = readString(raw, ['hint', 'category', 'type']) || undefined;
    if (!word || !definition) return [];
    return [{
      phrase: word,
      meaning: example ? `${definition}\n예문: ${example}` : definition,
      hint,
    }];
  });
}

function normalizePackId(value: string): SpeedQuizPackId {
  return PACK_OPTIONS.some((pack) => pack.id === value) ? (value as SpeedQuizPackId) : DEFAULT_PACK_ID;
}

function snapshotFromHistory(entry: HistoryEntry | undefined): SeatResultSeat[] {
  if (!entry || !entry.payload || typeof entry.payload !== 'object') return [];
  const payload = entry.payload as { snapshot?: SeatResultSeat[] };
  return Array.isArray(payload.snapshot) ? payload.snapshot : [];
}

function seatSnapshotSignature(snapshot: SeatResultSeat[]) {
  return JSON.stringify(
    snapshot
      .map((seat) => ({
        row: seat.row,
        col: seat.col,
        name: seat.name,
        number: seat.number ?? null,
        gender: seat.gender ?? null,
      }))
      .sort((a, b) => a.row - b.row || a.col - b.col),
  );
}

function buildPairs(snapshot: SeatResultSeat[]): PairTeam[] {
  const byRow = new Map<number, SeatResultSeat[]>();
  snapshot.forEach((seat) => {
    if (!seat.name) return;
    const list = byRow.get(seat.row) ?? [];
    list.push(seat);
    byRow.set(seat.row, list);
  });

  const pairs: PairTeam[] = [];
  [...byRow.entries()].sort((a, b) => a[0] - b[0]).forEach(([row, seats]) => {
    const sorted = [...seats].sort((a, b) => a.col - b.col);
    for (let i = 0; i < sorted.length; i += 2) {
      const group = sorted.slice(i, i + 2);
      if (group.length === 0) continue;
      pairs.push({
        id: `pair-${pairs.length + 1}`,
        label: `${pairs.length + 1}팀`,
        members: group.map((seat) => seat.name),
        row,
        cols: group.map((seat) => seat.col),
      });
    }
  });
  return pairs;
}

function pickProblemIndices(count: number, problemCount: number): Array<number | null> {
  if (problemCount === 0) return Array.from({ length: count }, () => null);
  const result: Array<number | null> = [];
  while (result.length < count) {
    shuffle(Array.from({ length: problemCount }, (_, index) => index)).forEach((index) => {
      if (result.length < count) result.push(index);
    });
  }
  return result;
}

function createRoles(members: string[]): TurnParticipantRole {
  if (members.length === 0) return { solver: '미정', explainer: '미정' };
  if (members.length === 1) return { solver: members[0], explainer: `${members[0]}(설명 겸임)` };
  const [first, second] = shuffle([...members]);
  return { solver: first, explainer: second };
}

function createTurns(pairs: PairTeam[], questionCount: number, problemCount: number): PairTurn[] {
  return shuffle([...pairs]).map((pair, index) => ({
    pairId: pair.id,
    order: index,
    roles: createRoles(pair.members),
    questionIndices: pickProblemIndices(questionCount, problemCount),
    results: [],
    score: 0,
    startedAt: Date.now(),
  }));
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readSpeedQuizPayload(entry: HistoryEntry): SpeedQuizPayload | null {
  if (entry.tool !== 'cooperative-speed-quiz' || !entry.payload || typeof entry.payload !== 'object') return null;
  const payload = entry.payload as Partial<SpeedQuizPayload>;
  if (payload.format !== 'cooperative-speed-quiz/v1' || !Array.isArray(payload.turns)) return null;

  const turns = payload.turns.flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return [];
    const raw = turn as Record<string, unknown>;
    if (
      typeof raw.pairId !== 'string' ||
      typeof raw.order !== 'number' ||
      !raw.roles ||
      typeof raw.roles !== 'object' ||
      !Array.isArray(raw.questionIndices) ||
      !Array.isArray(raw.results)
    ) {
      return [];
    }

    const roles = raw.roles as Record<string, unknown>;
    const results = raw.results.flatMap((result) => {
      if (!result || typeof result !== 'object') return [];
      const rr = result as Record<string, unknown>;
      if (
        typeof rr.questionIndex !== 'number' ||
        (typeof rr.problemIndex !== 'number' && rr.problemIndex !== null) ||
        typeof rr.phrase !== 'string' ||
        typeof rr.answer !== 'string' ||
        (rr.outcome !== 'correct' && rr.outcome !== 'pass')
      ) {
        return [];
      }
      return [{
        questionIndex: rr.questionIndex,
        problemIndex: rr.problemIndex,
        questionNumber: typeof rr.questionNumber === 'number' ? rr.questionNumber : null,
        phrase: rr.phrase,
        answer: rr.answer,
        hint: typeof rr.hint === 'string' ? rr.hint : undefined,
        outcome: rr.outcome,
      } satisfies PairTurnResult];
    });

    return [{
      pairId: raw.pairId,
      order: raw.order,
      roles: {
        solver: typeof roles.solver === 'string' ? roles.solver : '미정',
        explainer: typeof roles.explainer === 'string' ? roles.explainer : '미정',
      },
      questionIndices: raw.questionIndices.map((value) => (typeof value === 'number' ? value : null)),
      results,
      score: typeof raw.score === 'number' ? raw.score : results.filter((result) => result.outcome === 'correct').length,
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : entry.createdAt,
      finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : undefined,
    } satisfies PairTurn];
  });

  return {
    format: 'cooperative-speed-quiz/v1',
    classId: typeof payload.classId === 'number' ? payload.classId : entry.classId,
    seatSignature: typeof payload.seatSignature === 'string' ? payload.seatSignature : '',
    pairs: Array.isArray(payload.pairs) ? payload.pairs.filter((pair) => !!pair) as PairTeam[] : [],
    selectedPackId: typeof payload.selectedPackId === 'string' ? payload.selectedPackId : DEFAULT_PACK_ID,
    rangeStart: typeof payload.rangeStart === 'number' ? payload.rangeStart : 1,
    rangeEnd: typeof payload.rangeEnd === 'number' ? payload.rangeEnd : null,
    questionCount: typeof payload.questionCount === 'number' ? payload.questionCount : 5,
    timeLimitSec: typeof payload.timeLimitSec === 'number' ? payload.timeLimitSec : 60,
    turns,
    status: payload.status === 'completed' ? 'completed' : 'in_progress',
    currentTurnIndex: typeof payload.currentTurnIndex === 'number' ? payload.currentTurnIndex : 0,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : entry.createdAt,
    finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
  };
}

export default function CooperativeSpeedQuizPage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [classId, setClassId] = useState<number | null>(null);
  const latestSeatHistory = useLiveQuery<HistoryEntry | undefined>(
    () => (classId ? db.history.where('classId').equals(classId).filter((entry) => entry.tool === 'seat').last() : Promise.resolve(undefined)),
    [classId],
  );
  const quizHistories = useLiveQuery<HistoryEntry[]>(
    () => (
      classId
        ? db.history.where('classId').equals(classId).toArray().then((items) =>
            items
              .filter((entry) => entry.tool === 'cooperative-speed-quiz')
              .sort((a, b) => b.createdAt - a.createdAt),
          )
        : Promise.resolve([] as HistoryEntry[])
    ),
    [classId],
  );

  const idiomProblems = useMemo(() => normalizeMeaningPromptPack(defaultProblemDeck), []);
  const proverbProblems = useMemo(() => normalizeMeaningPromptPack(proverbProblemDeck), []);
  const grade3Problems = useMemo(() => normalizeVocabularyPack(grade3ProblemDeck), []);
  const grade4Problems = useMemo(() => normalizeVocabularyPack(grade4ProblemDeck), []);
  const grade5Problems = useMemo(() => normalizeVocabularyPack(grade5ProblemDeck), []);
  const grade6Problems = useMemo(() => normalizeVocabularyPack(grade6ProblemDeck), []);

  const [selectedPackId, setSelectedPackId] = useState<string>(DEFAULT_PACK_ID);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState('1');
  const [rangeEndInput, setRangeEndInput] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [timeLimitSec, setTimeLimitSec] = useState(60);
  const [plannedTurns, setPlannedTurns] = useState<PairTurn[]>([]);
  const [session, setSession] = useState<SpeedQuizSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [questionRunning, setQuestionRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const autoPassLockRef = useRef(false);

  const activePackId = normalizePackId(selectedPackId);
  const problems = activePackId === 'proverb'
    ? proverbProblems
    : activePackId === 'grade3-vocab'
      ? grade3Problems
      : activePackId === 'grade4-vocab'
        ? grade4Problems
        : activePackId === 'grade5-vocab'
          ? grade5Problems
          : activePackId === 'grade6-vocab'
            ? grade6Problems
            : idiomProblems;

  const slicedProblems = useMemo(() => {
    if (problems.length === 0) return problems;
    const start = Math.max(0, Math.min(rangeStart - 1, problems.length - 1));
    const end = Math.max(start + 1, Math.min(rangeEnd ?? problems.length, problems.length));
    return problems.slice(start, end);
  }, [problems, rangeEnd, rangeStart]);

  useEffect(() => {
    setRangeStartInput(String(rangeStart));
  }, [rangeStart]);

  useEffect(() => {
    setRangeEndInput(rangeEnd == null ? '' : String(rangeEnd));
  }, [rangeEnd]);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1 && classes[0].id != null) {
      setClassId(classes[0].id);
    }
  }, [classId, classes]);

  const seatSnapshot = useMemo(() => snapshotFromHistory(latestSeatHistory), [latestSeatHistory]);
  const seatSignature = useMemo(() => seatSnapshotSignature(seatSnapshot), [seatSnapshot]);
  const pairs = useMemo(() => buildPairs(seatSnapshot), [seatSnapshot]);

  useEffect(() => {
    if (pairs.length === 0 || slicedProblems.length === 0) {
      setPlannedTurns([]);
      return;
    }
    setPlannedTurns(createTurns(pairs, questionCount, slicedProblems.length));
  }, [pairs, questionCount, slicedProblems]);

  const resumeCandidate = useMemo(() => {
    const latest = (quizHistories ?? []).find((entry) => {
      const payload = readSpeedQuizPayload(entry);
      return payload?.status === 'in_progress' && payload.seatSignature === seatSignature;
    });
    if (!latest) return null;
    const payload = readSpeedQuizPayload(latest);
    return payload ? ({ ...payload, historyId: latest.id ?? null } satisfies SpeedQuizSession) : null;
  }, [quizHistories, seatSignature]);

  const currentTurn = session ? session.turns[session.currentTurnIndex] ?? null : null;
  const sessionPairs = session?.pairs.length ? session.pairs : pairs;
  const pairMap = useMemo(() => new Map(sessionPairs.map((pair) => [pair.id, pair])), [sessionPairs]);
  const currentPair = currentTurn ? pairMap.get(currentTurn.pairId) ?? null : null;
  const currentQuestionIndex = currentTurn?.results.length ?? 0;
  const currentProblemIndex = currentTurn?.questionIndices[currentQuestionIndex] ?? null;
  const currentProblem = currentProblemIndex != null ? slicedProblems[currentProblemIndex] ?? null : null;
  const currentQuestionNumber = currentProblemIndex != null ? rangeStart + currentProblemIndex : null;

  useEffect(() => {
    autoPassLockRef.current = false;
    if (!session || session.status !== 'in_progress' || !currentTurn) {
      setQuestionRunning(false);
      setTimeLeft(null);
      return;
    }
    setQuestionRunning(false);
    setTimeLeft(session.timeLimitSec);
  }, [currentTurn?.pairId, session?.currentTurnIndex, session?.status, session?.timeLimitSec]);

  useEffect(() => {
    if (!session || session.status !== 'in_progress' || !questionRunning || timeLeft == null) return;
    if (timeLeft <= 0) {
      if (!autoPassLockRef.current) {
        autoPassLockRef.current = true;
        void applyOutcome('pass');
      }
      return;
    }
    const timer = window.setTimeout(() => {
      sfx.resume();
      sfx.tick();
      setTimeLeft((current) => (current == null ? current : current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [questionRunning, session, timeLeft]);

  const ranking = useMemo(() => {
    const turnMap = new Map(session?.turns.map((turn) => [turn.pairId, turn]) ?? []);
    return sessionPairs
      .map((pair) => {
        const turn = turnMap.get(pair.id) ?? null;
        return {
          pair,
          score: turn?.score ?? 0,
          attempts: turn?.results.length ?? 0,
          passed: turn?.results.filter((result) => result.outcome === 'pass').length ?? 0,
        };
      })
      .sort((a, b) => b.score - a.score || a.pair.label.localeCompare(b.pair.label, 'ko'));
  }, [session, sessionPairs]);

  async function persistSession(nextSession: SpeedQuizSession) {
    const payload: SpeedQuizPayload = {
      format: 'cooperative-speed-quiz/v1',
      classId: nextSession.classId,
      seatSignature: nextSession.seatSignature,
      pairs: nextSession.pairs,
      selectedPackId: nextSession.selectedPackId,
      rangeStart: nextSession.rangeStart,
      rangeEnd: nextSession.rangeEnd,
      questionCount: nextSession.questionCount,
      timeLimitSec: nextSession.timeLimitSec,
      turns: nextSession.turns,
      status: nextSession.status,
      currentTurnIndex: nextSession.currentTurnIndex,
      createdAt: nextSession.createdAt,
      finishedAt: nextSession.finishedAt,
    };

    const title = `협동 스피드 퀴즈 ${nextSession.turns.length}팀`;
    if (nextSession.historyId == null) {
      const historyId = await db.history.add({
        classId: nextSession.classId,
        tool: 'cooperative-speed-quiz',
        title,
        payload,
        createdAt: nextSession.createdAt,
      });
      setSession({ ...nextSession, historyId });
      return;
    }

    await db.history.update(nextSession.historyId, { title, payload });
    setSession(nextSession);
  }

  async function startSession() {
    if (!classId) {
      alert('학급을 먼저 선택해 주세요.');
      return;
    }
    if (pairs.length === 0) {
      alert('최근 자리배치 기록이 없어 짝을 만들 수 없습니다.');
      return;
    }
    if (slicedProblems.length === 0) {
      alert('사용 가능한 문제가 없습니다.');
      return;
    }

    const nextSession: SpeedQuizSession = {
      historyId: null,
      format: 'cooperative-speed-quiz/v1',
      classId,
      seatSignature,
      pairs,
      selectedPackId: activePackId,
      rangeStart,
      rangeEnd,
      questionCount,
      timeLimitSec,
      turns: plannedTurns.length > 0 ? plannedTurns : createTurns(pairs, questionCount, slicedProblems.length),
      status: 'in_progress',
      currentTurnIndex: 0,
      createdAt: Date.now(),
    };

    setQuestionRunning(false);
    setModalOpen(true);
    await persistSession(nextSession);
  }

  function regeneratePlannedTurns() {
    if (pairs.length === 0 || slicedProblems.length === 0) return;
    setPlannedTurns(createTurns(pairs, questionCount, slicedProblems.length));
  }

  function commitRangeStart(raw: string) {
    if (!raw.trim()) {
      setRangeStartInput('');
      return;
    }
    const value = Math.max(1, Math.min(parseInt(raw, 10) || 1, problems.length || 1));
    setRangeStart(value);
  }

  function commitRangeEnd(raw: string) {
    if (!raw.trim()) {
      setRangeEnd(null);
      return;
    }
    const value = Math.max(1, Math.min(parseInt(raw, 10) || 1, problems.length || 1));
    setRangeEnd(value >= problems.length ? null : value);
  }

  function swapCurrentRoles() {
    if (!session || !currentTurn) return;
    const turns = session.turns.map((turn, index) =>
      index === session.currentTurnIndex
        ? {
            ...turn,
            roles: {
              solver: turn.roles.explainer,
              explainer: turn.roles.solver,
            },
          }
        : turn,
    );
    void persistSession({ ...session, turns });
  }

  function startQuestionTimer() {
    if (!session || session.status !== 'in_progress') return;
    sfx.resume();
    sfx.tick();
    setQuestionRunning(true);
  }

  async function applyOutcome(outcome: 'correct' | 'pass') {
    if (!session || !currentTurn) return;

    const timeExpired = outcome === 'pass' && timeLeft != null && timeLeft <= 0;
    const result: PairTurnResult = {
      questionIndex: currentQuestionIndex,
      problemIndex: currentProblemIndex,
      questionNumber: currentQuestionNumber,
      phrase: currentProblem?.phrase ?? '문제 없음',
      answer: currentProblem?.meaning ?? '정답 정보 없음',
      hint: currentProblem?.hint,
      outcome,
    };

    const turns = session.turns.map((turn, index) => {
      if (index !== session.currentTurnIndex) return turn;
      const results = [...turn.results, result];
      const finished = results.length >= session.questionCount || timeExpired;
      return {
        ...turn,
        results,
        score: turn.score + (outcome === 'correct' ? 1 : 0),
        finishedAt: finished ? Date.now() : undefined,
      };
    });

    const turnFinished = currentQuestionIndex + 1 >= session.questionCount || timeExpired;
    const isLastTurn = session.currentTurnIndex + 1 >= session.turns.length;
    const nextSession: SpeedQuizSession = {
      ...session,
      turns,
      currentTurnIndex: turnFinished && !isLastTurn ? session.currentTurnIndex + 1 : session.currentTurnIndex,
      status: turnFinished && isLastTurn ? 'completed' : 'in_progress',
      finishedAt: turnFinished && isLastTurn ? Date.now() : session.finishedAt,
    };

    if (turnFinished) {
      setQuestionRunning(false);
    }

    await persistSession(nextSession);
  }

  function resumeSession(candidate: SpeedQuizSession) {
    setSession(candidate);
    setSelectedPackId(normalizePackId(candidate.selectedPackId));
    setRangeStart(candidate.rangeStart);
    setRangeEnd(candidate.rangeEnd);
    setQuestionCount(candidate.questionCount);
    setTimeLimitSec(candidate.timeLimitSec);
    setQuestionRunning(false);
    setModalOpen(true);
  }

  async function deleteHistory(entry: HistoryEntry) {
    if (entry.id == null) return;
    if (!confirm('이 기록을 삭제할까요?')) return;
    await db.history.delete(entry.id);
    if (session?.historyId === entry.id) {
      setSession(null);
      setQuestionRunning(false);
      setModalOpen(false);
    }
  }

  const statusBadge = session?.status === 'completed'
    ? 'bg-emerald-100 text-emerald-700'
    : session?.status === 'in_progress'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-slate-100 text-slate-500';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">돌아가기</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px] flex-1">
            <h1 className="text-2xl font-bold text-slate-900">협동 스피드 퀴즈</h1>
            <p className="mt-1 text-sm text-slate-500">모달에서 퀴즈 시작을 눌러야 타이머가 시작됩니다.</p>
          </div>
          <div className="w-full max-w-xl lg:w-auto">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="w-16 shrink-0 text-xs font-bold text-slate-500">문제집</span>
                <select
                  value={selectedPackId}
                  onChange={(e) => {
                    setSelectedPackId(e.target.value);
                    setRangeStart(1);
                    setRangeEnd(null);
                    setRangeStartInput('1');
                    setRangeEndInput('');
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  {PACK_OPTIONS.map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="w-16 shrink-0 text-xs font-bold text-slate-500">문제 범위</span>
                <input
                  type="number"
                  min={1}
                  max={problems.length || 1}
                  value={rangeStartInput}
                  onChange={(e) => setRangeStartInput(e.target.value)}
                  onBlur={(e) => commitRangeStart(e.target.value)}
                  className="w-14 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-center text-sm focus:border-slate-400 focus:outline-none"
                />
                <span className="text-sm text-slate-400">~</span>
                <input
                  type="number"
                  min={1}
                  max={problems.length || 1}
                  value={rangeEndInput}
                  onChange={(e) => setRangeEndInput(e.target.value)}
                  onBlur={(e) => commitRangeEnd(e.target.value)}
                  placeholder={String(problems.length || '')}
                  className="w-14 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-center text-sm focus:border-slate-400 focus:outline-none"
                />
                <span className="text-xs text-slate-400">/ {problems.length}문항</span>
                <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                  {slicedProblems.length}문항 선택
                </span>
                {(rangeStart !== 1 || rangeEnd !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRangeStart(1);
                      setRangeEnd(null);
                      setRangeStartInput('1');
                      setRangeEndInput('');
                    }}
                    className="shrink-0 text-xs text-slate-400 hover:text-slate-700"
                  >
                    전체
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 self-end rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              문제팩과 범위를 먼저 골라 두면 협동 스피드퀴즈가 그 설정 그대로 진행됩니다.
            </div>
          </div>
        </div>
      </div>

      {resumeCandidate && (!session || session.historyId !== resumeCandidate.historyId) && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>진행 중인 협동 스피드 퀴즈가 있습니다.</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => resumeSession(resumeCandidate)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
              >
                이어서 진행
              </button>
              <button
                type="button"
                onClick={() =>
                  deleteHistory({
                    id: resumeCandidate.historyId ?? undefined,
                    classId: resumeCandidate.classId,
                    tool: 'cooperative-speed-quiz',
                    title: `협동 스피드 퀴즈 ${resumeCandidate.turns.length}팀`,
                    payload: resumeCandidate,
                    createdAt: resumeCandidate.createdAt,
                  })
                }
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-4 lg:grid-cols-[1.2fr,0.85fr,0.85fr,0.9fr,auto]">
          <div>
            <label className="mb-2 block text-sm text-slate-600">학급 선택</label>
            <select
              value={classId ?? ''}
              onChange={(e) => setClassId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none"
            >
              <option value="">선택하세요</option>
              {classes?.map((cls) => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-slate-500">최근 자리배치 기준 · {pairs.length}팀 구성</div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-600">팀당 문제 수</label>
            <input
              type="number"
              min={1}
              max={20}
              value={questionCount}
              onChange={(e) => setQuestionCount(Math.max(1, Math.min(parseInt(e.target.value, 10) || 1, 20)))}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-600">제한시간</label>
            <select
              value={timeLimitSec}
              onChange={(e) => setTimeLimitSec(Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none"
            >
              <option value={30}>30초</option>
              <option value={45}>45초</option>
              <option value={60}>60초</option>
              <option value={90}>90초</option>
            </select>
          </div>
          <div className="flex items-end">
            <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">진행 방식</div>
              <div className="mt-1">정답과 패스만 눌러 빠르게 진행합니다.</div>
            </div>
          </div>
          <button
            onClick={startSession}
            disabled={!classId || pairs.length === 0 || slicedProblems.length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:bg-slate-300"
          >
            활동 시작
          </button>
        </div>
      </section>

      {!session && plannedTurns.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800">활동 순서 미리보기</h3>
              <div className="mt-1 text-xs text-slate-500">활동 시작 후 아래 순서대로 팀이 진행됩니다.</div>
            </div>
            <button
              type="button"
              onClick={regeneratePlannedTurns}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              순서 다시 섞기
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {plannedTurns.map((turn) => {
              const pair = pairs.find((entry) => entry.id === turn.pairId);
              return (
                <div key={turn.pairId} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-xs font-bold tracking-[0.2em] text-slate-400">{turn.order + 1}번째</div>
                  <div className="mt-2 text-sm font-semibold text-slate-800">{pair?.label ?? turn.pairId}</div>
                  <div className="mt-1 text-xs text-slate-500">{pair?.members.join(' · ')}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <section className="space-y-4">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs tracking-[0.25em] text-slate-400">COOPERATIVE SPEED QUIZ</div>
                <h2 className="mt-2 text-2xl font-black text-slate-900">{currentPair ? `${currentPair.label} 진행 중` : '퀴즈 대기'}</h2>
                <div className="mt-1 text-sm text-slate-500">
                  {session ? `${session.currentTurnIndex + 1} / ${session.turns.length}번째 팀 차례` : '활동 시작 후 모달에서 퀴즈를 시작합니다.'}
                </div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge}`}>
                {session?.status === 'completed' ? '종료' : session?.status === 'in_progress' ? '진행 중' : '대기'}
              </span>
            </div>

            {!session ? (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                문제는 모달 안에서 퀴즈 시작을 누른 뒤에만 보입니다.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{currentPair?.label ?? '진행 중인 팀 없음'}</div>
                      <div className="mt-1 text-xs text-slate-500">{currentPair?.members.join(' · ')}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900">{currentTurn?.score ?? 0}점</div>
                      <div className="text-[11px] text-slate-500">{currentTurn?.results.length ?? 0}/{session.questionCount}문제</div>
                    </div>
                  </div>
                  {timeLeft != null && (
                    <div className="mt-4 inline-flex items-center gap-3 rounded-full bg-white px-4 py-2 shadow-sm">
                      <span className="text-xs font-semibold text-slate-500">남은 시간</span>
                      <span className={`text-lg font-black ${timeLeft <= 5 ? 'text-rose-600' : 'text-slate-900'}`}>{timeLeft}초</span>
                    </div>
                  )}
                </div>

                {currentTurn && currentPair && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-blue-200 bg-blue-50 px-4 py-5 text-center">
                        <div className="text-xs font-semibold tracking-[0.2em] text-blue-500">맞히는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900">{currentTurn.roles.solver}</div>
                      </div>
                      <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-5 text-center">
                        <div className="text-xs font-semibold tracking-[0.2em] text-amber-600">설명하는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900">{currentTurn.roles.explainer}</div>
                      </div>
                    </div>

                    <div className="rounded-[2rem] bg-slate-950 px-5 py-8 text-center text-white">
                      <div className="text-sm tracking-[0.35em] text-slate-300">{currentPair.label} · {currentQuestionIndex + 1}/{session.questionCount}문제</div>
                      <div className="mt-4 text-4xl font-black text-amber-200 md:text-6xl break-keep">
                        {questionRunning ? (currentProblem?.phrase ?? '문제 없음') : '모달에서 퀴즈 시작을 눌러 주세요'}
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={swapCurrentRoles}
                        className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        역할 바꾸기
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        크게 보기
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => applyOutcome('correct')}
                        disabled={!questionRunning}
                        className="rounded-[1.5rem] bg-emerald-500 px-6 py-4 text-xl font-black text-white hover:bg-emerald-400 disabled:bg-slate-300 md:text-2xl"
                      >
                        정답
                      </button>
                      <button
                        type="button"
                        onClick={() => applyOutcome('pass')}
                        disabled={!questionRunning}
                        className="rounded-[1.5rem] bg-amber-400 px-6 py-4 text-xl font-black text-slate-950 hover:bg-amber-300 disabled:bg-slate-300 md:text-2xl"
                      >
                        패스
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-800">팀 순위</h3>
              <span className="text-xs text-slate-500">정답 수 기준</span>
            </div>
            {ranking.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                게임을 시작하면 순위가 표시됩니다.
              </div>
            ) : (
              <div className="space-y-2">
                {ranking.map(({ pair, score, attempts, passed }, index) => (
                  <div key={pair.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-800">{index + 1}. {pair.label}</div>
                        <div className="text-xs text-slate-500">{pair.members.join(' · ')}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-slate-900">{score}</div>
                        <div className="text-[11px] text-slate-500">{attempts}문제 · 패스 {passed}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {quizHistories && quizHistories.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="font-semibold text-slate-800">활동 기록</h3>
                <span className="text-xs text-slate-500">({quizHistories.length}건)</span>
              </div>
              <div className="space-y-2">
                {quizHistories.map((entry) => {
                  const payload = readSpeedQuizPayload(entry);
                  const bestScore = payload?.turns.reduce((max, turn) => Math.max(max, turn.score), 0) ?? 0;
                  return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 tabular-nums">{formatDateTime(entry.createdAt)}</div>
                          <div className="mt-1 font-semibold text-slate-800">{entry.title}</div>
                          <div className="mt-1 text-sm text-slate-600">최고 점수 {bestScore}점</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteHistory(entry)}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      {modalOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-label="퀴즈 모달 닫기"
          />
          <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-modalRise md:max-h-[84vh]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.14),_transparent_30%)]" />
            <div className="relative flex min-h-0 flex-1 flex-col p-5 md:p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs tracking-[0.35em] text-slate-400">COOPERATIVE SPEED QUIZ</div>
                  <div className="mt-2 text-xl font-black text-slate-900 md:text-2xl">
                    {session.status === 'completed' ? '협동 스피드 퀴즈 종료' : currentPair ? `${currentPair.label} 진행` : '협동 스피드 퀴즈'}
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {session.status === 'completed' ? '모든 팀 활동이 끝났습니다.' : `${session.currentTurnIndex + 1} / ${session.turns.length}번째 팀`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {session.status === 'completed' ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
                  <div className="text-sm tracking-[0.35em] text-emerald-700">WINNING TEAM</div>
                  <div className="text-4xl font-black text-slate-900">{ranking[0]?.pair.label ?? '기록 없음'}</div>
                  <div className="text-xl text-slate-700">{ranking[0]?.pair.members.join(' · ')}</div>
                  <div className="rounded-full bg-emerald-100 px-4 py-2 text-lg font-bold text-emerald-700">
                    {ranking[0]?.score ?? 0}문제 정답
                  </div>
                </div>
              ) : currentPair && currentTurn ? (
                !questionRunning ? (
                  <div className="flex min-h-full flex-col items-center justify-center gap-5 py-2 text-center">
                    <div className="space-y-2">
                      <div className="text-sm tracking-[0.35em] text-slate-400">READY TO START</div>
                      <div className="text-3xl font-black text-slate-900 md:text-4xl">{currentPair.label}</div>
                      <div className="text-lg text-slate-600 md:text-xl">{currentPair.members.join(' · ')}</div>
                    </div>
                    <div className="grid w-full max-w-3xl gap-3 md:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-blue-200 bg-blue-50 px-4 py-4 text-center">
                        <div className="text-xs font-semibold tracking-[0.24em] text-blue-500">맞히는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900 md:text-4xl break-keep">{currentTurn.roles.solver}</div>
                      </div>
                      <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4 text-center">
                        <div className="text-xs font-semibold tracking-[0.24em] text-amber-600">설명하는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900 md:text-4xl break-keep">{currentTurn.roles.explainer}</div>
                      </div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
                      퀴즈 시작을 누르면 {session.timeLimitSec}초 동안 타이머가 계속 진행됩니다.
                    </div>
                    <div className="flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={swapCurrentRoles}
                        className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        역할 바꾸기
                      </button>
                      <button
                        type="button"
                        onClick={startQuestionTimer}
                        className="rounded-full bg-amber-300 px-7 py-3 text-base font-black text-slate-950 hover:bg-amber-200"
                      >
                        퀴즈 시작
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-blue-200 bg-blue-50 px-4 py-4 text-center">
                        <div className="text-xs font-semibold tracking-[0.24em] text-blue-500">맞히는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900 md:text-4xl break-keep">{currentTurn.roles.solver}</div>
                      </div>
                      <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4 text-center">
                        <div className="text-xs font-semibold tracking-[0.24em] text-amber-600">설명하는 사람</div>
                        <div className="mt-3 text-3xl font-black text-slate-900 md:text-4xl break-keep">{currentTurn.roles.explainer}</div>
                      </div>
                    </div>

                    <div className="rounded-[1.75rem] bg-slate-950 px-4 py-5 text-center text-white md:px-6 md:py-6">
                      <div className="text-sm tracking-[0.35em] text-slate-300">{currentPair.label} · {currentQuestionIndex + 1}/{session.questionCount}문제</div>
                      <div className="mt-3 inline-flex items-center gap-3 rounded-full bg-white/10 px-4 py-2">
                        <span className="text-sm font-semibold text-slate-300">제한 시간</span>
                        <span className={`text-2xl font-black ${timeLeft != null && timeLeft <= 5 ? 'text-rose-300' : 'text-amber-200'}`}>
                          {timeLeft ?? session.timeLimitSec}초
                        </span>
                      </div>
                      {currentQuestionNumber != null && (
                        <div className="mt-4 text-base font-semibold text-slate-300">선택 범위 기준 {currentQuestionNumber}번 문항</div>
                      )}
                      <div className="mt-4 text-3xl font-black text-amber-200 md:text-5xl break-keep">
                        {currentProblem?.phrase ?? '문제 없음'}
                      </div>
                      {currentProblem?.hint && (
                        <div className="mt-5 text-base text-slate-300 md:text-lg">힌트: {currentProblem.hint}</div>
                      )}
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={swapCurrentRoles}
                          className="rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/20"
                        >
                          역할 바꾸기
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => applyOutcome('correct')}
                        disabled={!questionRunning}
                        className="rounded-[1.35rem] bg-emerald-500 px-5 py-[4.5rem] text-lg font-black text-white hover:bg-emerald-400 disabled:bg-slate-300 md:text-xl"
                      >
                        정답
                      </button>
                      <button
                        type="button"
                        onClick={() => applyOutcome('pass')}
                        disabled={!questionRunning}
                        className="rounded-[1.35rem] bg-amber-400 px-5 py-[4.5rem] text-lg font-black text-slate-950 hover:bg-amber-300 disabled:bg-slate-300 md:text-xl"
                      >
                        패스
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex min-h-[420px] items-center justify-center text-lg text-slate-500">팀 정보를 준비하고 있습니다.</div>
              )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
