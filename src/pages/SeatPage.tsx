import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import StudentSource, {
  parseQuickNames,
  type SourceMode,
} from '../components/StudentSource';
import {
  db,
  defaultSeatSettings,
  type ClassRoom,
  type Gender,
  type HistoryEntry,
  type SeatSettings,
  type Student,
} from '../db';
import { shuffle } from '../lib/shuffle';
import { type SeatResultSeat } from '../lib/backup';
import { sfx } from '../lib/sfx';

type Phase = 'idle' | 'running' | 'done';

type RosterStudent = {
  key: string;
  dbId?: number;
  name: string;
  gender?: Gender;
};

type Assignment = Map<string, RosterStudent>;

type BallPos = { x: number; y: number; scale: number };

const cellKey = (r: number, c: number) => `${r},${c}`;

const ballColors = [
  'from-amber-400 to-amber-600',
  'from-rose-400 to-rose-600',
  'from-sky-400 to-sky-600',
  'from-emerald-400 to-emerald-600',
  'from-violet-400 to-violet-600',
  'from-fuchsia-400 to-fuchsia-600',
];

function rectLayout(rows: number, cols: number): Set<string> {
  const set = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      set.add(cellKey(r, c));
    }
  }
  return set;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function suggestGrid(total: number): { rows: number; cols: number } {
  if (total <= 0) return { rows: 4, cols: 6 };
  const cols = Math.max(2, Math.ceil(Math.sqrt(total) * 1.4));
  const rows = Math.max(1, Math.ceil(total / cols));
  return { rows, cols };
}

function normalizeSeatLayout(
  layout: SeatSettings['seatLayout'],
): { rows: number; cols: number; activeSeats: Set<string> } | null {
  if (!layout) return null;
  const rows = Math.max(0, Math.min(30, Math.floor(Number(layout.rows) || 0)));
  const cols = Math.max(0, Math.min(30, Math.floor(Number(layout.cols) || 0)));
  const activeSeats = new Set(
    (Array.isArray(layout.activeSeats) ? layout.activeSeats : []).filter((key) => {
      if (typeof key !== 'string') return false;
      const [row, col] = key.split(',').map(Number);
      return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0;
    }),
  );
  if (rows === 0 && cols === 0 && activeSeats.size === 0) return null;
  return { rows, cols, activeSeats };
}

function buildAdjacency(seats: Set<string>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  seats.forEach((k) => {
    const [r, c] = k.split(',').map(Number);
    const neighbors: string[] = [];
    const left = cellKey(r, c - 1);
    const right = cellKey(r, c + 1);
    if (seats.has(left)) neighbors.push(left);
    if (seats.has(right)) neighbors.push(right);
    adj.set(k, neighbors);
  });
  return adj;
}

function buildSeatStudentKeys(seats: Array<[string, number]>): Set<string> {
  const keys = new Set<string>();
  for (const [seatKey, studentId] of seats) {
    keys.add(`${seatKey}:${studentId}`);
  }
  return keys;
}

function buildNeighborPairKeys(seats: Array<[string, number]>): Set<string> {
  const seatSet = new Set(seats.map(([seatKey]) => seatKey));
  const studentBySeat = new Map(seats);
  const adjacency = buildAdjacency(seatSet);
  const pairs = new Set<string>();

  adjacency.forEach((neighbors, seatKey) => {
    const studentId = studentBySeat.get(seatKey);
    if (studentId == null) return;

    for (const neighborKey of neighbors) {
      if (seatKey >= neighborKey) continue;
      const neighborId = studentBySeat.get(neighborKey);
      if (neighborId == null) continue;
      pairs.add([studentId, neighborId].sort((a, b) => a - b).join('|'));
    }
  });

  return pairs;
}

type HistoryDuplicateRules = {
  seatStudentKeys: Set<string>;
  neighborPairKeys: Set<string>;
};

function placeOnce(
  roster: RosterStudent[],
  seatKeys: string[],
  settings: SeatSettings,
  dbIdToStudent: Map<number, RosterStudent>,
): Assignment {
  const assignment: Assignment = new Map();
  const placedKeys = new Set<string>();
  const seatSet = new Set(seatKeys);

  for (const fx of settings.fixedSeats) {
    const k = cellKey(fx.row - 1, fx.col - 1);
    if (!seatSet.has(k)) continue;
    if (assignment.has(k)) continue;
    const student = dbIdToStudent.get(fx.studentId);
    if (!student) continue;
    assignment.set(k, student);
    placedKeys.add(student.key);
  }

  const remainingStudents = roster.filter((s) => !placedKeys.has(s.key));
  const remainingSeats = seatKeys.filter((k) => !assignment.has(k));

  const shuffled = shuffle(remainingStudents);
  const limit = Math.min(shuffled.length, remainingSeats.length);
  for (let i = 0; i < limit; i++) {
    assignment.set(remainingSeats[i], shuffled[i]);
  }
  return assignment;
}

