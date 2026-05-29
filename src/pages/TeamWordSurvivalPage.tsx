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
import { db, type HistoryEntry } from '../db';
import { type SeatResultSeat } from '../lib/backup';
import { shuffle } from '../lib/shuffle';
import { sfx } from '../lib/sfx';

type ProblemCard = { phrase: string; meaning: string; hint?: string };
type SavedProblemPack = { id: string; name: string; problems: ProblemCard[]; createdAt: number };
type Team = { id: string; label: string; members: string[]; row?: number; cols?: number[] };
type MatchRule = { totalSets: 3 | 5; targetWins: 2 | 3 };
type TeamMatch = { id: string; round: number; order: number; teamAId: string | null; teamBId: string | null; winnerTeamId: string | null; problemIndex: number | null; autoAdvance: boolean; teamAScore: number; teamBScore: number; totalSets: 3 | 5; targetWins: 2 | 3 };
type Stage = 'ready' | 'count3' | 'count2' | 'count1' | 'problem';
type SavedTeamBattleSession = { format: 'word-survival-team-session/v1'; classId: number; seatSignature: string; teams: Team[]; matches: TeamMatch[]; currentRound: number; selectedPackId: string; matchRule: MatchRule; modalPhase: 'bracket' | 'game'; savedAt: number };

const SAVED_PROBLEM_PACKS_KEY = 'word-survival:saved-problem-packs';
const TEAM_SESSION_KEY_PREFIX = 'word-survival-team:session:';
const MATCH_RULES: MatchRule[] = [
  { totalSets: 3, targetWins: 2 },
  { totalSets: 5, targetWins: 3 },
];

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
  try {
    const raw = window.localStorage.getItem(SAVED_PROBLEM_PACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const pack = entry as Record<string, unknown>;
      if (typeof pack.id !== 'string' || typeof pack.name !== 'string' || !Array.isArray(pack.problems)) return [];
      const problems = pack.problems.filter(isProblemCard);
      if (problems.length === 0) return [];
      return [{ id: pack.id, name: pack.name, problems, createdAt: typeof pack.createdAt === 'number' ? pack.createdAt : Date.now() }];
    });
  } catch {
    return [];
  }
}

function snapshotFromHistory(entry: HistoryEntry | undefined): SeatResultSeat[] {
  if (!entry || !entry.payload || typeof entry.payload !== 'object') return [];
  const payload = entry.payload as { snapshot?: SeatResultSeat[] };
  return Array.isArray(payload.snapshot) ? payload.snapshot : [];
}

