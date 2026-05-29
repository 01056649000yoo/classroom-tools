import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import defaultProblemDeck from '../data/idioms.json';
import proverbProblemDeck from '../data/proverbs.json';
import grade3ProblemDeck from '../data/grade3_vocab.json';
import grade4ProblemDeck from '../data/grade4_vocab.json';
import grade5ProblemDeck from '../data/grade5_vocab.json';
import grade6ProblemDeck from '../data/grade6_vocab.json';
import { db, type HistoryEntry, type Student } from '../db';
import { type SeatResultSeat } from '../lib/backup';
import { shuffle } from '../lib/shuffle';
import { sfx } from '../lib/sfx';

type ProblemCard = {
  phrase: string;
  meaning: string;
  hint?: string;
};

type MissionPackId =
  | 'idiom'
  | 'proverb'
  | 'grade3-vocab'
  | 'grade4-vocab'
  | 'grade5-vocab'
  | 'grade6-vocab';

type ParticipantMode = 'free' | 'number' | 'seat';

type MissionQuestionResult = {
  responder: string | null;
  problemIndex: number | null;
  questionNumber: number | null;
  phrase: string;
  answer: string;
  hint?: string;
  outcome: 'correct' | 'wrong' | 'skip';
  answeredAt: number;
};

type MissionPayload = {
  format: 'class-mission/v1';
  classId: number;
  selectedPackId: MissionPackId;
  timeLimitSec: number;
  targetScore: number;
  participantMode: ParticipantMode;
  participantQueue: string[];
  seatSignature: string;
  score: number;
  wrongCount: number;
  skipCount: number;
  totalAttempts: number;
  status: 'ready' | 'running' | 'completed';
  results: MissionQuestionResult[];
  currentProblemIndex: number | null;
  currentResponderIndex: number;
  createdAt: number;
  finishedAt?: number;
};

const DEFAULT_PACK_ID: MissionPackId = 'idiom';
const PACK_OPTIONS: Array<{ id: MissionPackId; label: string }> = [
  { id: 'idiom', label: '사자성어 기본팩(문장완성)' },
  { id: 'proverb', label: '속담 기본팩' },
  { id: 'grade3-vocab', label: '3학년 필수 어휘' },
  { id: 'grade4-vocab', label: '4학년 필수 어휘' },
  { id: 'grade5-vocab', label: '5학년 필수 어휘' },
  { id: 'grade6-vocab', label: '6학년 필수 어휘' },
];

const TIME_OPTIONS = [120, 180, 300];
const TARGET_OPTIONS = [10, 15, 20, 25];

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

function normalizePackId(value: string): MissionPackId {
  return PACK_OPTIONS.some((pack) => pack.id === value) ? (value as MissionPackId) : DEFAULT_PACK_ID;
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

function buildParticipantQueue(mode: ParticipantMode, students: Student[], seatSnapshot: SeatResultSeat[]) {
  if (mode === 'seat') {
    return seatSnapshot
      .filter((seat) => seat.name)
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((seat) => seat.name);
  }

  if (mode === 'number') {
    return [...students]
      .sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt)
      .map((student) => student.name);
  }

  return [];
}

function pickNextProblemIndex(problemCount: number, usedProblemIndices: number[]) {
  if (problemCount === 0) return null;
  const available = Array.from({ length: problemCount }, (_, index) => index).filter((index) => !usedProblemIndices.includes(index));
  const pool = available.length > 0 ? available : Array.from({ length: problemCount }, (_, index) => index);
  return shuffle(pool)[0] ?? null;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderPhraseWithProtectedInitials(phrase: string) {
  return phrase.split(/(\[[^\]]+\])/g).filter(Boolean).map((part, index) => {
    const isInitialBlock = /^\[[^\]]+\]$/.test(part);
    return isInitialBlock ? (
      <span key={`${part}-${index}`} className="inline-block whitespace-nowrap align-baseline">
        {part}
      </span>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    );
  });
}

