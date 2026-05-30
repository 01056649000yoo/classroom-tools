import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import defaultProblemDeck from '../data/idioms.json';
import idiomInitialProblemDeck from '../data/idiom_initials.json';
import idiomMeaningQuizDeck from '../data/idiom_meaning_quiz.json';
import proverbProblemDeck from '../data/proverbs.json';
import grade3ProblemDeck from '../data/grade3_vocab.json';
import grade4ProblemDeck from '../data/grade4_vocab.json';
import grade5ProblemDeck from '../data/grade5_vocab.json';
import grade6ProblemDeck from '../data/grade6_vocab.json';
import { db, type HistoryEntry, type Student } from '../db';
import { SAVED_PROBLEM_PACKS_KEY, normalizeVocabSentencePack, type ProblemCard, type SavedProblemPack } from '../lib/problemPacks';
import { shuffle } from '../lib/shuffle';
import { sfx } from '../lib/sfx';

type Stage = 'intro' | 'versus' | 'count3' | 'count2' | 'count1' | 'idiom';

type RoundMatch = {
  id: string;
  round: number;
  order: number;
  playerAId: number | null;
  playerBId: number | null;
  winnerId: number | null;
  idiomIndex: number | null;
  autoAdvance: boolean;
  playerAScore: number;
  playerBScore: number;
  totalSets: 1 | 3 | 5;
  targetWins: 1 | 2 | 3;
};

type MatchRule = {
  totalSets: 1 | 3 | 5;
  targetWins: 1 | 2 | 3;
};

type BattlePayload = {
  format: 'idiom-battle/v2' | 'word-survival/v1';
  classId: number;
  participantIds: number[];
  matches: RoundMatch[];
  matchRule: MatchRule;
  currentRound: number;
  status: 'in_progress' | 'completed';
  finishedAt?: number;
};

type BattleSession = BattlePayload & {
  historyId: number | null;
  createdAt: number;
};

type StudentRecord = {
  wins: number;
  losses: number;
  matches: number;
  winRate: number;
};

const MATCH_RULES: MatchRule[] = [
  { totalSets: 1, targetWins: 1 },
  { totalSets: 3, targetWins: 2 },
  { totalSets: 5, targetWins: 3 },
];

function matchRuleLabel(rule: MatchRule) {
  return rule.totalSets === 1 ? '단판' : `${rule.totalSets}전 ${rule.targetWins}선승`;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readString(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeProblemPack(input: unknown): ProblemCard[] {
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

    if (word && definition) {
      return [{
        phrase: definition,
        meaning: example ? `${word}
예문: ${example}` : word,
        hint,
      }];
    }

    const phrase = readString(raw, ['phrase', 'question', 'quiz', 'title']);
    const answer = readString(raw, ['answer', 'meaning', 'description']);
    const explanation = readString(raw, ['meaning', 'description']);
    const meaning = answer && explanation && answer !== explanation
      ? `${answer}
뜻: ${explanation}`
      : answer;
    if (!phrase || !meaning) return [];
    return [{ phrase, meaning, hint }];
  });
}

function isProblemCard(value: unknown): value is ProblemCard {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.phrase === 'string' && typeof raw.meaning === 'string';
}