function teamSessionKey(classId: number) {
  return `${TEAM_SESSION_KEY_PREFIX}${classId}`;
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

function isMatchRule(value: unknown): value is MatchRule {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (raw.totalSets === 3 && raw.targetWins === 2) || (raw.totalSets === 5 && raw.targetWins === 3);
}

function isTeamMatch(value: unknown): value is TeamMatch {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === 'string'
    && typeof raw.round === 'number'
    && typeof raw.order === 'number'
    && (typeof raw.teamAId === 'string' || raw.teamAId === null)
    && (typeof raw.teamBId === 'string' || raw.teamBId === null)
    && (typeof raw.winnerTeamId === 'string' || raw.winnerTeamId === null)
    && (typeof raw.problemIndex === 'number' || raw.problemIndex === null)
    && typeof raw.autoAdvance === 'boolean'
    && typeof raw.teamAScore === 'number'
    && typeof raw.teamBScore === 'number'
    && isMatchRule({ totalSets: raw.totalSets, targetWins: raw.targetWins });
}

function isTeam(value: unknown): value is Team {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === 'string'
    && typeof raw.label === 'string'
    && Array.isArray(raw.members)
    && raw.members.every((member) => typeof member === 'string');
}

function loadTeamBattleSession(classId: number, seatSignature: string): SavedTeamBattleSession | null {
  try {
    const key = teamSessionKey(classId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const session = parsed as Record<string, unknown>;
    const valid = session.format === 'word-survival-team-session/v1'
      && session.classId === classId
      && session.seatSignature === seatSignature
      && Array.isArray(session.teams)
      && session.teams.every(isTeam)
      && Array.isArray(session.matches)
      && session.matches.every(isTeamMatch)
      && typeof session.currentRound === 'number'
      && typeof session.selectedPackId === 'string'
      && isMatchRule(session.matchRule)
      && (session.modalPhase === 'bracket' || session.modalPhase === 'game');
    if (!valid) {
      window.localStorage.removeItem(key);
      return null;
    }
    return session as SavedTeamBattleSession;
  } catch {
    window.localStorage.removeItem(teamSessionKey(classId));
    return null;
  }
}

function saveTeamBattleSession(session: SavedTeamBattleSession) {
  window.localStorage.setItem(teamSessionKey(session.classId), JSON.stringify(session));
}

function clearTeamBattleSession(classId: number) {
  window.localStorage.removeItem(teamSessionKey(classId));
}

function buildTeams(snapshot: SeatResultSeat[]): Team[] {
  const byRow = new Map<number, SeatResultSeat[]>();
  snapshot.forEach((seat) => {
    if (!seat.name) return;
    const row = seat.row;
    const list = byRow.get(row) ?? [];
    list.push(seat);
    byRow.set(row, list);
  });
  const teams: Team[] = [];
  [...byRow.entries()].sort((a, b) => a[0] - b[0]).forEach(([row, seats]) => {
    const sorted = seats.sort((a, b) => a.col - b.col);
    for (let i = 0; i < sorted.length; i += 2) {
      const group = sorted.slice(i, i + 2);
      teams.push({
        id: `team-${teams.length + 1}`,
        label: `${teams.length + 1}팀`,
        members: group.map((seat) => seat.name),
        row,
        cols: group.map((seat) => seat.col),
      });
    }
  });
  return teams;
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

function createMatches(teamIds: string[], round: number, problemCount: number, rule: MatchRule): TeamMatch[] {
  const problemIndices = pickProblemIndices(Math.ceil(teamIds.length / 2), problemCount);
  const matches: TeamMatch[] = [];
  for (let i = 0; i < teamIds.length; i += 2) {
    const teamAId = teamIds[i] ?? null;
    const teamBId = teamIds[i + 1] ?? null;
    const autoAdvance = teamAId != null && teamBId == null;
    matches.push({
      id: `r${round}-m${Math.floor(i / 2)}`,
      round,
      order: Math.floor(i / 2),
      teamAId,
      teamBId,
      winnerTeamId: autoAdvance ? teamAId : null,
      problemIndex: problemIndices[Math.floor(i / 2)] ?? null,
      autoAdvance,
      teamAScore: 0,
      teamBScore: 0,
      totalSets: rule.totalSets,
      targetWins: rule.targetWins,
    });
  }
  return matches;
}

function roundName(count: number) {
  if (count <= 2) return '결승';
  return `${count}팀전`;
}

function matchRuleLabel(rule: MatchRule) {
  return `${rule.totalSets}전 ${rule.targetWins}선승`;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pickNextProblemIndex(problemCount: number): number | null {
  if (problemCount === 0) return null;
  return Math.floor(Math.random() * problemCount);
}

export default function TeamWordSurvivalPage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [classId, setClassId] = useState<number | null>(null);
  const latestSeatHistory = useLiveQuery<HistoryEntry | undefined>(
    () => classId
      ? db.history.where('classId').equals(classId).filter((entry) => entry.tool === 'seat').last()
      : Promise.resolve(undefined),
    [classId],
  );
  const teamHistories = useLiveQuery<HistoryEntry[]>(
    () =>
      classId
        ? db.history
            .where('classId')
            .equals(classId)
            .toArray()
            .then((items) =>
              items
                .filter((entry) => entry.tool === 'word-survival-team')
                .sort((a, b) => b.createdAt - a.createdAt),
            )
        : Promise.resolve([] as HistoryEntry[]),
    [classId],
  );

  const idiomProblems = useMemo(() => normalizeProblemPack(defaultProblemDeck), []);
  const idiomInitialProblems = useMemo(() => normalizeProblemPack(idiomInitialProblemDeck), []);
  const idiomMeaningQuizProblems = useMemo(() => normalizeProblemPack(idiomMeaningQuizDeck), []);
  const proverbProblems = useMemo(() => normalizeProblemPack(proverbProblemDeck), []);
  const grade3Problems = useMemo(() => normalizeProblemPack(grade3ProblemDeck), []);
  const grade4Problems = useMemo(() => normalizeProblemPack(grade4ProblemDeck), []);
  const grade5Problems = useMemo(() => normalizeProblemPack(grade5ProblemDeck), []);
  const grade6Problems = useMemo(() => normalizeProblemPack(grade6ProblemDeck), []);
  const [savedPacks] = useState<SavedProblemPack[]>(() => loadSavedProblemPacks());
  const [selectedPackId, setSelectedPackId] = useState('idiom');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [matchRule, setMatchRule] = useState<MatchRule>(MATCH_RULES[0]);
  const selectedSavedPack = savedPacks.find((pack) => pack.id === selectedPackId);
  const problems = selectedSavedPack?.problems ?? (selectedPackId === 'proverb' ? proverbProblems
    : selectedPackId === 'idiom-initials' ? idiomInitialProblems
      : selectedPackId === 'idiom-meaning-quiz' ? idiomMeaningQuizProblems
        : selectedPackId === 'grade3-vocab' ? grade3Problems
      : selectedPackId === 'grade4-vocab' ? grade4Problems
        : selectedPackId === 'grade5-vocab' ? grade5Problems
          : selectedPackId === 'grade6-vocab' ? grade6Problems
            : idiomProblems);

  const slicedProblems = useMemo(() => {
    if (problems.length === 0) return problems;
    const s = Math.max(0, Math.min(rangeStart - 1, problems.length - 1));
    const e = Math.max(s + 1, Math.min(rangeEnd ?? problems.length, problems.length));
    return problems.slice(s, e);
  }, [problems, rangeStart, rangeEnd]);

  useEffect(() => {
    if (classId == null && classes && classes.length === 1 && classes[0].id != null) {
      setClassId(classes[0].id);
    }
  }, [classId, classes]);

  const seatSnapshot = useMemo(() => snapshotFromHistory(latestSeatHistory), [latestSeatHistory]);
  const seatSignature = useMemo(() => seatSnapshotSignature(seatSnapshot), [seatSnapshot]);
  const teams = useMemo(() => buildTeams(seatSnapshot), [seatSnapshot]);
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const [matches, setMatches] = useState<TeamMatch[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPhase, setModalPhase] = useState<'bracket' | 'game'>('bracket');
  const [answerOpen, setAnswerOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('ready');
  const [championTeamId, setChampionTeamId] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<SavedTeamBattleSession | null>(null);
  const [restoredSessionAt, setRestoredSessionAt] = useState<number | null>(null);
  const prevBracketVisibleRef = useRef(false);

  useEffect(() => {
    const visible = modalOpen && modalPhase === 'bracket';
    if (visible && !prevBracketVisibleRef.current) {
      sfx.resume();
      sfx.whoosh(600);
    }
    prevBracketVisibleRef.current = visible;
  }, [modalOpen, modalPhase]);

  const currentRoundMatches = matches.filter((match) => match.round === currentRound).sort((a, b) => a.order - b.order);
  const currentMatch = currentRoundMatches.find((match) => match.teamAId && match.teamBId && !match.winnerTeamId) ?? null;
  const activeProblem = currentMatch?.problemIndex != null ? slicedProblems[currentMatch.problemIndex] : null;
  const currentParticipantCount = new Set(currentRoundMatches.flatMap((match) => [match.teamAId, match.teamBId].filter(Boolean))).size;

  function applySavedSession(savedSession: SavedTeamBattleSession) {
    setMatches(savedSession.matches);
    setCurrentRound(savedSession.currentRound);
    setSelectedPackId(savedSession.selectedPackId);
    setMatchRule(savedSession.matchRule);
    setModalPhase(savedSession.modalPhase);
    setModalOpen(true);
    setPendingSession(null);
    setRestoredSessionAt(savedSession.savedAt);
  }

  function discardPendingSession() {
    if (!classId) return;
    clearTeamBattleSession(classId);
    setPendingSession(null);
    setRestoredSessionAt(null);
  }

  useEffect(() => {
    setMatches([]);
    setCurrentRound(0);
    setChampionTeamId(null);
    setAnswerOpen(false);
    setStage('ready');
    setModalPhase('bracket');
    setModalOpen(false);
    setPendingSession(null);
    setRestoredSessionAt(null);

    if (!classId || seatSnapshot.length === 0) return;
    const savedSession = loadTeamBattleSession(classId, seatSignature);
    if (!savedSession) return;

    setPendingSession(savedSession);
    setRestoredSessionAt(savedSession.savedAt);
  }, [classId, seatSignature, seatSnapshot.length]);

  useEffect(() => {
    if (!classId || seatSnapshot.length === 0 || matches.length === 0) return;
    if (championTeamId) {
      clearTeamBattleSession(classId);
      return;
    }
    saveTeamBattleSession({
      format: 'word-survival-team-session/v1',
      classId,
      seatSignature,
      teams,
      matches,
      currentRound,
      selectedPackId,
      matchRule,
      modalPhase,
      savedAt: Date.now(),
    });
  }, [championTeamId, classId, currentRound, matchRule, matches, modalPhase, seatSignature, seatSnapshot.length, selectedPackId, teams]);

  function startTeamBattle() {
    if (teams.length < 2) {
      alert('팀전은 팀이 2개 이상 필요합니다. 먼저 자리 배치를 만들어 주세요.');
      return;
    }
    const seed = shuffle(teams.map((team) => team.id));
    const nextMatches = createMatches(seed, 0, slicedProblems.length, matchRule);
    if (classId) clearTeamBattleSession(classId);
    setMatches(nextMatches);
    setCurrentRound(0);
    setChampionTeamId(null);
    setAnswerOpen(false);
    setStage('ready');
    setModalPhase('bracket');
    setModalOpen(true);
    setPendingSession(null);
    setRestoredSessionAt(null);
  }

  function revealProblem() {
    sfx.resume();
    sfx.tick();
    setStage('count3');
    window.setTimeout(() => { sfx.tick(); setStage('count2'); }, 700);
    window.setTimeout(() => { sfx.tick(); setStage('count1'); }, 1400);
    window.setTimeout(() => { sfx.ding(); setStage('problem'); }, 2100);
  }

  async function deleteTeamHistory(entry: HistoryEntry) {
    if (entry.id == null) return;
    if (!confirm('이 팀전 결과 기록을 삭제할까요? 백업 대상에서도 함께 제외됩니다.')) return;
    await db.history.delete(entry.id);
  }

  function skipToNextProblem() {
    if (!currentMatch || !answerOpen) return;
    setMatches(matches.map((match) =>
      match.id === currentMatch.id
        ? { ...match, problemIndex: pickNextProblemIndex(slicedProblems.length) }
        : match,
    ));
    setAnswerOpen(false);
    setStage('ready');
  }

  async function chooseWinner(teamId: string) {
    if (!currentMatch) return;
    let matchFinished = false;
    const updated = matches.map((match) => {
      if (match.id !== currentMatch.id) return match;
      const teamAScore = match.teamAScore + (match.teamAId === teamId ? 1 : 0);
      const teamBScore = match.teamBScore + (match.teamBId === teamId ? 1 : 0);
      const winnerTeamId = teamAScore >= match.targetWins
        ? match.teamAId
        : teamBScore >= match.targetWins
          ? match.teamBId
          : null;
      matchFinished = winnerTeamId != null;
      return {
        ...match,
        teamAScore,
        teamBScore,
        winnerTeamId,
        problemIndex: winnerTeamId ? match.problemIndex : pickNextProblemIndex(slicedProblems.length),
      };
    });

    setAnswerOpen(false);
    setStage('ready');

    if (!matchFinished) {
      setMatches(updated);
      return;
    }

    const roundDone = updated.filter((match) => match.round === currentRound).every((match) => match.winnerTeamId);
    if (!roundDone) {
      setMatches(updated);
      return;
    }
    const winners = updated.filter((match) => match.round === currentRound).map((match) => match.winnerTeamId).filter((id): id is string => !!id);
    if (winners.length <= 1) {
      setMatches(updated);
      setChampionTeamId(winners[0] ?? null);
      if (classId) {
        clearTeamBattleSession(classId);
        await db.history.add({
          classId,
          tool: 'word-survival-team',
          title: `단어 서바이벌 팀전 ${teams.length}팀`,
          payload: { format: 'word-survival-team/v1', teams, matches: updated, championTeamId: winners[0] ?? null, problemPackId: selectedPackId, matchRule },
          createdAt: Date.now(),
        });
      }
      return;
    }
    const nextRound = currentRound + 1;
    setMatches([...updated, ...createMatches(winners, nextRound, slicedProblems.length, matchRule)]);
    setCurrentRound(nextRound);
    setModalPhase('bracket');
  }

  const teamA = currentMatch?.teamAId ? teamMap.get(currentMatch.teamAId) : null;
  const teamB = currentMatch?.teamBId ? teamMap.get(currentMatch.teamBId) : null;
  const champion = championTeamId ? teamMap.get(championTeamId) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">← 홈으로</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px] flex-1">
            <h1 className="text-2xl font-bold text-slate-900">단어 서바이벌(팀전)</h1>
            <p className="text-sm text-slate-500 mt-1">최근 자리배치의 좌우 짝을 팀으로 묶어 단어 서바이벌을 진행합니다.</p>
          </div>
          <div className="ml-auto w-full max-w-xl lg:w-auto">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <span className="shrink-0 w-16 text-xs font-bold text-slate-500">문제팩</span>
                <select
                  value={selectedPackId}
                  onChange={(e) => { setSelectedPackId(e.target.value); setRangeStart(1); setRangeEnd(null); }}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
                >
                  <option value="idiom">사자성어 기본팩</option>
                  <option value="idiom-initials">사자성어 기본팩(초성)</option>
                  <option value="idiom-meaning-quiz">사자성어 기본팩(사자성어 맞추기)</option>
                  <option value="proverb">속담 기본팩</option>
                  <option value="grade3-vocab">3학년 필수 어휘</option>
                  <option value="grade4-vocab">4학년 필수 어휘</option>
                  <option value="grade5-vocab">5학년 필수 어휘</option>
                  <option value="grade6-vocab">6학년 필수 어휘</option>
                  {savedPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
                </select>
                <Link
                  to="/settings"
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  설정에서 문제팩 관리
                </Link>
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
            <div className="mt-2 self-end rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              사용자 문제팩은 설정 페이지에서 직접 작성해 저장한 뒤 여기서 바로 선택해 사용할 수 있습니다.
            </div>
          </div>
        </div>
      </div>

      {pendingSession && restoredSessionAt && !championTeamId && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <div className="font-semibold">같은 자리배치의 진행 중이던 팀전이 있습니다.</div>
          <div className="mt-1 text-emerald-800">
            {formatDateTime(restoredSessionAt)} 기준으로 저장된 대진을 이어서 진행할지, 새로 시작할지 선택해 주세요.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applySavedSession(pendingSession)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
            >
              이어서 진행
            </button>
            <button
              type="button"
              onClick={discardPendingSession}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
            >
              삭제하기
            </button>
          </div>
        </div>
      )}

      <section className="p-4 bg-white border border-slate-200 rounded-2xl">
        <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr,1fr] items-end">
          <div>
            <label className="block text-sm text-slate-600 mb-2">학급 선택</label>
            <select value={classId ?? ''} onChange={(e) => setClassId(e.target.value ? Number(e.target.value) : null)} className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white focus:outline-none focus:border-slate-500">
              <option value="">선택하세요</option>
              {classes?.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
            </select>
            <div className="mt-2 text-xs text-slate-500">최근 자리배치 기준 · {teams.length}팀 편성</div>
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
            <div className="mt-2 text-xs text-slate-500">한 대진에서 먼저 {matchRule.targetWins}문제를 맞히면 승리</div>
          </div>
          <button onClick={startTeamBattle} disabled={!classId || teams.length < 2} className="px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300">팀전 시작</button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">최근 자리배치 기록이 없습니다. 자리 배치를 먼저 실행해 주세요.</div>
        ) : teams.map((team) => (
          <div key={team.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">{team.label}</div>
            <div className="text-lg font-black text-slate-800 mt-2">{team.members.join(' · ')}</div>
            <div className="text-xs text-slate-500 mt-1">{team.row}행 {team.cols?.join(', ')}열</div>
          </div>
        ))}
      </section>

      {classId && teamHistories && teamHistories.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-800">팀전 결과 기록</h3>
            <span className="text-xs text-slate-500">({teamHistories.length}건)</span>
            <span className="text-xs text-slate-400">· 홈의 "내 컴퓨터에 저장"으로 함께 백업됩니다</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teamHistories.map((entry) => {
              const payload = entry.payload as {
                championTeamId?: string | null;
                teams?: Team[];
                matchRule?: MatchRule;
              };
              const winner = payload.teams?.find((team) => team.id === payload.championTeamId);
              return (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {formatDateTime(entry.createdAt)}
                      </div>
                      <div className="mt-1 font-semibold text-slate-800">{entry.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteTeamHistory(entry)}
                      className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      삭제
                    </button>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    우승: {winner ? `${winner.label} (${winner.members.join(' · ')})` : '기록 없음'}
                  </div>
                  {payload.matchRule && (
                    <div className="mt-1 text-xs text-slate-400">
                      {matchRuleLabel(payload.matchRule)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-slate-950/70" onClick={() => setModalOpen(false)} aria-label="닫기" />
          <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl animate-modalRise">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 p-5 pb-4 md:p-6 md:pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs tracking-[0.35em] text-slate-400">TEAM BATTLE</div>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">{champion ? '팀전 종료' : modalPhase === 'bracket' ? `${roundName(currentParticipantCount)} 대진 확인` : `${roundName(currentParticipantCount)} 진행`}</h2>
                  </div>
                  <button onClick={() => setModalOpen(false)} className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100">닫기</button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-6 md:pb-6">

            {champion ? (
              <div className="min-h-[340px] flex flex-col items-center justify-center text-center">
                <div className="text-[72px]">🏆</div>
                <div className="text-4xl font-black text-slate-900">{champion.label}</div>
                <div className="mt-3 text-xl text-slate-600">{champion.members.join(' · ')}</div>
              </div>
            ) : modalPhase === 'bracket' ? (
              <div className="flex flex-col gap-5">
                <div className="rounded-[2rem] bg-slate-950 text-white p-4 md:p-5">
                  <div className="text-center mb-5">
                    <div className="text-xs tracking-[0.35em] text-amber-200">TEAM BRACKET</div>
                    <div className="text-3xl md:text-4xl font-black mt-2">{roundName(currentParticipantCount)}</div>
                    <div className="text-sm text-slate-300 mt-2">{matchRuleLabel(matchRule)} · 위에서 아래 순서대로 경기가 진행됩니다.</div>
                  </div>
                  <div className="grid gap-3">
                    {currentRoundMatches.map((match) => {
                      const bracketTeamA = match.teamAId ? teamMap.get(match.teamAId) : null;
                      const bracketTeamB = match.teamBId ? teamMap.get(match.teamBId) : null;
                      return (
                        <div key={match.id} className={`grid grid-cols-[1fr,60px,1fr] items-center gap-2 rounded-2xl border px-3 py-2.5 ${match.winnerTeamId ? 'border-emerald-300/40 bg-emerald-300/10' : 'border-white/10 bg-white/8'}`}>
                          <div className="rounded-xl bg-white px-3 py-2.5 text-center text-slate-900">
                            <div className="font-black text-base md:text-lg">{bracketTeamA?.label ?? '대기'}</div>
                            <div className="text-xs text-slate-500 mt-1">{bracketTeamA?.members.join(' · ')}</div>
                            <div className="mt-2 text-sm font-black text-blue-600">{match.teamAScore}승</div>
                          </div>
                          <div className="relative h-14 flex items-center justify-center">
                            <div className="absolute left-0 right-0 top-1/2 h-px bg-amber-200/60" />
                            <div className="absolute left-1/2 top-2 bottom-2 w-px bg-amber-200/60" />
                            <div className="relative z-10 rounded-full bg-amber-300 text-slate-950 px-2 py-1 text-[11px] font-black">
                              {match.autoAdvance ? 'PASS' : `${match.order + 1}`}
                            </div>
                          </div>
                          <div className="rounded-xl bg-white px-3 py-2.5 text-center text-slate-900">
                            <div className="font-black text-base md:text-lg">{bracketTeamB?.label ?? (match.autoAdvance ? '자동 진출' : '대기')}</div>
                            <div className="text-xs text-slate-500 mt-1">{bracketTeamB?.members.join(' · ')}</div>
                            <div className="mt-2 text-sm font-black text-rose-600">{match.teamBScore}승</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setModalPhase('game')} disabled={!currentMatch} className="min-w-[220px] px-6 py-4 rounded-2xl bg-slate-900 text-white font-bold text-lg hover:bg-slate-700 disabled:bg-slate-300">이 대진으로 시작</button>
                  <button onClick={() => setModalOpen(false)} className="px-6 py-4 rounded-2xl border border-slate-300 bg-white hover:bg-slate-100">대진만 보기</button>
                </div>
              </div>
            ) : currentMatch && teamA && teamB ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                  <div className="text-xs font-semibold tracking-[0.25em] text-slate-400">{matchRuleLabel(currentMatch)}</div>
                  <div className="mt-1 text-lg font-black text-slate-800">{teamA.label} {currentMatch.teamAScore} : {currentMatch.teamBScore} {teamB.label}</div>
                  <div className="text-xs text-slate-500">먼저 {currentMatch.targetWins}문제를 맞히는 팀이 다음 라운드로 진출합니다.</div>
                </div>
                <div className="grid md:grid-cols-[1fr,auto,1fr] gap-4 items-center text-center">
                  <TeamCard team={teamA} tone="blue" score={currentMatch.teamAScore} targetWins={currentMatch.targetWins} />
                  <div className="text-4xl font-black text-rose-500">VS</div>
                  <TeamCard team={teamB} tone="rose" score={currentMatch.teamBScore} targetWins={currentMatch.targetWins} />
                </div>
                <div className="rounded-[2rem] bg-slate-900 text-white min-h-[170px] flex items-center justify-center p-5 text-center">
                  {stage === 'ready' && <button onClick={revealProblem} className="rounded-2xl bg-amber-300 px-8 py-4 text-xl font-black text-slate-950 hover:bg-amber-200">문제 공개 시작</button>}
                  {(stage === 'count3' || stage === 'count2' || stage === 'count1') && <div className="text-[112px] md:text-[140px] font-black text-amber-300">{stage === 'count3' ? '3' : stage === 'count2' ? '2' : '1'}</div>}
                  {stage === 'problem' && (
                    <div className="space-y-4 max-w-3xl">
                      <div className="text-xs tracking-[0.4em] text-slate-300">문제</div>
                      <div className="text-3xl md:text-4xl font-black text-amber-200 break-keep">{activeProblem?.phrase ?? '설정에서 저장한 문제팩을 선택해 주세요'}</div>
                      {activeProblem?.hint && <div className="text-sm text-slate-300">힌트: {activeProblem.hint}</div>}
                      <button onClick={() => setAnswerOpen((value) => !value)} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/20 hover:bg-white/20">{answerOpen ? '정답 확인 완료' : '정답 확인'}</button>
                      {answerOpen && <div className="rounded-2xl bg-white text-slate-900 px-5 py-4 text-lg font-semibold whitespace-pre-line">정답: {activeProblem?.meaning ?? '등록된 정답이 없습니다.'}</div>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-4">
                  <button onClick={() => chooseWinner(teamA.id)} disabled={stage !== 'problem' || !answerOpen} className="min-w-[220px] px-6 py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg hover:bg-blue-500 disabled:bg-slate-300">{teamA.label} 정답</button>
                  <button onClick={skipToNextProblem} disabled={stage !== 'problem' || !answerOpen} className="min-w-[220px] px-6 py-4 rounded-2xl bg-amber-500 text-slate-950 font-bold text-lg hover:bg-amber-400 disabled:bg-slate-300">둘 다 오답 · 다음 문제</button>
                  <button onClick={() => chooseWinner(teamB.id)} disabled={stage !== 'problem' || !answerOpen} className="min-w-[220px] px-6 py-4 rounded-2xl bg-rose-600 text-white font-bold text-lg hover:bg-rose-500 disabled:bg-slate-300">{teamB.label} 정답</button>
                </div>
              </div>
            ) : (
              <div className="min-h-[340px] flex items-center justify-center text-slate-500">다음 경기를 준비 중입니다.</div>
            )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, tone, score, targetWins }: { team: Team; tone: 'blue' | 'rose'; score: number; targetWins: number }) {
  const color = tone === 'blue' ? 'border-blue-200 bg-blue-50' : 'border-rose-200 bg-rose-50';
  const scoreColor = tone === 'blue' ? 'bg-blue-600' : 'bg-rose-600';
  return (
    <div className={`rounded-[1.75rem] border px-4 py-6 ${color}`}>
      <div className="text-sm font-semibold text-slate-500">{team.label}</div>
      <div className="mt-3 text-3xl md:text-4xl font-black text-slate-900 break-keep">{team.members.join(' · ')}</div>
      <div className="mt-3 flex justify-center gap-2" aria-label={`${team.label} 점수 ${score}점`}>
        {Array.from({ length: targetWins }, (_, index) => (
          <span key={index} className={`h-3 w-10 rounded-full ${index < score ? scoreColor : 'bg-white border border-slate-300'}`} />
        ))}
      </div>
    </div>
  );
}