function countViolations(
  assignment: Assignment,
  settings: SeatSettings,
  adj: Map<string, string[]>,
  dbIdToStudent: Map<number, RosterStudent>,
  historyRules: HistoryDuplicateRules[],
): number {
  let v = 0;

  const forbidden = new Set<string>();
  for (const [a, b] of settings.forbiddenPairs) {
    const sa = dbIdToStudent.get(a);
    const sb = dbIdToStudent.get(b);
    if (sa && sb) forbidden.add([sa.key, sb.key].sort().join('|'));
  }

  assignment.forEach((student, key) => {
    const neighbors = adj.get(key) ?? [];
    for (const nk of neighbors) {
      if (key >= nk) continue;
      const n = assignment.get(nk);
      if (!n) continue;
      const pk = [student.key, n.key].sort().join('|');
      if (forbidden.has(pk)) v++;
      if (
        settings.genderBalance === 'strict' &&
        student.gender && n.gender &&
        student.gender === n.gender
      ) {
        v++;
      }
    }
  });

  if (settings.avoidDuplicates && historyRules.length > 0) {
    const currentSeats = new Set<string>();
    const currentPairs = new Set<string>();
    assignment.forEach((s, k) => {
      if (s.dbId != null) currentSeats.add(`${k}:${s.dbId}`);
    });
    assignment.forEach((student, key) => {
      if (student.dbId == null) return;
      const neighbors = adj.get(key) ?? [];
      for (const nk of neighbors) {
        if (key >= nk) continue;
        const neighbor = assignment.get(nk);
        if (neighbor?.dbId == null) continue;
        currentPairs.add(
          [student.dbId, neighbor.dbId].sort((a, b) => a - b).join('|'),
        );
      }
    });

    for (const history of historyRules) {
      currentSeats.forEach((seatKey) => {
        if (history.seatStudentKeys.has(seatKey)) v++;
      });
      currentPairs.forEach((pairKey) => {
        if (history.neighborPairKeys.has(pairKey)) v++;
      });
    }
  }

  return v;
}

function solve(
  roster: RosterStudent[],
  seats: Set<string>,
  settings: SeatSettings,
  historyRules: HistoryDuplicateRules[],
  maxTries = 300,
): { assignment: Assignment; violations: number } {
  const seatKeys = Array.from(seats);
  const adj = buildAdjacency(seats);
  const dbIdToStudent = new Map<number, RosterStudent>();
  roster.forEach((s) => {
    if (s.dbId != null) dbIdToStudent.set(s.dbId, s);
  });

  let best = placeOnce(roster, seatKeys, settings, dbIdToStudent);
  let bestV = countViolations(best, settings, adj, dbIdToStudent, historyRules);
  if (bestV === 0) return { assignment: best, violations: 0 };

  for (let i = 1; i < maxTries; i++) {
    const attempt = placeOnce(roster, seatKeys, settings, dbIdToStudent);
    const v = countViolations(attempt, settings, adj, dbIdToStudent, historyRules);
    if (v < bestV) {
      bestV = v;
      best = attempt;
      if (v === 0) break;
    }
  }
  return { assignment: best, violations: bestV };
}