function loadSavedProblemPacks(): SavedProblemPack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PROBLEM_PACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const pack = entry as Record<string, unknown>;
      if (typeof pack.id !== 'string' || typeof pack.name !== 'string' || !Array.isArray(pack.problems)) {
        return [];
      }
      const problems = pack.problems.filter(isProblemCard);
      if (problems.length === 0) return [];
      return [{
        id: pack.id,
        name: pack.name,
        problems,
        createdAt: typeof pack.createdAt === 'number' ? pack.createdAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function saveProblemPacks(packs: SavedProblemPack[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SAVED_PROBLEM_PACKS_KEY, JSON.stringify(packs));
}

function makeSavedPackId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readBattlePayload(entry: HistoryEntry): BattlePayload | null {
  if ((entry.tool !== 'idiom' && entry.tool !== 'word-survival') || !entry.payload || typeof entry.payload !== 'object') {
    return null;
  }
  const payload = entry.payload as Partial<BattlePayload>;
  if ((payload.format !== 'idiom-battle/v2' && payload.format !== 'word-survival/v1') || !Array.isArray(payload.matches)) {
    return null;
  }
  const matches = payload.matches.flatMap((match) => {
    if (!match || typeof match !== 'object') return [];
    const raw = match as Record<string, unknown>;
    if (
      typeof raw.id !== 'string' ||
      typeof raw.round !== 'number' ||
      typeof raw.order !== 'number'
    ) {
      return [];
    }
    return [{
      id: raw.id,
      round: raw.round,
      order: raw.order,
      playerAId: typeof raw.playerAId === 'number' ? raw.playerAId : null,
      playerBId: typeof raw.playerBId === 'number' ? raw.playerBId : null,
      winnerId: typeof raw.winnerId === 'number' ? raw.winnerId : null,
      idiomIndex: typeof raw.idiomIndex === 'number' ? raw.idiomIndex : null,
      autoAdvance: !!raw.autoAdvance,
      playerAScore: typeof raw.playerAScore === 'number' ? raw.playerAScore : 0,
      playerBScore: typeof raw.playerBScore === 'number' ? raw.playerBScore : 0,
      totalSets: raw.totalSets === 3 ? 3 : raw.totalSets === 5 ? 5 : 1,
      targetWins: raw.targetWins === 2 ? 2 : raw.targetWins === 3 ? 3 : 1,
    } satisfies RoundMatch];
  });
  return {
    format: payload.format === 'word-survival/v1' ? 'word-survival/v1' : 'idiom-battle/v2',
    classId: typeof payload.classId === 'number' ? payload.classId : entry.classId,
    participantIds: Array.isArray(payload.participantIds)
      ? payload.participantIds.filter((id): id is number => typeof id === 'number')
      : [],
    matches,
    matchRule:
      payload.matchRule?.totalSets === 3 || payload.matchRule?.totalSets === 5
        ? {
            totalSets: payload.matchRule.totalSets,
            targetWins: payload.matchRule.targetWins === 2 || payload.matchRule.targetWins === 3
              ? payload.matchRule.targetWins
              : payload.matchRule.totalSets === 3
                ? 2
                : 3,
          }
        : { totalSets: 1, targetWins: 1 },
    currentRound: typeof payload.currentRound === 'number' ? payload.currentRound : 0,
    status: payload.status === 'completed' ? 'completed' : 'in_progress',
    finishedAt: typeof payload.finishedAt === 'number' ? payload.finishedAt : undefined,
  };
}

function buildStudentRecords(
  students: Student[],
  histories: HistoryEntry[],
): Map<number, StudentRecord> {
  const records = new Map<number, StudentRecord>();
  students.forEach((student) => {
    if (student.id == null) return;
    records.set(student.id, { wins: 0, losses: 0, matches: 0, winRate: 0 });
  });

  histories.forEach((entry) => {
    const payload = readBattlePayload(entry);
    if (!payload) return;
    payload.matches.forEach((match) => {
      if (!match.playerAId || !match.playerBId || !match.winnerId) return;
      const loserId = match.winnerId === match.playerAId ? match.playerBId : match.playerAId;
      const winner = records.get(match.winnerId);
      const loser = records.get(loserId);
      if (winner) {
        winner.wins += 1;
        winner.matches += 1;
      }
      if (loser) {
        loser.losses += 1;
        loser.matches += 1;
      }
    });
  });

  records.forEach((record) => {
    record.winRate = record.matches === 0 ? 0.5 : record.wins / record.matches;
  });
  return records;
}

function createSeed(students: Student[]): number[] {
  return shuffle(
    students
      .filter((student): student is Student & { id: number } => student.id != null)
      .map((student) => student.id),
  );
}

function pickIdiomIndices(count: number, idiomCount: number): Array<number | null> {
  if (idiomCount === 0) return Array.from({ length: count }, () => null);
  const result: Array<number | null> = [];
  while (result.length < count) {
    const batch = shuffle(Array.from({ length: idiomCount }, (_, index) => index));
    batch.forEach((index) => {
      if (result.length < count) result.push(index);
    });
  }
  return result;
}

function createRoundMatches(
  participantIds: number[],
  round: number,
  idiomCount: number,
  rule: MatchRule,
): RoundMatch[] {
  const idiomIndices = pickIdiomIndices(Math.ceil(participantIds.length / 2), idiomCount);
  const matches: RoundMatch[] = [];

  for (let i = 0; i < participantIds.length; i += 2) {
    const playerAId = participantIds[i] ?? null;
    const playerBId = participantIds[i + 1] ?? null;
    const autoAdvance = playerAId != null && playerBId == null;
    matches.push({
      id: `r${round}-m${Math.floor(i / 2)}`,
      round,
      order: Math.floor(i / 2),
      playerAId,
      playerBId,
      winnerId: autoAdvance ? playerAId : null,
      idiomIndex: idiomIndices[Math.floor(i / 2)] ?? null,
      autoAdvance,
      playerAScore: autoAdvance ? rule.targetWins : 0,
      playerBScore: 0,
      totalSets: rule.totalSets,
      targetWins: rule.targetWins,
    });
  }

  return matches;
}

function roundName(participantCount: number) {
  if (participantCount <= 2) return '결승';
  return `${participantCount}강전`;
}

function stageLabel(stage: Stage) {
  return {
    intro: '경기 소개',
    versus: '이름 등장',
    count3: '카운트다운 3',
    count2: '카운트다운 2',
    count1: '카운트다운 1',
    idiom: '문제 공개',
  }[stage];
}

function buildParticipantCounts(matches: RoundMatch[]): Map<number, number> {
  const counts = new Map<number, number>();
  const byRound = new Map<number, Set<number>>();
  matches.forEach((match) => {
    const current = byRound.get(match.round) ?? new Set<number>();
    if (match.playerAId != null) current.add(match.playerAId);
    if (match.playerBId != null) current.add(match.playerBId);
    byRound.set(match.round, current);
  });
  byRound.forEach((students, round) => {
    counts.set(round, students.size);
  });
  return counts;
}

export default function IdiomBattlePage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [classId, setClassId] = useState<number | null>(null);
  const [session, setSession] = useState<BattleSession | null>(null);
  const [stage, setStage] = useState<Stage>('intro');
  const [answerOpen, setAnswerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhase, setModalPhase] = useState<'bracket' | 'game'>('bracket');
  const [roundTransitionKey, setRoundTransitionKey] = useState(0);
  const [questionReplayKey, setQuestionReplayKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const problemFileRef = useRef<HTMLInputElement>(null);

  const idiomProblems = useMemo(() => normalizeProblemPack(defaultProblemDeck), []);
  const idiomInitialProblems = useMemo(() => normalizeProblemPack(idiomInitialProblemDeck), []);
  const idiomMeaningQuizProblems = useMemo(() => normalizeProblemPack(idiomMeaningQuizDeck), []);
  const proverbProblems = useMemo(() => normalizeProblemPack(proverbProblemDeck), []);
  const grade3Problems = useMemo(() => normalizeProblemPack(grade3ProblemDeck), []);
  const grade4Problems = useMemo(() => normalizeProblemPack(grade4ProblemDeck), []);
  const grade5Problems = useMemo(() => normalizeProblemPack(grade5ProblemDeck), []);
  const grade6Problems = useMemo(() => normalizeProblemPack(grade6ProblemDeck), []);
  const grade3SentenceProblems = useMemo(() => normalizeVocabSentencePack(grade3ProblemDeck), []);
  const grade4SentenceProblems = useMemo(() => normalizeVocabSentencePack(grade4ProblemDeck), []);
  const grade5SentenceProblems = useMemo(() => normalizeVocabSentencePack(grade5ProblemDeck), []);
  const grade6SentenceProblems = useMemo(() => normalizeVocabSentencePack(grade6ProblemDeck), []);
  const [savedProblemPacks, setSavedProblemPacks] = useState<SavedProblemPack[]>(() => loadSavedProblemPacks());
  const [selectedProblemPackId, setSelectedProblemPackId] = useState('idiom');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [matchRule, setMatchRule] = useState<MatchRule>(MATCH_RULES[0]);
  const selectedSavedPack = savedProblemPacks.find((pack) => pack.id === selectedProblemPackId);
  const problems = selectedSavedPack?.problems
    ?? (selectedProblemPackId === 'proverb' ? proverbProblems
      : selectedProblemPackId === 'idiom-initials' ? idiomInitialProblems
        : selectedProblemPackId === 'idiom-meaning-quiz' ? idiomMeaningQuizProblems
          : selectedProblemPackId === 'grade3-vocab' ? grade3Problems
            : selectedProblemPackId === 'grade4-vocab' ? grade4Problems
              : selectedProblemPackId === 'grade5-vocab' ? grade5Problems
                : selectedProblemPackId === 'grade6-vocab' ? grade6Problems
                  : selectedProblemPackId === 'grade3-vocab-sentence' ? grade3SentenceProblems
                    : selectedProblemPackId === 'grade4-vocab-sentence' ? grade4SentenceProblems
                      : selectedProblemPackId === 'grade5-vocab-sentence' ? grade5SentenceProblems
                        : selectedProblemPackId === 'grade6-vocab-sentence' ? grade6SentenceProblems
                          : idiomProblems);

  const slicedProblems = useMemo(() => {
    if (problems.length === 0) return problems;
    const s = Math.max(0, Math.min(rangeStart - 1, problems.length - 1));
    const e = Math.max(s + 1, Math.min(rangeEnd ?? problems.length, problems.length));
    return problems.slice(s, e);
  }, [problems, rangeStart, rangeEnd]);

  useEffect(() => {
    return () => {
      timerRef.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1 && classes[0].id != null) {
      setClassId(classes[0].id);
    }
  }, [classId, classes]);

  useEffect(() => {
    setSession(null);
    setModalOpen(false);
    setModalPhase('bracket');
    setStage('intro');
    setAnswerOpen(false);
  }, [classId]);

  const students = useLiveQuery<Student[]>(
    () =>
      classId
        ? db.students.where('classId').equals(classId).sortBy('number')
        : Promise.resolve([] as Student[]),
    [classId],
  );

  const histories = useLiveQuery<HistoryEntry[]>(
    () =>
      classId
        ? db.history
            .where('classId')
            .equals(classId)
            .toArray()
            .then((items) =>
              items
                .filter((entry) => entry.tool === 'idiom' || entry.tool === 'word-survival')
                .sort((a, b) => b.createdAt - a.createdAt),
            )
        : Promise.resolve([] as HistoryEntry[]),
    [classId],
  );

  const studentList = students ?? [];
  const survivalHistories = histories ?? [];
  const records = useMemo(
    () => buildStudentRecords(studentList, survivalHistories),
    [studentList, survivalHistories],
  );

  const studentMap = useMemo(() => {
    const map = new Map<number, Student>();
    studentList.forEach((student) => {
      if (student.id != null) map.set(student.id, student);
    });
    return map;
  }, [studentList]);

  const resumeCandidate = useMemo(() => {
    const latest = survivalHistories.find((entry) => {
      const payload = readBattlePayload(entry);
      return payload?.status === 'in_progress';
    });
    if (!latest) return null;
    const payload = readBattlePayload(latest);
    if (!payload) return null;
    return {
      historyId: latest.id ?? null,
      createdAt: latest.createdAt,
      ...payload,
    } satisfies BattleSession;
  }, [survivalHistories]);

  const currentRoundMatches = useMemo(() => {
    if (!session) return [] as RoundMatch[];
    return session.matches
      .filter((match) => match.round === session.currentRound)
      .sort((a, b) => a.order - b.order);
  }, [session]);

  const currentMatch = useMemo(() => {
    return (
      currentRoundMatches.find(
        (match) =>
          match.playerAId != null &&
          match.playerBId != null &&
          match.winnerId == null,
      ) ?? null
    );
  }, [currentRoundMatches]);

  const championId = useMemo(() => {
    if (!session || session.status !== 'completed') return null;
    const lastMatch = session.matches[session.matches.length - 1];
    return lastMatch?.winnerId ?? null;
  }, [session]);

  const activeIdiom = useMemo(() => {
    if (!currentMatch || currentMatch.idiomIndex == null) return null;
    return slicedProblems[currentMatch.idiomIndex] ?? null;
  }, [currentMatch, slicedProblems]);

  const participantCounts = useMemo(
    () => (session ? buildParticipantCounts(session.matches) : new Map<number, number>()),
    [session],
  );

  const currentRoundName = useMemo(() => {
    if (!session) return '';
    return roundName(participantCounts.get(session.currentRound) ?? 0);
  }, [participantCounts, session]);

  const groupedRounds = useMemo(() => {
    if (!session) return [] as Array<{ round: number; matches: RoundMatch[] }>;
    const grouped = new Map<number, RoundMatch[]>();
    session.matches.forEach((match) => {
      const current = grouped.get(match.round) ?? [];
      current.push(match);
      grouped.set(match.round, current);
    });
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, matches]) => ({
        round,
        matches: matches.sort((a, b) => a.order - b.order),
      }));
  }, [session]);

  useEffect(() => {
    if (roundTransitionKey === 0) return;
    sfx.resume();
    sfx.whoosh(600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundTransitionKey]);

  useEffect(() => {
    if (!modalOpen || modalPhase !== 'game') return;
    if (stage === 'count3' || stage === 'count2' || stage === 'count1') {
      sfx.resume();
      sfx.tick();
    } else if (stage === 'idiom') {
      sfx.resume();
      sfx.ding();
    }
  }, [stage, modalOpen, modalPhase]);

  useEffect(() => {
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];

    if (!modalOpen || modalPhase !== 'game' || !currentMatch) return;

    setStage('intro');
    setAnswerOpen(false);

    const schedule = (nextStageValue: Stage, delay: number) => {
      const timer = setTimeout(() => setStage(nextStageValue), delay);
      timerRef.current.push(timer);
    };

    schedule('versus', 900);
    schedule('count3', 2200);
    schedule('count2', 3200);
    schedule('count1', 4200);
    schedule('idiom', 5200);
  }, [currentMatch?.id, modalOpen, modalPhase, questionReplayKey]);

  async function persistSession(nextSession: BattleSession) {
    const payload: BattlePayload = {
      format: 'word-survival/v1',
      classId: nextSession.classId,
      participantIds: nextSession.participantIds,
      matches: nextSession.matches,
      matchRule: nextSession.matchRule,
      currentRound: nextSession.currentRound,
      status: nextSession.status,
      finishedAt: nextSession.finishedAt,
    };

    if (nextSession.historyId == null) {
      const id = await db.history.add({
        classId: nextSession.classId,
        tool: 'word-survival',
        title: `단어 서바이벌 ${nextSession.participantIds.length}명`,
        payload,
        createdAt: nextSession.createdAt,
      });
      setSession({ ...nextSession, historyId: id });
      return;
    }

    await db.history.update(nextSession.historyId, {
      title: `단어 서바이벌 ${nextSession.participantIds.length}명`,
      payload,
    });
    setSession(nextSession);
  }

  async function handleProblemFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const nextProblems = normalizeProblemPack(parsed);
      if (nextProblems.length === 0) {
        alert('사용할 수 있는 문제가 없습니다. phrase/meaning 또는 question/answer 형식인지 확인해 주세요.');
        return;
      }

      if (session && !confirm('문제팩을 바꾸면 현재 진행 중인 대진을 닫습니다. 계속할까요?')) {
        return;
      }

      const packName = file.name.replace(/\.json$/i, '') || '선택한 문제팩';
      const existingPack = savedProblemPacks.find((pack) => pack.name === packName);
      const nextPack: SavedProblemPack = {
        id: existingPack?.id ?? makeSavedPackId(),
        name: packName,
        problems: nextProblems,
        createdAt: existingPack?.createdAt ?? Date.now(),
      };
      const nextSavedPacks = existingPack
        ? savedProblemPacks.map((pack) => (pack.id === existingPack.id ? nextPack : pack))
        : [...savedProblemPacks, nextPack];
      setSavedProblemPacks(nextSavedPacks);
      saveProblemPacks(nextSavedPacks);
      setSelectedProblemPackId(nextPack.id);
      setRangeStart(1);
      setRangeEnd(null);
      setSession(null);
      setModalOpen(false);
      setModalPhase('bracket');
      setStage('intro');
      setAnswerOpen(false);
    } catch (err) {
      alert(`문제 JSON을 읽지 못했습니다: ${(err as Error).message}`);
    } finally {
      if (problemFileRef.current) problemFileRef.current.value = '';
    }
  }

  function resetProblemPack() {
    selectProblemPack('idiom', '기본 문제팩으로 돌아가면 현재 진행 중인 대진을 닫습니다. 계속할까요?');
  }

  function selectProblemPack(nextPackId: string, confirmMessage = '문제팩을 바꾸면 현재 진행 중인 대진을 닫습니다. 계속할까요?') {
    if (session && !confirm(confirmMessage)) {
      return;
    }
    setSelectedProblemPackId(nextPackId);
    setRangeStart(1);
    setRangeEnd(null);
    setSession(null);
    setModalOpen(false);
    setModalPhase('bracket');
    setStage('intro');
    setAnswerOpen(false);
  }

  async function generateBracket() {
    if (!classId) return;
    const eligibleStudents = studentList.filter((student) => student.id != null);
    if (eligibleStudents.length < 2) {
      alert('단어 서바이벌은 학생이 2명 이상 있어야 시작할 수 있습니다.');
      return;
    }

    const seed = createSeed(eligibleStudents);
      const firstRoundMatches = createRoundMatches(seed, 0, slicedProblems.length, matchRule);
      const nextSession: BattleSession = {
        format: 'word-survival/v1',
        classId,
        participantIds: seed,
        matches: firstRoundMatches,
        matchRule,
        currentRound: 0,
        status: 'in_progress',
        historyId: null,
      createdAt: Date.now(),
    };

    await persistSession(nextSession);
    setModalPhase('bracket');
    setModalOpen(true);
    setRoundTransitionKey((value) => value + 1);
  }

  function resumeSession() {
    if (!resumeCandidate) return;
    setSession(resumeCandidate);
    setModalPhase('bracket');
    setModalOpen(true);
    setRoundTransitionKey((value) => value + 1);
  }

  function resumeHistoryEntry(entry: HistoryEntry) {
    const payload = readBattlePayload(entry);
    if (!payload || payload.status !== 'in_progress') return;
    setSession({
      historyId: entry.id ?? null,
      createdAt: entry.createdAt,
      ...payload,
    });
    setModalPhase('bracket');
    setModalOpen(true);
    setRoundTransitionKey((value) => value + 1);
  }

  async function deleteSurvivalHistory(entry: HistoryEntry) {
    if (entry.id == null) return;
    if (!confirm('이 개인전 기록을 삭제할까요? 승률 기록에서도 함께 제외됩니다.')) return;
    await db.history.delete(entry.id);
    if (session?.historyId === entry.id) {
      setSession(null);
      setModalOpen(false);
      setModalPhase('bracket');
      setStage('intro');
      setAnswerOpen(false);
    }
  }


  function pickNextIdiomIndex(currentIndex: number | null): number | null {
    if (slicedProblems.length === 0) return null;
    if (slicedProblems.length === 1) return 0;
    const candidates = Array.from({ length: slicedProblems.length }, (_, index) => index).filter(
      (index) => index !== currentIndex,
    );
    return shuffle(candidates)[0] ?? null;
  }

  async function skipToNextQuestion() {
    if (!session || !currentMatch || !answerOpen) return;
    const nextIdiomIndex = pickNextIdiomIndex(currentMatch.idiomIndex);
    const nextSession: BattleSession = {
      ...session,
      matches: session.matches.map((match) =>
        match.id === currentMatch.id ? { ...match, idiomIndex: nextIdiomIndex } : match,
      ),
    };
    await persistSession(nextSession);
    setAnswerOpen(false);
    setStage('intro');
    setQuestionReplayKey((value) => value + 1);
  }

  async function chooseWinner(winnerId: number) {
    if (!session || !currentMatch) return;

    const updatedMatches = session.matches.map((match) => {
      if (match.id !== currentMatch.id) return { ...match };
      const playerAScore = match.playerAScore + (winnerId === match.playerAId ? 1 : 0);
      const playerBScore = match.playerBScore + (winnerId === match.playerBId ? 1 : 0);
      const finalWinnerId =
        playerAScore >= match.targetWins
          ? match.playerAId
          : playerBScore >= match.targetWins
            ? match.playerBId
            : null;
      return {
        ...match,
        playerAScore,
        playerBScore,
        winnerId: finalWinnerId,
        idiomIndex: finalWinnerId == null ? pickNextIdiomIndex(match.idiomIndex) : match.idiomIndex,
      };
    });
    const currentRoundDone = updatedMatches
      .filter((match) => match.round === session.currentRound)
      .every((match) => match.winnerId != null);

    let nextSession: BattleSession;

    if (!currentRoundDone) {
      nextSession = { ...session, matches: updatedMatches };
    } else {
      const winners = updatedMatches
        .filter((match) => match.round === session.currentRound)
        .map((match) => match.winnerId)
        .filter((id): id is number => id != null);

      if (winners.length <= 1) {
        nextSession = {
          ...session,
          matches: updatedMatches,
          status: 'completed',
          finishedAt: Date.now(),
        };
      } else {
        const nextRound = session.currentRound + 1;
        const nextRoundMatches = createRoundMatches(winners, nextRound, slicedProblems.length, session.matchRule);
        nextSession = {
          ...session,
          matches: [...updatedMatches, ...nextRoundMatches],
          currentRound: nextRound,
          status: 'in_progress',
        };
        setModalPhase('bracket');
      }
    }

    await persistSession(nextSession);
    setAnswerOpen(false);
    if (currentRoundDone) {
      setRoundTransitionKey((value) => value + 1);
    } else {
      setStage('intro');
      setQuestionReplayKey((value) => value + 1);
    }
  }

  const currentA = currentMatch?.playerAId ? studentMap.get(currentMatch.playerAId) : null;
  const currentB = currentMatch?.playerBId ? studentMap.get(currentMatch.playerBId) : null;

  const rankedRecords = useMemo(() => {
    return studentList
      .map((student) => {
        const record = student.id != null
          ? records.get(student.id) ?? { wins: 0, losses: 0, matches: 0, winRate: 0.5 }
          : { wins: 0, losses: 0, matches: 0, winRate: 0.5 };
        return { student, record };
      })
      .sort((a, b) => {
        if (b.record.winRate !== a.record.winRate) return b.record.winRate - a.record.winRate;
        if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
        if (b.record.matches !== a.record.matches) return b.record.matches - a.record.matches;
        return a.student.name.localeCompare(b.student.name, 'ko');
      });
  }, [records, studentList]);

  const recordSummary = useMemo(() => {
    return rankedRecords.reduce(
      (acc, item) => {
        acc.matches += item.record.matches;
        acc.wins += item.record.wins;
        return acc;
      },
      { matches: 0, wins: 0 },
    );
  }, [rankedRecords]);

  async function resetSurvivalRecords() {
    if (!classId) return;
    if (!confirm('현재 학급의 단어 서바이벌 승률 기록을 모두 초기화할까요?')) return;
    const entries = await db.history.where('classId').equals(classId).toArray();
    const ids = entries
      .filter((entry) => (entry.tool === 'idiom' || entry.tool === 'word-survival') && entry.id != null)
      .map((entry) => entry.id!);
    if (ids.length > 0) await db.history.bulkDelete(ids);
    setSession(null);
    setModalOpen(false);
    setModalPhase('bracket');
    setAnswerOpen(false);
    setStage('intro');
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← 홈으로
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px] flex-1">
            <h1 className="text-2xl font-black text-slate-900">단어 서바이벌</h1>
            <p className="mt-1 text-sm text-slate-500">
              사자성어·속담·어휘 문제팩을 JSON으로 선택하고, 모달에서 자동 진행되는 대결을 운영합니다.
            </p>
          </div>
          <div className="ml-auto flex w-full max-w-xl flex-col gap-2 lg:w-auto">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="shrink-0 w-16 text-xs font-bold text-slate-500">문제팩</span>
                <select
                  value={selectedProblemPackId}
                  onChange={(e) => selectProblemPack(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
                >
                  <option value="idiom">사자성어 기본팩(문장완성)</option>
                  <option value="idiom-initials">사자성어 기본팩(초성)</option>
                  <option value="idiom-meaning-quiz">사자성어 기본팩(사자성어 맞추기)</option>
                  <option value="proverb">속담 기본팩</option>
                  <option value="grade3-vocab">3학년 필수 어휘 (단어맞추기)</option>
                  <option value="grade3-vocab-sentence">3학년 필수 어휘 (문장완성)</option>
                  <option value="grade4-vocab">4학년 필수 어휘 (단어맞추기)</option>
                  <option value="grade4-vocab-sentence">4학년 필수 어휘 (문장완성)</option>
                  <option value="grade5-vocab">5학년 필수 어휘 (단어맞추기)</option>
                  <option value="grade5-vocab-sentence">5학년 필수 어휘 (문장완성)</option>
                  <option value="grade6-vocab">6학년 필수 어휘 (단어맞추기)</option>
                  <option value="grade6-vocab-sentence">6학년 필수 어휘 (문장완성)</option>
                  {savedProblemPacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.name}</option>
                  ))}
                </select>
                <Link
                  to="/settings"
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  설정에서 문제팩 관리
                </Link>
                {selectedProblemPackId !== 'idiom' && (
                  <button
                    onClick={resetProblemPack}
                    className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    기본팩으로
                  </button>
                )}
              </div>
              {problems.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span className="shrink-0 w-16 text-xs font-bold text-slate-500">문제 범위</span>
                  <input
                    type="number"
                    min={1}
                    max={problems.length}
                    value={rangeStart}
                    onChange={(e) => setRangeStart(Math.max(1, Math.min(parseInt(e.target.value) || 1, problems.length)))}
                    className="w-14 px-1.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-center text-sm focus:outline-none focus:border-slate-400"
                  />
                  <span className="text-slate-400 text-sm">~</span>
                  <input
                    type="number"
                    min={1}
                    max={problems.length}
                    value={rangeEnd ?? problems.length}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || problems.length;
                      setRangeEnd(v >= problems.length ? null : Math.max(1, v));
                    }}
                    className="w-14 px-1.5 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-center text-sm focus:outline-none focus:border-slate-400"
                  />
                  <span className="text-xs text-slate-400">/ {problems.length}문항</span>
                  <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                    {slicedProblems.length}문항 선택
                  </span>
                  {(rangeStart !== 1 || rangeEnd !== null) && (
                    <button
                      onClick={() => { setRangeStart(1); setRangeEnd(null); }}
                      className="shrink-0 text-xs text-slate-400 hover:text-slate-700"
                    >
                      전체
                    </button>
                  )}
                </div>
              )}
            </div>
            <input
              ref={problemFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleProblemFile}
            />
            <div className="self-end rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              사용자 문제팩은 설정 페이지에서 직접 작성해 저장한 뒤 여기서 바로 선택해 사용할 수 있습니다.
            </div>
          </div>
        </div>
      </div>

      {problems.length === 0 && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900">
          <div className="font-semibold">사용 가능한 문제팩이 아직 없습니다.</div>
          <div className="text-sm mt-1">
            설정에서 사용자 문제팩을 저장한 뒤 여기서 선택해 주세요.
          </div>
        </div>
      )}

      <section className="p-4 bg-white border border-slate-200 rounded-2xl">
        <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr,auto] items-end">
          <div>
            <label className="block text-sm text-slate-600 mb-2">학급 선택</label>
            <select
              value={classId ?? ''}
              onChange={(e) => setClassId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white focus:outline-none focus:border-slate-500"
            >
              <option value="">선택하세요</option>
              {classes?.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-slate-500">
              등록 학생 {studentList.length}명 · 최근 서바이벌 기록 {survivalHistories.length}개
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-2">승부 방식</label>
            <select
              value={matchRule.totalSets}
              onChange={(e) => {
                const nextRule = MATCH_RULES.find((rule) => rule.totalSets === Number(e.target.value));
                if (nextRule) setMatchRule(nextRule);
              }}
              className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white focus:outline-none focus:border-slate-500"
            >
              {MATCH_RULES.map((rule) => (
                <option key={rule.totalSets} value={rule.totalSets}>{matchRuleLabel(rule)}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-slate-500">한 대진에서 먼저 {matchRule.targetWins}승</div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {resumeCandidate && (
              <button
                onClick={resumeSession}
                className="px-4 py-2 rounded-md border border-slate-300 hover:bg-slate-100"
              >
                최근 진행 세션 이어하기
              </button>
            )}
            <button
              onClick={generateBracket}
              disabled={!classId || studentList.length < 2}
              className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300"
            >
              단어 서바이벌 시작
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr,0.95fr]">
        <section className="space-y-4">
          <div className="p-4 bg-white border border-slate-200 rounded-2xl">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="font-semibold text-slate-900">현재 라운드 대진</div>
                <div className="text-sm text-slate-500">
                  {session ? `${currentRoundName} 대진이 순서대로 진행됩니다.` : '서바이벌을 시작하면 여기 대진이 표시됩니다.'}
                </div>
              </div>
              {session && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700"
                >
                  진행 모달 열기
                </button>
              )}
            </div>

            {!session && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-slate-500">
                단어 서바이벌 시작을 누르면 현재 라운드의 전체 대진이 먼저 표시됩니다.
              </div>
            )}

            {session && (
              <div key={roundTransitionKey} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-roundBoardIn">
                {currentRoundMatches.map((match) => {
                  const playerA = match.playerAId ? studentMap.get(match.playerAId) : null;
                  const playerB = match.playerBId ? studentMap.get(match.playerBId) : null;
                  const isCurrent = currentMatch?.id === match.id;
                  return (
                    <div
                      key={match.id}
                      className={`rounded-2xl border p-4 transition ${
                        isCurrent
                          ? 'border-amber-400 bg-amber-50 shadow-sm'
                          : match.winnerId != null
                            ? 'border-emerald-300 bg-emerald-50'
                            : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                        <span>{currentRoundName}</span>
                        <span>{match.order + 1}경기</span>
                      </div>
                      <div className="space-y-2">
                        <div className={`rounded-xl px-3 py-3 ${match.winnerId === match.playerAId ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>
                          {playerA?.name ?? '대기'}
                        </div>
                        <div className="text-center text-xs font-semibold text-slate-400">
                          {match.autoAdvance ? '부전승' : 'VS'}
                        </div>
                        <div className={`rounded-xl px-3 py-3 ${match.winnerId === match.playerBId ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>
                          {playerB?.name ?? (match.autoAdvance ? '자동 진출' : '대기')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {session && session.status === 'completed' && championId && (
            <div className="p-6 rounded-3xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white text-center">
              <div className="text-xs tracking-[0.35em] text-amber-700">CHAMPION</div>
              <div className="text-6xl mt-3">🏆</div>
              <div className="text-4xl font-black text-slate-900 mt-3">
                {studentMap.get(championId)?.name ?? '우승자'}
              </div>
              <div className="text-sm text-slate-500 mt-2">
                저장된 결과는 다음 대진 생성 때 승률에 반영됩니다.
              </div>
            </div>
          )}

          {session && groupedRounds.length > 1 && (
            <div className="p-4 bg-white border border-slate-200 rounded-2xl">
              <div className="font-semibold text-slate-800 mb-3">전체 진행 기록</div>
              <div className="space-y-3">
                {groupedRounds.map((group) => (
                  <div key={group.round} className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                    <div className="text-sm font-semibold text-slate-700 mb-2">
                      {roundName(participantCounts.get(group.round) ?? 0)}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.matches.map((match) => {
                        const playerA = match.playerAId ? studentMap.get(match.playerAId) : null;
                        const playerB = match.playerBId ? studentMap.get(match.playerBId) : null;
                        return (
                          <div key={match.id} className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm">
                            <div className={match.winnerId === match.playerAId ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                              {playerA?.name ?? '대기'}
                            </div>
                            <div className="text-[11px] text-slate-400">{match.autoAdvance ? '자동 진출' : 'VS'}</div>
                            <div className={match.winnerId === match.playerBId ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                              {playerB?.name ?? '대기'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="p-4 bg-white border border-slate-200 rounded-2xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="font-semibold text-slate-800">승률 기록</div>
                <div className="text-xs text-slate-500">단어 서바이벌 결과 기준</div>
              </div>
              <button
                onClick={resetSurvivalRecords}
                disabled={!classId || survivalHistories.length === 0}
                className="px-3 py-1.5 rounded-md border border-red-200 text-xs text-red-600 hover:bg-red-50 disabled:text-slate-300 disabled:border-slate-200 disabled:hover:bg-white"
              >
                승률 초기화
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <div className="text-lg font-black text-slate-900">{studentList.length}</div>
                <div className="text-[11px] text-slate-500">학생</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <div className="text-lg font-black text-slate-900">{Math.floor(recordSummary.matches / 2)}</div>
                <div className="text-[11px] text-slate-500">승패 경기</div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <div className="text-lg font-black text-slate-900">{survivalHistories.length}</div>
                <div className="text-[11px] text-slate-500">기록</div>
              </div>
            </div>

            {studentList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                먼저 학급을 선택해 주세요.
              </div>
            ) : (
              <div className="max-h-[360px] overflow-y-auto pr-1 space-y-2">
                {rankedRecords.map(({ student, record }, index) => (
                  <div
                    key={student.id}
                    className="rounded-xl border border-slate-200 px-3 py-2 bg-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800 truncate">{student.name}</div>
                          <div className="text-xs text-slate-500">
                            {record.wins}승 {record.losses}패 · {record.matches}경기
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-black text-slate-900">
                        {(record.winRate * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${Math.round(record.winRate * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {survivalHistories.length > 0 && (
            <section className="p-4 bg-white border border-slate-200 rounded-2xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-800">개인전 결과 기록</div>
                <span className="text-xs text-slate-500">({survivalHistories.length}건)</span>
                <span className="text-xs text-slate-400">· 홈의 "내 컴퓨터에 저장"으로 함께 백업됩니다</span>
              </div>
              <div className="max-h-[260px] overflow-y-auto pr-1 space-y-2">
                {survivalHistories.map((entry) => {
                  const payload = readBattlePayload(entry);
                  const championMatch = payload?.status === 'completed'
                    ? payload.matches[payload.matches.length - 1]
                    : null;
                  const champion = championMatch?.winnerId ? studentMap.get(championMatch.winnerId) : null;
                  return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {formatDateTime(entry.createdAt)}
                          </div>
                          <div className="mt-1 font-semibold text-slate-800">{entry.title}</div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${payload?.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {payload?.status === 'completed' ? '완료' : '진행 중'}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-600">
                        우승: {champion?.name ?? (payload?.status === 'completed' ? '기록 없음' : '아직 미정')}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {payload?.status === 'in_progress' && (
                          <button
                            type="button"
                            onClick={() => resumeHistoryEntry(entry)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700"
                          >
                            이어서 진행
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteSurvivalHistory(entry)}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          기록 삭제
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="p-4 bg-white border border-slate-200 rounded-2xl">
            <div className="font-semibold text-slate-800 mb-3">진행 규칙</div>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>시작하면 랜덤으로 섞인 현재 라운드 전체 대진이 모달 사다리 화면에 먼저 표시됩니다.</li>
              <li>이름 소개, 3·2·1, 문제 공개는 자동으로 넘어가고 교사는 승자만 선택합니다.</li>
              <li>현재 라운드가 모두 끝나면 다음 라운드 대진이 자동 생성되어 바로 이어집니다.</li>
              <li>홀수 인원 라운드에서는 마지막 학생이 자동 진출합니다.</li>
            </ul>
          </section>
        </aside>
      </div>

      {modalOpen && session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-label="모달 닫기"
          />
          <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-modalRise">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.22),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(244,63,94,0.18),_transparent_35%)]" />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 p-5 pb-4 md:p-6 md:pb-5">
                <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <div className="text-xs tracking-[0.35em] text-slate-400 uppercase">
                    {currentRoundName || '서바이벌'}
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-2">
                    {modalPhase === 'bracket' && session.status !== 'completed'
                      ? `${currentRoundName} 대진 확인`
                      : currentMatch
                        ? `${currentMatch.order + 1}경기 진행 중`
                        : session.status === 'completed'
                          ? '서바이벌 종료'
                          : '다음 경기 준비 중'}
                  </div>
                      <div className="text-sm text-slate-500 mt-1">
                        {modalPhase === 'bracket' && session.status !== 'completed'
                          ? '전체 대진을 확인한 뒤 순서대로 게임을 시작합니다.'
                          : currentMatch
                        ? `${matchRuleLabel(currentMatch)} · ${currentMatch.playerAScore} : ${currentMatch.playerBScore} · 단계: ${stageLabel(stage)}`
                        : '승자 선택 직후 다음 경기로 자동 이동합니다.'}
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100"
                >
                  닫기
                </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-6 md:pb-6">

              {modalPhase === 'bracket' && session.status !== 'completed' && (
                <div className="min-h-[420px] flex flex-col gap-4">
                  <div className="rounded-[2rem] bg-slate-950 text-white p-5 md:p-6 overflow-hidden relative">
                    <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
                    <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-rose-400/20 blur-3xl" />
                    <div className="relative text-center mb-6">
                      <div className="text-xs tracking-[0.35em] text-amber-200">LADDER BRACKET</div>
                      <div className="text-3xl md:text-4xl font-black mt-2">{currentRoundName}</div>
                      <div className="text-sm text-slate-300 mt-2">위에서 아래 순서대로 경기가 진행됩니다.</div>
                    </div>
                    <div className="relative grid gap-3">
                      {currentRoundMatches.map((match) => {
                        const playerA = match.playerAId ? studentMap.get(match.playerAId) : null;
                        const playerB = match.playerBId ? studentMap.get(match.playerBId) : null;
                        const done = match.winnerId != null;
                        return (
                          <div
                            key={match.id}
                            className={`grid grid-cols-[1fr,70px,1fr] items-center gap-2 md:gap-3 rounded-2xl border px-3 py-2.5 md:px-4 md:py-3 ${
                              done ? 'border-emerald-300/40 bg-emerald-300/10' : 'border-white/10 bg-white/8'
                            }`}
                          >
                            <div className="rounded-xl bg-white text-slate-900 px-3 py-2.5 text-center font-black text-base md:text-xl break-keep">
                              {playerA?.name ?? '대기'}
                            </div>
                            <div className="relative h-16 flex items-center justify-center">
                              <div className="absolute left-0 right-0 top-1/2 h-px bg-amber-200/60" />
                              <div className="absolute left-1/2 top-2 bottom-2 w-px bg-amber-200/60" />
                              <div className="relative z-10 rounded-full bg-amber-300 text-slate-950 px-2 py-1 text-[11px] font-black">
                                {match.autoAdvance ? 'PASS' : `${match.order + 1}`}
                              </div>
                            </div>
                            <div className="rounded-xl bg-white text-slate-900 px-3 py-2.5 text-center font-black text-base md:text-xl break-keep">
                              {playerB?.name ?? (match.autoAdvance ? '자동 진출' : '대기')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      onClick={() => setModalPhase('game')}
                      disabled={!currentMatch}
                      className="min-w-[240px] px-6 py-4 rounded-2xl bg-slate-900 text-white font-bold text-lg hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      이 순서로 게임 시작
                    </button>
                    <button
                      onClick={() => setModalOpen(false)}
                      className="px-6 py-4 rounded-2xl border border-slate-300 bg-white hover:bg-slate-100"
                    >
                      대진만 보기
                    </button>
                  </div>
                </div>
              )}

              {session.status === 'completed' && championId && (
                <div className="min-h-[420px] flex flex-col items-center justify-center text-center">
                  <div className="text-sm tracking-[0.35em] text-amber-600">FINAL WINNER</div>
                  <div className="text-[80px] leading-none mt-3">🏆</div>
                  <div className="text-4xl md:text-5xl font-black text-slate-900 mt-4">
                    {studentMap.get(championId)?.name ?? '우승자'}
                  </div>
                </div>
              )}

              {modalPhase === 'game' && session.status !== 'completed' && currentMatch && currentA && currentB && (
                <div className="min-h-[420px] flex flex-col justify-between gap-5">
                <div className="grid md:grid-cols-[1fr,auto,1fr] gap-4 items-center text-center">
                  <div className={`rounded-[1.75rem] border px-5 py-7 bg-white/90 ${stage === 'versus' || stage === 'idiom' ? 'animate-battlePulse border-blue-200' : 'border-slate-200'}`}>
                    <div className="text-xs text-slate-400 mb-3">학생 A</div>
                    <div className="mb-3 text-sm font-black text-blue-600">{currentMatch.playerAScore}승</div>
                    <div className="text-4xl md:text-6xl font-black text-slate-900 break-keep animate-nameZoom">
                      {currentA.name}
                    </div>
                  </div>
                  <div className="text-3xl md:text-5xl font-black text-rose-500 animate-versusGlow">VS</div>
                  <div className={`rounded-[1.75rem] border px-5 py-7 bg-white/90 ${stage === 'versus' || stage === 'idiom' ? 'animate-battlePulse border-rose-200' : 'border-slate-200'}`}>
                    <div className="text-xs text-slate-400 mb-3">학생 B</div>
                    <div className="mb-3 text-sm font-black text-rose-600">{currentMatch.playerBScore}승</div>
                    <div className="text-4xl md:text-6xl font-black text-slate-900 break-keep animate-nameZoom">
                      {currentB.name}
                    </div>
                  </div>
                </div>

                  <div className="rounded-[2rem] bg-slate-900 text-white p-6 text-center min-h-[180px] flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle,_rgba(251,191,36,0.18),_transparent_45%)] animate-slowPulse" />
                    {stage === 'intro' && (
                      <div className="relative space-y-3 animate-fadeUp">
                        <div className="text-sm tracking-[0.35em] text-slate-300">MATCH READY</div>
                        <div className="text-2xl md:text-3xl font-black">곧 경기가 시작됩니다</div>
                      </div>
                    )}
                    {stage === 'versus' && (
                      <div className="relative text-4xl md:text-6xl font-black animate-fadeUp">
                        {currentA.name} vs {currentB.name}
                      </div>
                    )}
                    {(stage === 'count3' || stage === 'count2' || stage === 'count1') && (
                      <div className="relative text-[96px] md:text-[144px] leading-none font-black text-amber-300 animate-countBeat">
                        {stage === 'count3' ? '3' : stage === 'count2' ? '2' : '1'}
                      </div>
                    )}
                    {stage === 'idiom' && (
                      <div className="relative w-full max-w-4xl space-y-5 animate-fadeUp">
                        <div className="text-xs tracking-[0.4em] text-slate-300">문제</div>
                        <div className="text-3xl leading-relaxed md:text-5xl md:leading-[1.45] font-black break-keep text-amber-200">
                          {activeIdiom?.phrase ?? '문제 JSON 데이터를 넣어 주세요'}
                        </div>
                        {activeIdiom?.hint && (
                          <div className="text-sm text-slate-300">힌트: {activeIdiom.hint}</div>
                        )}
                        <div className="flex justify-center gap-2 pt-2">
                          <button
                            onClick={() => setAnswerOpen((value) => !value)}
                            className="px-3 py-1.5 rounded-full bg-white/10 border border-white/20 hover:bg-white/20"
                          >
                            {answerOpen ? '정답 확인 완료' : '정답 확인'}
                          </button>
                        </div>
                        {answerOpen && (
                          <div className="rounded-2xl bg-white text-slate-900 px-5 py-4 text-base leading-7 md:text-lg md:leading-8 font-semibold whitespace-pre-line">
                            정답: {activeIdiom?.meaning ?? '아직 등록된 정답이 없습니다.'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-center gap-4">
                    <button
                      onClick={() => chooseWinner(currentA.id!)}
                      disabled={stage !== 'idiom' || !answerOpen}
                      className="min-w-[220px] px-6 py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg hover:bg-blue-500 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {currentA.name} 승리
                    </button>
                    <button
                      onClick={skipToNextQuestion}
                      disabled={stage !== 'idiom' || !answerOpen}
                      className="min-w-[220px] px-6 py-4 rounded-2xl bg-amber-500 text-slate-950 font-bold text-lg hover:bg-amber-400 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      둘 다 오답 · 다음 문제
                    </button>
                    <button
                      onClick={() => chooseWinner(currentB.id!)}
                      disabled={stage !== 'idiom' || !answerOpen}
                      className="min-w-[220px] px-6 py-4 rounded-2xl bg-rose-600 text-white font-bold text-lg hover:bg-rose-500 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {currentB.name} 승리
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