function readMissionPayload(entry: HistoryEntry): MissionPayload | null {
  if (entry.tool !== 'class-mission' || !entry.payload || typeof entry.payload !== 'object') return null;
  const payload = entry.payload as Partial<MissionPayload>;
  if (payload.format !== 'class-mission/v1' || !Array.isArray(payload.results)) return null;

  return {
    format: 'class-mission/v1',
    classId: typeof payload.classId === 'number' ? payload.classId : entry.classId,
    selectedPackId: normalizePackId(typeof payload.selectedPackId === 'string' ? payload.selectedPackId : DEFAULT_PACK_ID),
    timeLimitSec: typeof payload.timeLimitSec === 'number' ? payload.timeLimitSec : 180,
    targetScore: typeof payload.targetScore === 'number' ? payload.targetScore : 15,
    participantMode: payload.participantMode === 'number' || payload.participantMode === 'seat' ? payload.participantMode : 'free',
    participantQueue: Array.isArray(payload.participantQueue) ? payload.participantQueue.filter((value): value is string => typeof value === 'string') : [],
    seatSignature: typeof payload.seatSignature === 'string' ? payload.seatSignature : '',
    score: typeof payload.score === 'number' ? payload.score : 0,
    wrongCount: typeof payload.wrongCount === 'number' ? payload.wrongCount : 0,
    skipCount: typeof payload.skipCount === 'number' ? payload.skipCount : 0,
    totalAttempts: typeof payload.totalAttempts === 'number' ? payload.totalAttempts : payload.results.length,
    status: payload.status === 'completed' ? 'completed' : payload.status === 'ready' ? 'ready' : 'running',
    results: payload.results.flatMap((result) => {
      if (!result || typeof result !== 'object') return [];
      const raw = result as Record<string, unknown>;
      if (
        (raw.responder !== null && typeof raw.responder !== 'string') ||
        (typeof raw.problemIndex !== 'number' && raw.problemIndex !== null) ||
        (typeof raw.questionNumber !== 'number' && raw.questionNumber !== null) ||
        typeof raw.phrase !== 'string' ||
        typeof raw.answer !== 'string' ||
        (raw.outcome !== 'correct' && raw.outcome !== 'wrong' && raw.outcome !== 'skip') ||
        typeof raw.answeredAt !== 'number'
      ) {
        return [];
      }
      return [{
        responder: raw.responder,
        problemIndex: raw.problemIndex,
        questionNumber: raw.questionNumber,
        phrase: raw.phrase,
        answer: raw.answer,
        hint: typeof raw.hint === 'string' ? raw.hint : undefined,
        outcome: raw.outcome,
        answeredAt: raw.answeredAt,
      } satisfies MissionQuestionResult];
    }),
    currentProblemIndex: typeof payload.currentProblemIndex === 'number' ? payload.currentProblemIndex : null,
    currentResponderIndex: typeof payload.currentResponderIndex === 'number' ? payload.currentResponderIndex : 0,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : entry.createdAt,
    finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
  };
}