export default function SeatPage() {
  const [mode, setMode] = useState<SourceMode>('class');
  const [classId, setClassId] = useState<number | null>(null);
  const [quickText, setQuickText] = useState('');
  const [rowsInput, setRowsInput] = useState(0);
  const [colsInput, setColsInput] = useState(0);
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');

  const [activeSeats, setActiveSeats] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('idle');
  const [filled, setFilled] = useState<
    Map<string, { name: string; gender?: Gender; number?: number }>
  >(new Map());
  const [animatedSeats, setAnimatedSeats] = useState<Set<string>>(new Set());
  const [rollingName, setRollingName] = useState<string | null>(null);
  const [highlightSeat, setHighlightSeat] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [ballPos, setBallPos] = useState<BallPos>({ x: 0, y: 0, scale: 1 });
  const [ballTransition, setBallTransition] = useState<number | null>(null);
  const [ballOpacity, setBallOpacity] = useState(0);
  const [ballColorIndex, setBallColorIndex] = useState(0);
  const [ejectKey, setEjectKey] = useState(0);
  const [ejectMs, setEjectMs] = useState(360);

  const [sfxSettings, setSfxSettings] = useState(() => sfx.getSettings());
  useEffect(() => sfx.subscribe(setSfxSettings), []);

  const paintStateRef = useRef<'add' | 'remove' | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const ballHomeRef = useRef<HTMLDivElement>(null);
  const loadedLayoutClassRef = useRef<number | null>(null);
  const skipNextLayoutSaveRef = useRef(false);
  const lastLayoutSignatureRef = useRef('');

  const allClasses = useLiveQuery(() => db.classes.toArray(), []);

  useEffect(() => {
    if (
      mode === 'class' &&
      classId === null &&
      allClasses &&
      allClasses.length === 1 &&
      allClasses[0].id != null
    ) {
      setClassId(allClasses[0].id);
    }
  }, [mode, classId, allClasses]);

  const classStudents = useLiveQuery<Student[]>(
    () =>
      mode === 'class' && classId
        ? db.students.where('classId').equals(classId).sortBy('number')
        : Promise.resolve([] as Student[]),
    [mode, classId],
  );

  const classInfo = useLiveQuery<ClassRoom | undefined>(
    () =>
      mode === 'class' && classId
        ? db.classes.get(classId)
        : Promise.resolve(undefined as ClassRoom | undefined),
    [mode, classId],
  );
  const seatSettings = classInfo?.seatSettings ?? defaultSeatSettings;

  const seatHistory = useLiveQuery<HistoryEntry[]>(
    () =>
      mode === 'class' && classId
        ? db.history
            .where('classId')
            .equals(classId)
            .toArray()
            .then((arr) =>
              arr
                .filter((h) => h.tool === 'seat')
                .sort((a, b) => b.createdAt - a.createdAt),
            )
        : Promise.resolve([] as HistoryEntry[]),
    [mode, classId],
  );

  const roster = useMemo<RosterStudent[]>(() => {
    if (mode === 'class') {
      return (classStudents ?? []).map((s) => ({
        key: `db-${s.id}`,
        dbId: s.id,
        name: s.name,
        gender: s.gender,
      }));
    }
    return parseQuickNames(quickText).map((name, i) => ({
      key: `q-${i}`,
      name,
    }));
  }, [mode, classStudents, quickText]);

  const names = useMemo(() => roster.map((r) => r.name), [roster]);

  const seatCount = activeSeats.size;

  const storedSeatLayout = useMemo(
    () => normalizeSeatLayout(seatSettings.seatLayout),
    [seatSettings.seatLayout],
  );

  const canvas = useMemo(() => {
    let maxR = 0;
    let maxC = 0;
    activeSeats.forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    });
    return {
      rows: Math.max(maxR + 1, rowsInput, 1),
      cols: Math.max(maxC + 1, colsInput, 1),
    };
  }, [activeSeats, rowsInput, colsInput]);

  const canStart = phase === 'idle' && names.length > 0 && seatCount >= names.length;

  useEffect(() => {
    loadedLayoutClassRef.current = null;
    lastLayoutSignatureRef.current = '';
  }, [mode, classId]);

  useEffect(() => {
    if (mode !== 'class' || !classId || !classInfo) return;
    if (loadedLayoutClassRef.current === classId) return;

    skipNextLayoutSaveRef.current = true;
    loadedLayoutClassRef.current = classId;

    if (storedSeatLayout) {
      setRowsInput(storedSeatLayout.rows);
      setColsInput(storedSeatLayout.cols);
      setActiveSeats(storedSeatLayout.activeSeats);
      lastLayoutSignatureRef.current = JSON.stringify({
        rows: storedSeatLayout.rows,
        cols: storedSeatLayout.cols,
        activeSeats: Array.from(storedSeatLayout.activeSeats).sort(),
      });
    } else {
      setRowsInput(0);
      setColsInput(0);
      setActiveSeats(new Set());
      lastLayoutSignatureRef.current = '';
    }
    reset();
  }, [mode, classId, classInfo, storedSeatLayout]);

  useEffect(() => {
    if (mode !== 'class' || !classId || loadedLayoutClassRef.current !== classId) return;
    if (skipNextLayoutSaveRef.current) {
      skipNextLayoutSaveRef.current = false;
      return;
    }

    const activeSeatList = Array.from(activeSeats).sort((a, b) => {
      const [ar, ac] = a.split(',').map(Number);
      const [br, bc] = b.split(',').map(Number);
      return ar - br || ac - bc;
    });
    const signature = JSON.stringify({ rows: rowsInput, cols: colsInput, activeSeats: activeSeatList });
    if (lastLayoutSignatureRef.current === signature) return;
    lastLayoutSignatureRef.current = signature;

    void db.classes.update(classId, {
      seatSettings: {
        ...defaultSeatSettings,
        ...seatSettings,
        seatLayout: { rows: rowsInput, cols: colsInput, activeSeats: activeSeatList },
      },
    });
  }, [mode, classId, rowsInput, colsInput, activeSeats, seatSettings]);

  useEffect(() => {
    if (mode === 'class' && classId && loadedLayoutClassRef.current !== classId) return;
    if (mode === 'class' && classId && storedSeatLayout) return;
    if (names.length > 0 && seatCount === 0 && rowsInput === 0 && colsInput === 0) {
      const { rows, cols } = suggestGrid(names.length);
      setRowsInput(rows);
      setColsInput(cols);
      setActiveSeats(rectLayout(rows, cols));
    }
  }, [mode, classId, storedSeatLayout, names.length, seatCount, rowsInput, colsInput]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endPaint);
    window.addEventListener('pointerup', endPaint);
    return () => {
      window.removeEventListener('mouseup', endPaint);
      window.removeEventListener('pointerup', endPaint);
    };
  }, []);

  function applyPaint(r: number, c: number) {
    const k = cellKey(r, c);
    setActiveSeats((prev) => {
      if (paintStateRef.current === 'add' && prev.has(k)) return prev;
      if (paintStateRef.current === 'remove' && !prev.has(k)) return prev;
      const next = new Set(prev);
      if (paintStateRef.current === 'add') next.add(k);
      else if (paintStateRef.current === 'remove') next.delete(k);
      return next;
    });
  }

  function onCellPointerDown(e: React.PointerEvent, r: number, c: number) {
    if (phase !== 'idle') return;
    e.preventDefault();
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const k = cellKey(r, c);
    paintStateRef.current = activeSeats.has(k) ? 'remove' : 'add';
    applyPaint(r, c);
  }

  function onCellPointerEnter(r: number, c: number) {
    if (phase !== 'idle') return;
    if (paintStateRef.current === null) return;
    applyPaint(r, c);
  }

  function endPaint() {
    paintStateRef.current = null;
  }

  function applyGrid(rows: number, cols: number) {
    const safeR = Math.max(0, Math.min(30, Math.floor(rows)));
    const safeC = Math.max(0, Math.min(30, Math.floor(cols)));
    setRowsInput(safeR);
    setColsInput(safeC);
    setActiveSeats(rectLayout(safeR, safeC));
  }

  function clearAll() {
    setActiveSeats(new Set());
    setRowsInput(0);
    setColsInput(0);
  }

  function reset() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setPhase('idle');
    setFilled(new Map());
    setAnimatedSeats(new Set());
    setRollingName(null);
    setHighlightSeat(null);
    setProgress({ current: 0, total: 0 });
    setBallOpacity(0);
    setBallTransition(null);
  }

  function computeHomePos(): { x: number; y: number } | null {
    const el = ballHomeRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function computeSeatPos(k: string): { x: number; y: number } | null {
    const el = canvasRef.current?.querySelector<HTMLElement>(
      `[data-seat="${k}"]`,
    );
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function start() {
    const settingsToUse = mode === 'class' ? seatSettings : defaultSeatSettings;
    const historyRules: HistoryDuplicateRules[] =
      mode === 'class' && settingsToUse.avoidDuplicates
        ? (seatHistory ?? [])
            .slice(0, 5)
            .map((h) => {
              const p = h.payload as { seats?: unknown };
              const raw = Array.isArray(p?.seats) ? p.seats : [];
              const seats = raw.filter(
                (x): x is [string, number] =>
                  Array.isArray(x) &&
                  typeof x[0] === 'string' &&
                  typeof x[1] === 'number',
              );
              return {
                seatStudentKeys: buildSeatStudentKeys(seats),
                neighborPairKeys: buildNeighborPairKeys(seats),
              };
            })
            .filter(
              (history) =>
                history.seatStudentKeys.size > 0 || history.neighborPairKeys.size > 0,
            )
        : [];

    const { assignment, violations } = solve(
      roster,
      activeSeats,
      settingsToUse,
      historyRules,
    );
    if (assignment.size === 0) return;

    if (violations > 0 && typeof console !== 'undefined') {
      console.warn(
        `[자리 배치] 조건을 완벽히 만족하지 못했습니다 (위반 ${violations}건). 최선 조합으로 진행합니다.`,
      );
    }

    const seatKeys = Array.from(activeSeats).sort((a, b) => {
      const [ar, ac] = a.split(',').map(Number);
      const [br, bc] = b.split(',').map(Number);
      return ar - br || ac - bc;
    });
    const target = new Map<
      string,
      { name: string; gender?: Gender; number?: number }
    >();
    const ts = Date.now();
    const snapshot: SeatResultSeat[] = [];
    assignment.forEach((s, k) => {
      const [r, c] = k.split(',').map(Number);
      const dbStudent =
        s.dbId != null ? classStudents?.find((cs) => cs.id === s.dbId) : undefined;
      target.set(k, { name: s.name, gender: s.gender, number: dbStudent?.number });
      snapshot.push({
        row: r + 1,
        col: c + 1,
        name: s.name,
        gender: s.gender,
        number: dbStudent?.number,
      });
    });
    snapshot.sort((a, b) => a.row - b.row || a.col - b.col);

    const placements = seatKeys
      .filter((k) => target.has(k))
      .map((k) => ({ key: k, name: target.get(k)!.name }));
    const order = shuffle(placements);

    setPhase('running');
    setFilled(target);
    setAnimatedSeats(new Set());
    setRollingName(null);
    setHighlightSeat(null);
    setProgress({ current: 0, total: order.length });
    setBallOpacity(0);
    setBallTransition(null);

    const tick = speed === 'slow' ? 75 : speed === 'fast' ? 26 : 45;
    const spinSteps = speed === 'slow' ? 12 : speed === 'fast' ? 6 : 9;
    const pauseAfterPick = speed === 'slow' ? 600 : speed === 'fast' ? 320 : 460;
    const flyDuration = speed === 'slow' ? 560 : speed === 'fast' ? 260 : 400;
    const gapBetween = speed === 'slow' ? 220 : speed === 'fast' ? 70 : 130;
    const ejectDurationMs =
      speed === 'slow' ? 480 : speed === 'fast' ? 240 : 360;

    const queue = timersRef.current;
    function schedule(fn: () => void, delay: number) {
      const t = setTimeout(fn, delay);
      queue.push(t);
    }

    sfx.resume();

    function processNext(i: number) {
      if (i >= order.length) {
        schedule(() => {
          setPhase('done');
          setRollingName(null);
          setHighlightSeat(null);
          setBallOpacity(0);
          setBallTransition(null);
          sfx.fanfare();
        }, 320);
        return;
      }
      const pick = order[i];
      let cursor = 0;

      schedule(() => {
        const home = computeHomePos();
        setBallTransition(null);
        if (home) setBallPos({ x: home.x, y: home.y, scale: 1 });
        setBallOpacity(0);
        setBallColorIndex(i % ballColors.length);
        setProgress({ current: i + 1, total: order.length });
        setHighlightSeat(null);
      }, cursor);

      cursor += 30;

      for (let s = 0; s < spinSteps; s++) {
        cursor += tick;
        schedule(() => {
          setRollingName(names[Math.floor(Math.random() * names.length)]);
          sfx.tick();
        }, cursor);
      }

      cursor += tick;
      schedule(() => {
        setRollingName(pick.name);
        const home = computeHomePos();
        if (home) setBallPos({ x: home.x, y: home.y, scale: 1 });
        setBallTransition(null);
        setEjectMs(ejectDurationMs);
        setEjectKey((k) => k + 1);
        setBallOpacity(1);
        sfx.ding();
      }, cursor);

      cursor += pauseAfterPick;
      schedule(() => {
        const seatPos = computeSeatPos(pick.key);
        setBallTransition(flyDuration);
        if (seatPos) {
          setBallPos({ x: seatPos.x, y: seatPos.y, scale: 0.35 });
        }
        sfx.whoosh(flyDuration);
      }, cursor);

      cursor += Math.max(0, flyDuration - 100);
      schedule(() => {
        setHighlightSeat(pick.key);
        setAnimatedSeats((prev) => {
          const next = new Set(prev);
          next.add(pick.key);
          return next;
        });
        setBallOpacity(0);
        sfx.pop();
      }, cursor);

      cursor += 100 + gapBetween;
      schedule(() => processNext(i + 1), cursor);
    }

    processNext(0);

    if (mode === 'class' && classId) {
      const seatsPayload: Array<[string, number]> = [];
      assignment.forEach((s, k) => {
        if (s.dbId != null) seatsPayload.push([k, s.dbId]);
      });
      db.history.add({
        classId,
        tool: 'seat',
        title: `자리 배치 ${seatCount}석`,
        payload: {
          seats: seatsPayload,
          snapshot,
          layout: canvas,
          violations,
        },
        createdAt: ts,
      });
    }
  }

  async function deleteHistoryEntry(e: React.MouseEvent, hid: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('이 자리배치 기록을 삭제할까요?')) return;
    await db.history.delete(hid);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-4">자리 배치</h1>

      <div className="mb-4">
        <StudentSource
          mode={mode}
          onModeChange={(m) => {
            reset();
            setMode(m);
          }}
          classId={classId}
          onClassChange={(c) => {
            reset();
            setClassId(c);
          }}
          quickText={quickText}
          onQuickTextChange={(v) => {
            reset();
            setQuickText(v);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 p-4 bg-white border border-slate-200 rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">세로(행)</label>
          <input
            type="number"
            min={0}
            max={30}
            value={rowsInput}
            onChange={(e) => {
              reset();
              applyGrid(Number(e.target.value), colsInput);
            }}
            className="w-16 px-2 py-1.5 border border-slate-300 rounded-md"
          />
          <span className="text-slate-400">×</span>
          <label className="text-sm text-slate-600">가로(열)</label>
          <input
            type="number"
            min={0}
            max={30}
            value={colsInput}
            onChange={(e) => {
              reset();
              applyGrid(rowsInput, Number(e.target.value));
            }}
            className="w-16 px-2 py-1.5 border border-slate-300 rounded-md"
          />
          <span className="text-xs text-slate-500">
            = {rowsInput * colsInput}석
          </span>
          <button
            onClick={() => {
              reset();
              const { rows, cols } = suggestGrid(names.length);
              applyGrid(rows, cols);
            }}
            disabled={phase !== 'idle' || names.length === 0}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50"
            title="학생 수에 맞게 자동"
          >
            자동({names.length})
          </button>
          <button
            onClick={() => {
              reset();
              clearAll();
            }}
            disabled={phase !== 'idle'}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50"
          >
            초기화
          </button>
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
          <label className="text-sm text-slate-600">속도</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(e.target.value as typeof speed)}
            disabled={phase === 'running'}
            className="px-2 py-1.5 border border-slate-300 rounded-md bg-white text-sm"
          >
            <option value="slow">느리게</option>
            <option value="normal">보통</option>
            <option value="fast">빠르게</option>
          </select>
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
          <button
            type="button"
            onClick={() => {
              sfx.setMuted(!sfxSettings.muted);
              if (sfxSettings.muted) sfx.resume();
            }}
            className="px-2 py-1.5 border border-slate-300 rounded-md bg-white text-base hover:bg-slate-100"
            title={sfxSettings.muted ? '소리 켜기' : '소리 끄기'}
            aria-label={sfxSettings.muted ? '소리 켜기' : '소리 끄기'}
          >
            {sfxSettings.muted ? '🔇' : sfxSettings.volume < 0.34 ? '🔈' : sfxSettings.volume < 0.67 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sfxSettings.volume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              sfx.setVolume(v);
              if (v > 0 && sfxSettings.muted) sfx.setMuted(false);
            }}
            disabled={sfxSettings.muted}
            aria-label="음량"
            className="w-20 accent-slate-700 disabled:opacity-40"
          />
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3 ml-auto">
          {phase === 'idle' && (
            <button
              onClick={start}
              disabled={!canStart}
              className="px-5 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:bg-slate-300"
            >
              자리배치 시작
            </button>
          )}
          {phase === 'running' && (
            <button
              onClick={reset}
              className="px-4 py-2 border border-slate-300 rounded-md hover:bg-slate-100"
            >
              중단
            </button>
          )}
          {phase === 'done' && (
            <button
              onClick={reset}
              className="px-4 py-2 border border-slate-300 rounded-md hover:bg-slate-100"
            >
              다시
            </button>
          )}
        </div>
      </div>

<div className="mb-3 text-sm text-slate-600">
        {phase === 'idle' ? (
          <>
            칸을 클릭하거나 드래그해서 자리 배열을 자유롭게 수정할 수 있습니다. <br />
            자리 <span className="font-semibold">{seatCount}개</span> · 학생{' '}
            <span className="font-semibold">{names.length}명</span>
            {names.length > 0 && seatCount < names.length && (
              <span className="ml-2 text-red-600">자리가 부족합니다.</span>
            )}
          </>
        ) : (
          <>
            학생 {names.length}명 · 자리 {seatCount}개
          </>
        )}
      </div>

      {phase === 'running' && (
        <div className="mb-4 p-6 bg-gradient-to-b from-amber-50 via-amber-100/40 to-white border-2 border-amber-300 rounded-lg text-center relative overflow-hidden">
          <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-amber-200/50 blur-3xl" />
          <div
            className="pointer-events-none absolute top-3 left-6 text-xl text-amber-400 animate-sparkleSpin"
            aria-hidden
          >
            ✦
          </div>
          <div
            className="pointer-events-none absolute top-5 right-8 text-2xl text-amber-500 animate-sparkleSpin"
            style={{ animationDelay: '0.9s' }}
            aria-hidden
          >
            ✧
          </div>
          <div
            className="pointer-events-none absolute bottom-6 left-10 text-lg text-amber-400 animate-sparkleSpin"
            style={{ animationDelay: '1.6s' }}
            aria-hidden
          >
            ✦
          </div>
          <div className="relative">
            <div className="text-xs font-semibold tracking-[0.2em] text-amber-700 mb-3">
              🎱 추첨 중 · {progress.current}/{progress.total}
            </div>

            <div className="relative mx-auto w-48 h-48 flex items-center justify-center animate-drumShake">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/80 via-amber-50/60 to-amber-100/50 border-[6px] border-white shadow-[inset_0_10px_24px_rgba(120,53,15,0.12),0_14px_30px_rgba(251,191,36,0.35)]">
                <div className="absolute top-4 left-8 w-14 h-7 rounded-full bg-white/70 blur-[2px]" />
                <div className="absolute bottom-6 right-10 w-8 h-3 rounded-full bg-white/40 blur-[1px]" />
              </div>

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={`oa-${i}`}
                    className={`absolute w-6 h-6 rounded-full bg-gradient-to-br ${ballColors[i % ballColors.length]} shadow-md border-2 border-white/70 animate-drumOrbitA`}
                    style={{ animationDelay: `-${i * 0.4}s` }}
                  />
                ))}
                {[0, 1, 2].map((i) => (
                  <div
                    key={`ob-${i}`}
                    className={`absolute w-4 h-4 rounded-full bg-gradient-to-br ${ballColors[(i + 2) % ballColors.length]} shadow-md border-2 border-white/70 animate-drumOrbitB`}
                    style={{ animationDelay: `-${i * 0.46}s` }}
                  />
                ))}
              </div>

              <div
                className="relative z-10 px-3 py-1.5 bg-white/75 backdrop-blur-sm rounded-md text-sm font-bold text-slate-800 shadow-sm transition-opacity duration-150"
                style={{ opacity: ballOpacity > 0 ? 0.25 : 1 }}
              >
                {rollingName ?? '···'}
              </div>
            </div>

            <div className="relative mx-auto flex flex-col items-center">
              <div className="w-10 h-4 -mt-1 bg-gradient-to-b from-slate-400 to-slate-500 rounded-b-lg shadow-inner z-10" />
              <div
                ref={ballHomeRef}
                className="w-24 h-14 mt-1"
                aria-hidden
              />
            </div>

            <div className="mt-2 h-1.5 w-full max-w-md mx-auto bg-amber-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 transition-all duration-200"
                style={{
                  width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: `${ballPos.x}px`,
            top: `${ballPos.y}px`,
            transition:
              ballTransition !== null
                ? `left ${ballTransition}ms cubic-bezier(0.4, 0, 0.2, 1), top ${ballTransition}ms cubic-bezier(0.4, 0, 0.2, 1), opacity 280ms ease-out`
                : 'opacity 220ms ease-out',
            opacity: ballOpacity,
            pointerEvents: 'none',
            zIndex: 50,
            willChange: 'left, top, opacity',
          }}
        >
          <div
            style={{
              transform: `scale(${ballPos.scale}) translate(-50%, -50%)`,
              transition:
                ballTransition !== null
                  ? `transform ${ballTransition}ms cubic-bezier(0.4, 0, 0.2, 1)`
                  : 'none',
            }}
          >
            <div
              key={ejectKey}
              className={
                ballTransition === null && ballOpacity > 0
                  ? 'animate-ballEject'
                  : ''
              }
              style={
                {
                  '--eject-duration': `${ejectMs}ms`,
                } as React.CSSProperties
              }
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-white/50 blur-xl -z-10 scale-150" />
                <div
                  className={`relative px-7 py-4 bg-gradient-to-br ${ballColors[ballColorIndex]} text-white text-2xl font-extrabold rounded-full shadow-[0_12px_30px_rgba(0,0,0,0.35)] border-[5px] border-white whitespace-nowrap`}
                >
                  <span className="pointer-events-none absolute top-1 left-3 right-3 h-2 rounded-full bg-white/60 blur-[2px]" />
                  {rollingName ?? '···'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        ref={canvasRef}
        className="p-4 bg-white border border-slate-200 rounded-lg overflow-x-auto select-none touch-none"
      >
        <div className="mx-auto mb-4 text-center">
          <div className="inline-block px-16 py-2 bg-slate-800 text-white text-xs tracking-[0.3em] rounded">
            칠판
          </div>
        </div>
        <div
          className="grid gap-2 mx-auto"
          style={{ gridTemplateColumns: `repeat(${canvas.cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: canvas.rows }, (_, r) =>
            Array.from({ length: canvas.cols }, (_, c) => {
              const k = cellKey(r, c);
              const isActive = activeSeats.has(k);
              const entry = filled.get(k);
              const isVisible = animatedSeats.has(k);
              const isHighlight = highlightSeat === k;
              const showStudent = phase !== 'idle' && isActive && entry && isVisible;

              const base =
                'aspect-[3/2] flex flex-col items-center justify-center rounded-md text-center text-sm font-medium transition';
              let stateClass: string;
              if (phase === 'idle') {
                stateClass = isActive
                  ? 'bg-slate-50 border border-slate-400 text-slate-500 hover:bg-slate-100 cursor-pointer'
                  : 'bg-transparent border border-dashed border-slate-200 text-slate-300 hover:border-slate-400 hover:bg-slate-50 cursor-pointer';
              } else if (!isActive) {
                stateClass =
                  'bg-transparent border border-dashed border-slate-100 text-slate-200';
              } else if (showStudent) {
                stateClass =
                  entry!.gender === 'M'
                    ? 'border border-blue-200 bg-blue-50/60 text-slate-800'
                    : entry!.gender === 'F'
                      ? 'border border-rose-200 bg-rose-50/60 text-slate-800'
                      : 'border border-slate-300 bg-slate-50 text-slate-800';
              } else {
                stateClass = 'bg-slate-50 border border-slate-300 text-slate-800';
              }

              return (
                <div
                  key={k}
                  data-seat={k}
                  onPointerDown={(e) => onCellPointerDown(e, r, c)}
                  onPointerEnter={() => onCellPointerEnter(r, c)}
                  className={`${base} ${stateClass} ${isHighlight ? 'animate-highlight' : ''}`}
                >
                  {phase === 'idle' ? (
                    isActive ? (
                      <span className="text-slate-400">자리</span>
                    ) : (
                      ''
                    )
                  ) : showStudent ? (
                    <span className="animate-seatBurst inline-flex flex-col items-center leading-tight">
                      {entry!.number != null && (
                        <span className="text-[10px] text-slate-400 tabular-nums">
                          {entry!.number}
                        </span>
                      )}
                      <span className="font-medium">{entry!.name}</span>
                    </span>
                  ) : (
                    ''
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {mode === 'class' &&
        classId &&
        phase === 'idle' &&
        seatHistory &&
        seatHistory.length > 0 && (
          <section className="mt-8">
            <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <span>📅</span>
              <span>이전 자리배치 기록</span>
              <span className="text-xs font-normal text-slate-500">
                ({seatHistory.length}건)
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {seatHistory.map((h) => (
                <div key={h.id} className="relative group">
                  <Link
                    to={`/classes/${classId}/seat-history/${h.id}`}
                    className="block p-3 bg-white border border-slate-200 rounded-md hover:border-slate-900 hover:shadow-sm transition"
                  >
                    <div className="text-xs text-slate-500 tabular-nums mb-0.5">
                      {formatDateTime(h.createdAt)}
                    </div>
                    <div className="text-sm font-medium text-slate-800 pr-6 truncate">
                      {h.title}
                    </div>
                  </Link>
                  <button
                    onClick={(e) => deleteHistoryEntry(e, h.id!)}
                    title="기록 삭제"
                    aria-label="삭제"
                    className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
    </div>
  );
}