export default function ClassMissionPage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [classId, setClassId] = useState<number | null>(null);
  const students = useLiveQuery<Student[]>(
    () => (classId ? db.students.where('classId').equals(classId).sortBy('number') : Promise.resolve([] as Student[])),
    [classId],
  );
  const latestSeatHistory = useLiveQuery<HistoryEntry | undefined>(
    () => (classId ? db.history.where('classId').equals(classId).filter((entry) => entry.tool === 'seat').last() : Promise.resolve(undefined)),
    [classId],
  );
  const histories = useLiveQuery<HistoryEntry[]>(
    () => (
      classId
        ? db.history.where('classId').equals(classId).toArray().then((items) =>
            items
              .filter((entry) => entry.tool === 'class-mission')
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

  const [selectedPackId, setSelectedPackId] = useState<MissionPackId>(DEFAULT_PACK_ID);
  const [timeLimitSec, setTimeLimitSec] = useState(180);
  const [targetScore, setTargetScore] = useState(15);
  const [participantMode, setParticipantMode] = useState<ParticipantMode>('free');
  const [session, setSession] = useState<MissionPayload | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const autoEndLockRef = useRef(false);
  const warningSecondRef = useRef<number | null>(null);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1 && classes[0].id != null) {
      setClassId(classes[0].id);
    }
  }, [classId, classes]);

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

  const seatSnapshot = useMemo(() => snapshotFromHistory(latestSeatHistory), [latestSeatHistory]);
  const seatSignature = useMemo(() => seatSnapshotSignature(seatSnapshot), [seatSnapshot]);
  const participantQueue = useMemo(
    () => buildParticipantQueue(participantMode, students ?? [], seatSnapshot),
    [participantMode, seatSnapshot, students],
  );

  const activeProblem = session?.currentProblemIndex != null ? problems[session.currentProblemIndex] ?? null : null;
  const currentResponder = session && session.participantQueue.length > 0
    ? session.participantQueue[session.currentResponderIndex % session.participantQueue.length] ?? null
    : null;
  const missionSucceeded = session ? session.score >= session.targetScore : false;
  const timeProgress = session && timeLeft != null ? Math.max(0, Math.min(100, (timeLeft / session.timeLimitSec) * 100)) : 0;
  const timerUrgent = timeLeft != null && timeLeft <= 10;
  const timerCritical = timeLeft != null && timeLeft <= 5;
  const bestScore = useMemo(
    () => Math.max(0, ...(histories ?? []).map((entry) => readMissionPayload(entry)?.score ?? 0)),
    [histories],
  );

  useEffect(() => {
    autoEndLockRef.current = false;
    warningSecondRef.current = null;
    if (!session || session.status === 'completed') {
      setTimeLeft(null);
      return;
    }
    setTimeLeft(session.timeLimitSec);
  }, [session?.createdAt, session?.status, session?.timeLimitSec]);

  useEffect(() => {
    if (!session || session.status !== 'running' || timeLeft == null) return;
    if (timeLeft <= 0) {
      if (!autoEndLockRef.current) {
        autoEndLockRef.current = true;
        void finishSession();
      }
      return;
    }
    const timer = window.setTimeout(() => {
      sfx.resume();
      sfx.tick();
      setTimeLeft((current) => (current == null ? current : current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [session, timeLeft]);

  useEffect(() => {
    if (!session || session.status !== 'running' || timeLeft == null) return;
    if (warningSecondRef.current === timeLeft) return;
    if (timeLeft <= 10 && timeLeft > 0) {
      warningSecondRef.current = timeLeft;
      sfx.resume();
      if (timeLeft <= 5) {
        sfx.pop();
      } else {
        sfx.whoosh(220);
      }
    }
  }, [session, timeLeft]);

  function beginMission() {
    if (!session || session.status !== 'ready') return;
    setSession({ ...session, status: 'running' });
    sfx.resume();
    sfx.whoosh(420);
  }

  async function persistCompletedSession(nextSession: MissionPayload) {
    await db.history.add({
      classId: nextSession.classId,
      tool: 'class-mission',
      title: `학급 공동 미션 ${nextSession.score}점`,
      payload: nextSession,
      createdAt: nextSession.createdAt,
    });
  }

  function startSession() {
    if (!classId) {
      alert('학급을 먼저 선택해 주세요.');
      return;
    }
    if (!students || students.length === 0) {
      alert('학생 명단이 없습니다. 학급에 학생을 먼저 등록해 주세요.');
      return;
    }
    if (problems.length === 0) {
      alert('사용 가능한 문제가 없습니다.');
      return;
    }
    if (participantMode === 'seat' && seatSnapshot.length === 0) {
      alert('자리순 모드는 최근 자리배치 기록이 있어야 시작할 수 있습니다.');
      return;
    }

    const firstProblemIndex = pickNextProblemIndex(problems.length, []);
    const nextSession: MissionPayload = {
      format: 'class-mission/v1',
      classId,
      selectedPackId: activePackId,
      timeLimitSec,
      targetScore,
      participantMode,
      participantQueue,
      seatSignature,
      score: 0,
      wrongCount: 0,
      skipCount: 0,
      totalAttempts: 0,
      status: 'ready',
      results: [],
      currentProblemIndex: firstProblemIndex,
      currentResponderIndex: 0,
      createdAt: Date.now(),
    };
    setAnswerOpen(false);
    setSession(nextSession);
    setModalOpen(true);
  }

  async function finishSession() {
    if (!session || session.status === 'completed') return;
    const nextSession: MissionPayload = {
      ...session,
      status: 'completed',
      finishedAt: Date.now(),
    };
    setSession(nextSession);
    setAnswerOpen(true);
    sfx.fanfare();
    await persistCompletedSession(nextSession);
  }

  function nextResponderIndex(currentSession: MissionPayload) {
    if (currentSession.participantQueue.length === 0) return 0;
    return (currentSession.currentResponderIndex + 1) % currentSession.participantQueue.length;
  }

  function chooseNextProblemIndex(currentSession: MissionPayload, currentProblemIndex: number | null) {
    const used = currentProblemIndex == null
      ? currentSession.results.flatMap((result) => (result.problemIndex == null ? [] : [result.problemIndex]))
      : [
          ...currentSession.results.flatMap((result) => (result.problemIndex == null ? [] : [result.problemIndex])),
          currentProblemIndex,
        ];
    return pickNextProblemIndex(problems.length, used);
  }

  function applyOutcome(outcome: 'correct' | 'wrong' | 'skip') {
    if (!session || session.status !== 'running') return;

    const currentProblemIndex = session.currentProblemIndex;
    if (currentProblemIndex == null) return;
    const current = currentProblemIndex != null ? problems[currentProblemIndex] ?? null : null;
    if (!current) return;
    const resolvedProblemIndex = currentProblemIndex;

    const result: MissionQuestionResult = {
      responder: currentResponder,
      problemIndex: resolvedProblemIndex,
      questionNumber: resolvedProblemIndex + 1,
      phrase: current.phrase,
      answer: current.meaning,
      hint: current.hint,
      outcome,
      answeredAt: Date.now(),
    };

    if (outcome === 'correct') sfx.ding();

    const nextSession: MissionPayload = {
      ...session,
      score: session.score + (outcome === 'correct' ? 1 : 0),
      wrongCount: session.wrongCount + (outcome === 'wrong' ? 1 : 0),
      skipCount: session.skipCount + (outcome === 'skip' ? 1 : 0),
      totalAttempts: session.totalAttempts + 1,
      results: [...session.results, result],
      currentResponderIndex: nextResponderIndex(session),
      currentProblemIndex: chooseNextProblemIndex(session, resolvedProblemIndex),
    };

    setAnswerOpen(false);
    setSession(nextSession);
  }

  async function deleteHistory(entry: HistoryEntry) {
    if (!entry.id) return;
    if (!confirm('이 기록을 삭제할까요?')) return;
    await db.history.delete(entry.id);
  }

  const statusTone = session?.status === 'completed'
    ? missionSucceeded
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-slate-200 text-slate-700'
    : session?.status === 'running'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-blue-100 text-blue-700';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black tracking-[0.28em] text-amber-600">CLASS MISSION</div>
          <h1 className="mt-2 text-2xl font-black text-slate-900">학급 공동 미션</h1>
          <p className="mt-2 text-sm text-slate-500">
            반 전체가 하나의 팀이 되어 제한 시간 안에 목표 정답 수를 넘겨 보세요.
          </p>
        </div>
        <Link to="/" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          홈으로
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <section className="space-y-4">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs tracking-[0.28em] text-slate-400">SETUP</div>
                <h2 className="mt-2 text-xl font-black text-slate-900">미션 설정</h2>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>
                {session?.status === 'completed' ? (missionSucceeded ? '목표 달성' : '미션 종료') : session ? '진행 중' : '준비'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">학급</span>
                <select
                  value={classId ?? ''}
                  onChange={(e) => setClassId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-500"
                >
                  <option value="">학급을 선택해 주세요</option>
                  {(classes ?? []).map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">문제 팩</span>
                <select
                  value={selectedPackId}
                  onChange={(e) => setSelectedPackId(normalizePackId(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-500"
                >
                  {PACK_OPTIONS.map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">제한 시간</span>
                <select
                  value={timeLimitSec}
                  onChange={(e) => setTimeLimitSec(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-500"
                >
                  {TIME_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds / 60}분</option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">목표 정답 수</span>
                <select
                  value={targetScore}
                  onChange={(e) => setTargetScore(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-500"
                >
                  {TARGET_OPTIONS.map((score) => (
                    <option key={score} value={score}>{score}문제</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5">
              <div className="text-sm font-semibold text-slate-700">참여 순서</div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {[
                  { id: 'free', label: '교사 선택', desc: '교사가 자유롭게 발표자를 정합니다.' },
                  { id: 'number', label: '번호 순서', desc: '학생 번호순으로 차례가 돌아갑니다.' },
                  { id: 'seat', label: '자리 순서', desc: '최근 자리배치 기준으로 진행합니다.' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setParticipantMode(mode.id as ParticipantMode)}
                    className={`rounded-[1.35rem] border px-4 py-4 text-left transition ${
                      participantMode === mode.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="font-bold">{mode.label}</div>
                    <div className={`mt-2 text-sm leading-5 ${participantMode === mode.id ? 'text-slate-200' : 'text-slate-500'}`}>
                      {mode.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              <div>학생 수: <span className="font-bold text-slate-900">{students?.length ?? 0}명</span></div>
              <div className="mt-1">문제 수: <span className="font-bold text-slate-900">{problems.length}개</span></div>
              <div className="mt-1">최고 기록: <span className="font-bold text-slate-900">{bestScore}점</span></div>
              {participantMode === 'seat' && seatSnapshot.length === 0 && (
                <div className="mt-2 font-semibold text-amber-700">자리 순서는 최근 자리배치 기록이 있어야 사용할 수 있습니다.</div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={startSession}
                className="rounded-full bg-slate-900 px-6 py-3 text-sm font-black text-white hover:bg-slate-700"
              >
                미션 시작
              </button>
              {(session?.status === 'ready' || session?.status === 'running') && (
                <button
                  type="button"
                  onClick={() => void finishSession()}
                  className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  지금 종료
                </button>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs tracking-[0.28em] text-slate-400">MISSION STATUS</div>
                <h2 className="mt-2 text-xl font-black text-slate-900">
                  {session?.status === 'completed' ? '미션 결과 요약' : session ? '미션 진행 요약' : '미션 대기'}
                </h2>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">남은 시간</div>
                <div className={`mt-1 text-2xl font-black ${timeLeft != null && timeLeft <= 10 ? 'text-rose-600' : 'text-slate-900'}`}>
                  {timeLeft == null ? '--' : timeLeft}
                </div>
              </div>
            </div>

            {!session ? (
              <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-16 text-center text-sm text-slate-500">
                설정을 확인한 뒤 미션을 시작하면 학급 전체 도전이 바로 진행됩니다.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard label="누적 정답" value={`${session.score}`} tone="emerald" />
                  <MetricCard label="오답" value={`${session.wrongCount}`} tone="rose" />
                  <MetricCard label="건너뛰기" value={`${session.skipCount}`} tone="amber" />
                  <MetricCard label="목표" value={`${session.targetScore}`} tone="slate" />
                </div>

                <div className="rounded-[2rem] bg-slate-950 px-5 py-6 text-white">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm tracking-[0.3em] text-slate-300">CURRENT TURN</div>
                      <div className="mt-2 text-2xl font-black text-amber-200">
                        {currentResponder ?? '교사 선택'}
                      </div>
                    </div>
                    <div className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200">
                      시도 {session.totalAttempts}회
                    </div>
                  </div>
                  <div className="mt-4 text-sm leading-6 text-slate-300">
                    실제 플레이 화면은 모달로 표시됩니다. 진행 중에는 문제, 정답 확인, 채점 버튼이 모두 모달 안에서 열립니다.
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setModalOpen(true)}
                      className="rounded-full bg-amber-300 px-5 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-200"
                    >
                      진행판 열기
                    </button>
                    {session.status === 'completed' && (
                      <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200">
                        최종 점수 {session.score} / 목표 {session.targetScore}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-800">참여 순서</h3>
              <span className="text-xs text-slate-500">{participantMode === 'free' ? '교사 자유 진행' : `${participantQueue.length}명`}</span>
            </div>
            {participantMode === 'free' ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                교사가 자유롭게 발표자를 정하는 모드입니다.
              </div>
            ) : participantQueue.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                순서를 만들 수 있는 학생 또는 자리 정보가 없습니다.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {participantQueue.map((name, index) => {
                  const isActive = session?.status === 'running' && currentResponder === name;
                  return (
                    <div
                      key={`${name}-${index}`}
                      className={`rounded-xl border px-3 py-3 ${
                        isActive
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-bold tracking-[0.2em] text-slate-400">{index + 1}번</div>
                      <div className="mt-1 font-semibold text-slate-800">{name}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-800">최근 기록</h3>
              <span className="text-xs text-slate-500">{histories?.length ?? 0}건</span>
            </div>
            {!histories || histories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                아직 공동 미션 기록이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {histories.map((entry) => {
                  const payload = readMissionPayload(entry);
                  const succeeded = (payload?.score ?? 0) >= (payload?.targetScore ?? Number.MAX_SAFE_INTEGER);
                  return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 tabular-nums">{formatDateTime(entry.createdAt)}</div>
                          <div className="mt-1 font-semibold text-slate-800">{payload?.score ?? 0}? / ?? {payload?.targetScore ?? 0}?</div>
                          <div className="mt-1 text-sm text-slate-600">
                            {(payload?.timeLimitSec ?? 0) / 60}? ? {payload?.participantMode === 'seat' ? '???' : payload?.participantMode === 'number' ? '???' : '?? ??'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-bold ${succeeded ? 'text-emerald-700' : 'text-slate-500'}`}>
                            {succeeded ? '??' : '??'}
                          </div>
                          <button
                            type="button"
                            onClick={() => void deleteHistory(entry)}
                            className="mt-2 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            ??
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>

      {modalOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-label="미션 진행판 닫기"
          />
          <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-modalRise">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_30%)]" />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-slate-200 px-5 py-4 md:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs tracking-[0.35em] text-slate-400">CLASS MISSION</div>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">
                      {session.status === 'completed' ? '학급 공동 미션 결과' : '학급 공동 미션 진행'}
                    </h2>
                    <div className="mt-2 text-sm text-slate-500">
                      {session.status === 'completed'
                        ? `최종 점수 ${session.score}점 · 목표 ${session.targetScore}점`
                        : `${session.selectedPackId} · ${session.timeLimitSec / 60}분 미션`}
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
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
                <div className="space-y-4">
                  <div className="hidden grid gap-3 md:grid-cols-4">
                    <MetricCard label="누적 정답" value={`${session.score}`} tone="emerald" />
                    <MetricCard label="오답" value={`${session.wrongCount}`} tone="rose" />
                    <MetricCard label="건너뛰기" value={`${session.skipCount}`} tone="amber" />
                    <MetricCard label="목표" value={`${session.targetScore}`} tone="slate" />
                  </div>

                  {session.status === 'completed' ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 rounded-[2rem] bg-slate-950 px-6 py-10 text-center text-white">
                      <div className="text-sm tracking-[0.35em] text-slate-300">MISSION COMPLETE</div>
                      <div className={`text-4xl font-black md:text-5xl ${missionSucceeded ? 'text-emerald-300' : 'text-amber-200'}`}>
                        {missionSucceeded ? '목표 달성 성공' : '미션 종료'}
                      </div>
                      <div className="text-xl text-slate-200">
                        최종 점수 {session.score}점 / 목표 {session.targetScore}점
                      </div>
                      <div className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
                        <MetricCard label="정답" value={`${session.score}`} tone="emerald" />
                        <MetricCard label="오답" value={`${session.wrongCount}`} tone="rose" />
                        <MetricCard label="건너뜀" value={`${session.skipCount}`} tone="amber" />
                      </div>
                    </div>
                  ) : session.status === 'ready' ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 rounded-[2rem] bg-slate-950 px-6 py-10 text-center text-white">
                      <div className="text-sm tracking-[0.35em] text-slate-300">READY TO START</div>
                      <div className="text-4xl font-black text-amber-200 md:text-5xl">학급 공동 미션</div>
                      <div className="max-w-2xl text-lg leading-8 text-slate-200">
                        시작 버튼을 누르면 타이머가 흐르기 시작합니다.
                      </div>
                      <div className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
                        <MetricCard label="목표" value={`${session.targetScore}`} tone="slate" />
                        <MetricCard label="시간" value={`${session.timeLimitSec}`} tone="amber" />
                        <MetricCard label="발표" value={currentResponder ?? '교사'} tone="emerald" />
                      </div>
                      <button
                        type="button"
                        onClick={beginMission}
                        className="rounded-full bg-amber-300 px-8 py-4 text-lg font-black text-slate-950 hover:bg-amber-200"
                      >
                        시작
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="hidden grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
                        <div
                          className={`rounded-[2rem] border px-5 py-5 text-slate-950 shadow-sm ${
                            timerCritical
                              ? 'border-rose-300 bg-[linear-gradient(135deg,#fff1f2_0%,#ffe4e6_100%)] animate-missionTimerDanger'
                              : timerUrgent
                                ? 'border-amber-300 bg-[linear-gradient(135deg,#fffbeb_0%,#fef3c7_100%)] animate-missionTimerPulse'
                                : 'border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-xs font-black tracking-[0.28em] text-slate-400">COUNTDOWN</div>
                              <div className="mt-2 text-sm font-semibold text-slate-500">남은 시간</div>
                            </div>
                            <div className={`rounded-full px-3 py-1 text-xs font-bold ${
                              timerCritical
                                ? 'bg-rose-100 text-rose-700'
                                : timerUrgent
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}>
                              {timerCritical ? '초긴박' : timerUrgent ? '긴박' : '진행 중'}
                            </div>
                          </div>
                          <div className={`mt-4 font-black tabular-nums leading-none ${
                            timerCritical
                              ? 'text-rose-600'
                              : timerUrgent
                                ? 'text-amber-600'
                                : 'text-slate-900'
                          }`}>
                            <span className="text-6xl md:text-7xl">{timeLeft ?? 0}</span>
                            <span className="ml-2 text-2xl md:text-3xl">초</span>
                          </div>
                          <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5">
                            <div
                              className={`h-full rounded-full transition-[width] duration-700 ${
                                timerCritical
                                  ? 'bg-[linear-gradient(90deg,#fb7185_0%,#ef4444_50%,#fb7185_100%)] animate-missionBarFlow'
                                  : timerUrgent
                                    ? 'bg-[linear-gradient(90deg,#fbbf24_0%,#f59e0b_50%,#fde68a_100%)] animate-missionBarFlow'
                                    : 'bg-[linear-gradient(90deg,#0f172a_0%,#334155_100%)]'
                              }`}
                              style={{ width: `${timeProgress}%` }}
                            />
                          </div>
                        </div>

                        <div className="rounded-[2rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                          <div className="text-xs font-black tracking-[0.28em] text-slate-400">TURN INFO</div>
                          <div className="mt-3 text-sm font-semibold text-slate-500">현재 발표자</div>
                          <div className="mt-2 text-2xl font-black text-slate-900 break-keep">
                            {currentResponder ?? '교사 선택'}
                          </div>
                          <div className="mt-5 text-sm font-semibold text-slate-500">진행 현황</div>
                          <div className="mt-2 text-lg font-black text-slate-900">
                            {session.score} / {session.targetScore}점
                          </div>
                          <div className="mt-2 text-sm text-slate-500">
                            시도 {session.totalAttempts}회 · 오답 {session.wrongCount}회 · 건너뜀 {session.skipCount}회
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[2rem] bg-slate-950 px-5 py-7 text-white md:px-7 md:py-8">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm tracking-[0.3em] text-slate-300">CURRENT TURN</div>
                            <div className="mt-2 text-2xl font-black text-amber-200 md:text-3xl">
                              {currentResponder ?? '교사 선택'}
                            </div>
                          </div>
                          <div className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200">
                            남은 시간 {timeLeft ?? 0}초
                          </div>
                        </div>

                        <div className="mt-6 text-xs tracking-[0.26em] text-slate-400">문제</div>
                        <div className="mt-4 text-4xl font-black leading-relaxed text-white md:text-6xl md:leading-[1.28] break-keep">
                          {activeProblem?.phrase
                            ? renderPhraseWithProtectedInitials(activeProblem.phrase)
                            : '시간 종료 또는 문제 없음'}
                        </div>
                        {activeProblem?.hint && (
                          <div className="mt-4 text-base text-slate-300">힌트: {activeProblem.hint}</div>
                        )}

                        <div className="mt-5 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => setAnswerOpen((value) => !value)}
                            className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
                          >
                            {answerOpen ? '정답 숨기기' : '정답 보기'}
                          </button>
                        </div>

                        {answerOpen && (
                          <div className="mt-5 rounded-[1.5rem] bg-white px-5 py-4 text-base font-semibold leading-7 text-slate-900 whitespace-pre-line md:text-xl md:leading-9">
                            정답: {activeProblem?.meaning ?? '등록된 정답이 없습니다.'}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => applyOutcome('correct')}
                          disabled={session.status !== 'running' || !activeProblem}
                          className="rounded-[1.5rem] bg-emerald-500 px-5 py-8 text-lg font-black text-white hover:bg-emerald-400 disabled:bg-slate-300"
                        >
                          정답
                        </button>
                        <button
                          type="button"
                          onClick={() => applyOutcome('wrong')}
                          disabled={session.status !== 'running' || !activeProblem}
                          className="rounded-[1.5rem] bg-rose-500 px-5 py-8 text-lg font-black text-white hover:bg-rose-400 disabled:bg-slate-300"
                        >
                          오답
                        </button>
                        <button
                          type="button"
                          onClick={() => applyOutcome('skip')}
                          disabled={session.status !== 'running' || !activeProblem}
                          className="rounded-[1.5rem] bg-amber-400 px-5 py-8 text-lg font-black text-slate-950 hover:bg-amber-300 disabled:bg-slate-300"
                        >
                          건너뛰기
                        </button>
                      </div>

                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => void finishSession()}
                          className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          미션 종료
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'amber' | 'slate' }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  } as const;

  return (
    <div className={`rounded-[1.4rem] border px-4 py-4 ${tones[tone]}`}>
      <div className="text-xs font-bold tracking-[0.2em]">{label}</div>
      <div className="mt-2 text-3xl font-black">{value}</div>
    </div>
  );
}
