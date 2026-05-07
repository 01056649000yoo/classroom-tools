import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  defaultRoleSettings,
  type ClassRoom,
  type HistoryEntry,
  type RoleSettings,
  type Student,
} from '../db';
import { shuffle } from '../lib/shuffle';
import { sfx } from '../lib/sfx';

type Phase = 'idle' | 'running' | 'done';

type RoleGroup = {
  id: string;
  name: string;
  count: number;
};

type RoleSlot = {
  id: string;
  roleId: string;
  name: string;
  slotNumber: number;
  total: number;
};

type RoleAssignment = {
  slot: RoleSlot;
  student: Student;
};

type BallPos = { x: number; y: number; scale: number };

const ballColors = [
  'from-amber-400 to-amber-600',
  'from-rose-400 to-rose-600',
  'from-sky-400 to-sky-600',
  'from-emerald-400 to-emerald-600',
  'from-violet-400 to-violet-600',
  'from-fuchsia-400 to-fuchsia-600',
];

function formatStudent(student: Student) {
  return student.number ? `${student.number}번 ${student.name}` : student.name;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeRoleId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `role-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildRoleSlots(roleGroups: RoleGroup[]): RoleSlot[] {
  return roleGroups.flatMap((role) =>
    Array.from({ length: role.count }, (_, index) => ({
      id: `${role.id}-${index + 1}`,
      roleId: role.id,
      name: role.name,
      slotNumber: index + 1,
      total: role.count,
    })),
  );
}

const roleStoragePrefix = 'classroom-tools:role-assignment:roles:';

function roleStorageKey(classId: number) {
  return `${roleStoragePrefix}${classId}`;
}

function normalizeStoredRoles(value: unknown): RoleGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((role) => {
      if (!role || typeof role !== 'object') return null;
      const raw = role as Partial<RoleGroup>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) return null;
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : makeRoleId(),
        name,
        count: Math.max(1, Math.min(99, Math.floor(Number(raw.count) || 1))),
      };
    })
    .filter((role): role is RoleGroup => role !== null);
}

function readStoredRoles(classId: number): RoleGroup[] {
  try {
    const raw = localStorage.getItem(roleStorageKey(classId));
    return normalizeStoredRoles(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

type RoleHistoryRules = {
  studentRoleKeys: Set<string>;
};

function buildStudentRoleKeys(assignments: RoleAssignment[]) {
  const keys = new Set<string>();
  assignments.forEach(({ slot, student }) => {
    if (student.id != null) keys.add(`${student.id}:${slot.name}`);
  });
  return keys;
}

function countRoleViolations(
  assignments: RoleAssignment[],
  settings: RoleSettings,
  historyRules: RoleHistoryRules[],
) {
  let violations = 0;
  const byRoleId = new Map<string, RoleAssignment[]>();
  assignments.forEach((assignment) => {
    const current = byRoleId.get(assignment.slot.roleId) ?? [];
    current.push(assignment);
    byRoleId.set(assignment.slot.roleId, current);
  });

  const forbidden = new Set(
    settings.forbiddenPairs.map(([a, b]) => [a, b].sort((x, y) => x - y).join('|')),
  );

  byRoleId.forEach((roleAssignments) => {
    for (let i = 0; i < roleAssignments.length; i++) {
      for (let j = i + 1; j < roleAssignments.length; j++) {
        const a = roleAssignments[i].student;
        const b = roleAssignments[j].student;
        if (a.id != null && b.id != null) {
          const pairKey = [a.id, b.id].sort((x, y) => x - y).join('|');
          if (forbidden.has(pairKey)) violations += 8;
        }
        if (
          settings.genderBalance === 'strict' &&
          a.gender &&
          b.gender &&
          a.gender === b.gender
        ) {
          violations += 1;
        }
      }
    }
  });

  if (settings.avoidDuplicates && historyRules.length > 0) {
    const currentKeys = buildStudentRoleKeys(assignments);
    historyRules.forEach((history) => {
      currentKeys.forEach((key) => {
        if (history.studentRoleKeys.has(key)) violations += 5;
      });
    });
  }

  return violations;
}

function solveRoleAssignments(
  students: Student[],
  slots: RoleSlot[],
  settings: RoleSettings,
  historyRules: RoleHistoryRules[],
  maxTries = 500,
) {
  let best = shuffle(students).map((student, index) => ({ slot: slots[index], student }));
  let bestViolations = countRoleViolations(best, settings, historyRules);
  if (bestViolations === 0) return { assignments: best, violations: 0 };

  for (let i = 1; i < maxTries; i++) {
    const attempt = shuffle(students).map((student, index) => ({ slot: slots[index], student }));
    const violations = countRoleViolations(attempt, settings, historyRules);
    if (violations < bestViolations) {
      best = attempt;
      bestViolations = violations;
      if (violations === 0) break;
    }
  }

  return { assignments: best, violations: bestViolations };
}

export default function RoleAssignmentPage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [classId, setClassId] = useState<number | null>(null);
  const students = useLiveQuery<Student[]>(
    () =>
      classId
        ? db.students.where('classId').equals(classId).sortBy('number')
        : Promise.resolve([] as Student[]),
    [classId],
  );
  const classInfo = useLiveQuery<ClassRoom | undefined>(
    () => (classId ? db.classes.get(classId) : Promise.resolve(undefined)),
    [classId],
  );
  const roleHistory = useLiveQuery<HistoryEntry[]>(
    () =>
      classId
        ? db.history
            .where('classId')
            .equals(classId)
            .toArray()
            .then((items) =>
              items
                .filter((entry) => entry.tool === 'role-assignment')
                .sort((a, b) => b.createdAt - a.createdAt),
            )
        : Promise.resolve([] as HistoryEntry[]),
    [classId],
  );

  const [roleNameInput, setRoleNameInput] = useState('');
  const [roleCountInput, setRoleCountInput] = useState(1);
  const [roleGroups, setRoleGroups] = useState<RoleGroup[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [revealedAssignments, setRevealedAssignments] = useState<RoleAssignment[]>([]);
  const [rollingName, setRollingName] = useState<string | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [highlightRoleId, setHighlightRoleId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [ballPos, setBallPos] = useState<BallPos>({ x: 0, y: 0, scale: 1 });
  const [ballTransition, setBallTransition] = useState<number | null>(null);
  const [ballOpacity, setBallOpacity] = useState(0);
  const [ballColorIndex, setBallColorIndex] = useState(0);
  const [ejectKey, setEjectKey] = useState(0);
  const [ejectMs, setEjectMs] = useState(360);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const ballHomeRef = useRef<HTMLDivElement>(null);
  const loadedRoleClassRef = useRef<number | null>(null);
  const skipNextRoleSaveRef = useRef(false);
  const lastRoleSignatureRef = useRef('');

  const studentList = students ?? [];
  const roleSlots = useMemo(() => buildRoleSlots(roleGroups), [roleGroups]);
  const roleSettings = classInfo?.roleSettings ?? defaultRoleSettings;
  const isReady = studentList.length > 0 && roleSlots.length === studentList.length;
  const canStart = phase === 'idle' && isReady;

  useEffect(() => {
    if (classId == null && classes && classes.length === 1 && classes[0].id != null) {
      setClassId(classes[0].id);
    }
  }, [classId, classes]);

  useEffect(() => {
    loadedRoleClassRef.current = null;
    lastRoleSignatureRef.current = '';
  }, [classId]);

  useEffect(() => {
    if (classId == null) {
      skipNextRoleSaveRef.current = true;
      setRoleGroups([]);
      resetResult();
      return;
    }
    if (!classInfo) return;
    if (loadedRoleClassRef.current === classId) return;

    const hasStoredRoleGroups = Array.isArray(classInfo.roleSettings?.roleGroups);
    const storedRoles = hasStoredRoleGroups
      ? normalizeStoredRoles(classInfo.roleSettings?.roleGroups)
      : readStoredRoles(classId);
    const signature = JSON.stringify(storedRoles);

    skipNextRoleSaveRef.current = true;
    loadedRoleClassRef.current = classId;
    lastRoleSignatureRef.current = signature;
    setRoleGroups(storedRoles);
    resetResult();

    if (!hasStoredRoleGroups && storedRoles.length > 0) {
      void db.classes.update(classId, {
        roleSettings: {
          ...defaultRoleSettings,
          ...classInfo.roleSettings,
          roleGroups: storedRoles,
        },
      });
    }
  }, [classId, classInfo]);

  useEffect(() => {
    if (classId == null) return;
    if (loadedRoleClassRef.current !== classId) return;
    if (skipNextRoleSaveRef.current) {
      skipNextRoleSaveRef.current = false;
      return;
    }

    const normalizedRoles = normalizeStoredRoles(roleGroups);
    const signature = JSON.stringify(normalizedRoles);
    if (lastRoleSignatureRef.current === signature) return;
    lastRoleSignatureRef.current = signature;

    void db.classes.update(classId, {
      roleSettings: {
        ...defaultRoleSettings,
        ...roleSettings,
        roleGroups: normalizedRoles,
      },
    });
  }, [classId, roleGroups, roleSettings]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  function resetResult() {
    clearTimers();
    setPhase('idle');
    setRevealedAssignments([]);
    setRollingName(null);
    setActiveSlotId(null);
    setHighlightRoleId(null);
    setProgress({ current: 0, total: 0 });
    setBallOpacity(0);
    setBallTransition(null);
  }

  function fillSampleRoles() {
    if (studentList.length === 0) return;
    setRoleGroups(
      Array.from({ length: studentList.length }, (_, index) => ({
        id: makeRoleId(),
        name: `역할 ${index + 1}`,
        count: 1,
      })),
    );
    setRoleNameInput('');
    setRoleCountInput(1);
    resetResult();
  }

  function addRole() {
    const roleName = roleNameInput.trim();
    const count = Math.max(1, Math.min(99, Math.floor(roleCountInput || 1)));
    if (!roleName || phase === 'running') return;
    setRoleGroups((prev) => [...prev, { id: makeRoleId(), name: roleName, count }]);
    setRoleNameInput('');
    setRoleCountInput(1);
    resetResult();
  }

  function removeRole(roleId: string) {
    if (phase === 'running') return;
    setRoleGroups((prev) => prev.filter((role) => role.id !== roleId));
    resetResult();
  }

  function updateRoleCount(roleId: string, nextCount: number) {
    if (phase === 'running') return;
    const safeCount = Math.max(1, Math.min(99, Math.floor(nextCount || 1)));
    setRoleGroups((prev) =>
      prev.map((role) => (role.id === roleId ? { ...role, count: safeCount } : role)),
    );
    resetResult();
  }

  function schedule(fn: () => void, delay: number) {
    const timer = setTimeout(fn, delay);
    timersRef.current.push(timer);
  }

  function computeHomePos(): { x: number; y: number } | null {
    const el = ballHomeRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function computeRolePos(roleId: string): { x: number; y: number } | null {
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-role="${roleId}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  async function startAssignment() {
    if (!classId || !canStart) return;

    clearTimers();
    const historyRules: RoleHistoryRules[] = roleSettings.avoidDuplicates
      ? (roleHistory ?? [])
          .slice(0, 8)
          .map((entry) => {
            const payload = entry.payload as { assignments?: unknown };
            const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
            const studentRoleKeys = new Set<string>();
            assignments.forEach((item) => {
              if (!item || typeof item !== 'object') return;
              const raw = item as { studentId?: unknown; role?: unknown };
              if (typeof raw.studentId === 'number' && typeof raw.role === 'string') {
                studentRoleKeys.add(`${raw.studentId}:${raw.role}`);
              }
            });
            return { studentRoleKeys };
          })
          .filter((history) => history.studentRoleKeys.size > 0)
      : [];
    const { assignments: assigned, violations } = solveRoleAssignments(
      studentList,
      roleSlots,
      roleSettings,
      historyRules,
    );

    if (violations > 0 && typeof console !== 'undefined') {
      console.warn(
        `[역할 배치] 조건을 완벽히 만족하지 못했습니다 (위반 ${violations}점). 최선 조합으로 진행합니다.`,
      );
    }

    setRevealedAssignments([]);
    setRollingName(null);
    setActiveSlotId(null);
    setHighlightRoleId(null);
    setProgress({ current: 0, total: assigned.length });
    setBallOpacity(0);
    setBallTransition(null);
    setPhase('running');
    sfx.resume();

    const names = studentList.map(formatStudent);

    function revealNext(index: number) {
      if (index >= assigned.length) {
        schedule(() => {
          setPhase('done');
          setRollingName(null);
          setActiveSlotId(null);
          setHighlightRoleId(null);
          setBallOpacity(0);
          setBallTransition(null);
          sfx.fanfare();
        }, 320);
        return;
      }

      const pick = assigned[index];
      let cursor = 0;
      setActiveSlotId(pick.slot.id);
      setHighlightRoleId(null);
      setProgress({ current: index + 1, total: assigned.length });

      schedule(() => {
        const home = computeHomePos();
        setBallTransition(null);
        if (home) setBallPos({ x: home.x, y: home.y, scale: 1 });
        setBallOpacity(0);
        setBallColorIndex(index % ballColors.length);
      }, cursor);

      for (let spin = 0; spin < 9; spin++) {
        cursor += 55;
        schedule(() => {
          setRollingName(names[Math.floor(Math.random() * names.length)]);
          sfx.tick();
        }, cursor);
      }

      cursor += 100;
      schedule(() => {
        setRollingName(formatStudent(pick.student));
        const home = computeHomePos();
        if (home) setBallPos({ x: home.x, y: home.y, scale: 1 });
        setBallTransition(null);
        setEjectMs(360);
        setEjectKey((key) => key + 1);
        setBallOpacity(1);
        sfx.ding();
      }, cursor);

      cursor += 460;
      schedule(() => {
        const rolePos = computeRolePos(pick.slot.roleId);
        setBallTransition(400);
        if (rolePos) setBallPos({ x: rolePos.x, y: rolePos.y, scale: 0.38 });
        sfx.whoosh(400);
      }, cursor);

      cursor += 320;
      schedule(() => {
        setHighlightRoleId(pick.slot.roleId);
        setRevealedAssignments((prev) => [...prev, pick]);
        setBallOpacity(0);
        sfx.pop();
      }, cursor);

      cursor += 180;
      schedule(() => {
        setRollingName(null);
        setHighlightRoleId(null);
        revealNext(index + 1);
      }, cursor);
    }

    revealNext(0);

    await db.history.add({
      classId,
      tool: 'role-assignment',
      title: `역할 배치 ${assigned.length}명`,
      payload: {
        format: 'role-assignment/v2',
        roleGroups,
        settings: roleSettings,
        violations,
        assignments: assigned.map(({ slot, student }) => ({
          roleId: slot.roleId,
          role: slot.name,
          slotNumber: slot.slotNumber,
          total: slot.total,
          studentId: student.id ?? null,
          studentName: student.name,
          studentNumber: student.number ?? null,
        })),
      },
      createdAt: Date.now(),
    });
  }

  const revealedByRoleId = useMemo(() => {
    const map = new Map<string, RoleAssignment[]>();
    revealedAssignments.forEach((assignment) => {
      const current = map.get(assignment.slot.roleId) ?? [];
      current.push(assignment);
      current.sort((a, b) => a.slot.slotNumber - b.slot.slotNumber);
      map.set(assignment.slot.roleId, current);
    });
    return map;
  }, [revealedAssignments]);

  const activeSlot = activeSlotId ? roleSlots.find((slot) => slot.id === activeSlotId) : null;
  const activeRoleId = activeSlot?.roleId ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← 홈으로
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">역할 배치</h1>
            <p className="mt-1 text-sm text-slate-500">
              자리배치에 등록된 학급 명단을 바탕으로 역할을 로또처럼 무작위 배정합니다.
            </p>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
            역할배치 설정은 기본 포맷 완성 후 추가할 예정입니다.
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr,1.15fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <label className="mb-2 block text-sm font-semibold text-slate-700">학급 선택</label>
          <select
            value={classId ?? ''}
            onChange={(event) => {
              resetResult();
              setClassId(event.target.value ? Number(event.target.value) : null);
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:border-slate-600 focus:outline-none"
          >
            <option value="">선택하세요</option>
            {classes?.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-800">학생 명단</div>
            <div className="mt-1">총 {studentList.length}명</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {studentList.length === 0 ? (
                <span className="text-slate-400">학급을 선택하거나 학생을 먼저 등록해 주세요.</span>
              ) : studentList.map((student) => (
                <span key={student.id ?? student.name} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                  {formatStudent(student)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm font-semibold text-slate-700">역할명과 배정 인원 추가</label>
            <button
              type="button"
              onClick={fillSampleRoles}
              disabled={studentList.length === 0 || phase === 'running'}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              역할 칸 자동 만들기
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addRole();
            }}
            className="grid gap-2 sm:grid-cols-[1fr,100px,auto]"
          >
            <input
              value={roleNameInput}
              onChange={(event) => setRoleNameInput(event.target.value)}
              disabled={phase === 'running'}
              placeholder="예: 모둠장, 발표자, 기록자"
              className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:border-slate-600 focus:outline-none disabled:bg-slate-50"
            />
            <input
              type="number"
              min={1}
              max={99}
              value={roleCountInput}
              onChange={(event) => setRoleCountInput(Number(event.target.value))}
              disabled={phase === 'running'}
              aria-label="역할 배정 인원"
              className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm focus:border-slate-600 focus:outline-none disabled:bg-slate-50"
            />
            <button
              type="submit"
              disabled={!roleNameInput.trim() || phase === 'running'}
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
            >
              추가
            </button>
          </form>
          <div className="mt-3 min-h-[132px] rounded-2xl border border-slate-200 bg-slate-50 p-3">
            {roleGroups.length === 0 ? (
              <div className="flex h-[104px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
                역할명과 인원을 입력하면 칸이 자동으로 생성됩니다.
              </div>
            ) : (
              <div className="grid gap-2">
                {roleGroups.map((role) => (
                  <div
                    key={role.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
                  >
                    <div>
                      <span>{role.name}</span>
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        {role.count}명
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateRoleCount(role.id, role.count - 1)}
                        disabled={phase === 'running' || role.count <= 1}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                        aria-label={`${role.name} 인원 줄이기`}
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRoleCount(role.id, role.count + 1)}
                        disabled={phase === 'running'}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                        aria-label={`${role.name} 인원 늘리기`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRole(role.id)}
                        disabled={phase === 'running'}
                        className="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300"
                        aria-label={`${role.name} 역할 삭제`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={`mt-2 text-sm ${isReady ? 'text-emerald-600' : 'text-slate-500'}`}>
            역할 칸 {roleSlots.length}개 · 학생 {studentList.length}명
            {isReady ? (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-700">
                역할배치 READY
              </span>
            ) : studentList.length > 0 ? (
              <span className="ml-2 text-rose-600">학생 수와 역할 칸 수를 맞춰 주세요.</span>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {phase === 'idle' && (
              <button
                onClick={startAssignment}
                disabled={!canStart}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:bg-slate-300"
              >
                역할배치 시작
              </button>
            )}
            {phase === 'running' && (
              <button
                onClick={resetResult}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                중단
              </button>
            )}
            {phase === 'done' && (
              <button
                onClick={resetResult}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                다시
              </button>
            )}
          </div>
        </div>
      </section>

      {phase === 'running' && (
        <div className="mb-4 p-6 bg-gradient-to-b from-amber-50 via-amber-100/40 to-white border-2 border-amber-300 rounded-lg text-center relative overflow-hidden">
          <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-amber-200/50 blur-3xl" />
          <div className="pointer-events-none absolute top-3 left-6 text-xl text-amber-400 animate-sparkleSpin" aria-hidden>
            ✦
          </div>
          <div className="pointer-events-none absolute top-5 right-8 text-2xl text-amber-500 animate-sparkleSpin" style={{ animationDelay: '0.9s' }} aria-hidden>
            ✧
          </div>
          <div className="pointer-events-none absolute bottom-6 left-10 text-lg text-amber-400 animate-sparkleSpin" style={{ animationDelay: '1.6s' }} aria-hidden>
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
              <div ref={ballHomeRef} className="w-24 h-14 mt-1" aria-hidden />
            </div>
            <div className="mt-2 h-1.5 w-full max-w-md mx-auto bg-amber-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 transition-all duration-200"
                style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
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
              className={ballTransition === null && ballOpacity > 0 ? 'animate-ballEject' : ''}
              style={{ '--eject-duration': `${ejectMs}ms` } as CSSProperties}
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-white/50 blur-xl -z-10 scale-150" />
                <div className={`relative px-7 py-4 bg-gradient-to-br ${ballColors[ballColorIndex]} text-white text-2xl font-extrabold rounded-full shadow-[0_12px_30px_rgba(0,0,0,0.35)] border-[5px] border-white whitespace-nowrap`}>
                  <span className="pointer-events-none absolute top-1 left-3 right-3 h-2 rounded-full bg-white/60 blur-[2px]" />
                  {rollingName ?? '···'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">역할 배치판</h2>
            <p className="mt-1 text-sm text-slate-500">역할마다 설정한 인원수만큼 학생이 뽑혀 들어갑니다.</p>
          </div>
          <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
            {phase === 'running' ? `${progress.current} / ${progress.total} 진행 중` : phase === 'done' ? '배치 완료' : isReady ? '역할배치 READY' : '대기 중'}
          </div>
        </div>

        {roleSlots.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
            역할명을 입력하면 이곳에 역할 카드가 만들어집니다.
          </div>
        ) : (
          <div ref={boardRef} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roleGroups.map((role) => {
              const assignments = revealedByRoleId.get(role.id) ?? [];
              const isActive = activeRoleId === role.id && phase === 'running';
              const isHighlight = highlightRoleId === role.id;
              return (
                <div
                  key={role.id}
                  data-role={role.id}
                  className={`min-h-[190px] rounded-2xl border p-4 transition ${
                    isActive || isHighlight
                      ? 'border-amber-300 bg-amber-50 shadow-sm animate-highlight'
                      : assignments.length === role.count
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-500">역할</div>
                      <div className="mt-1 text-2xl font-black text-slate-900 break-keep">{role.name}</div>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                      {assignments.length}/{role.count}명
                    </div>
                  </div>
                  <div className="mt-5 grid gap-2">
                    {Array.from({ length: role.count }, (_, index) => {
                      const assignment = assignments[index];
                      const isCurrentSlot = activeSlot?.roleId === role.id && activeSlot.slotNumber === index + 1;
                      return (
                        <div
                          key={`${role.id}-member-${index + 1}`}
                          className={`rounded-xl px-3 py-3 text-center ring-1 ${
                            isCurrentSlot
                              ? 'bg-amber-100 text-amber-950 ring-amber-200'
                              : assignment
                                ? 'bg-white text-slate-900 ring-emerald-100'
                                : 'bg-white/70 text-slate-400 ring-slate-200'
                          }`}
                        >
                          {assignment ? (
                            <div className="animate-seatBurst text-lg font-black">
                              {formatStudent(assignment.student)}
                            </div>
                          ) : (
                            <div className="text-sm">{index + 1}번 배정 대기</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {classId && phase === 'idle' && roleHistory && roleHistory.length > 0 && (
        <section className="mt-8">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span>📅</span>
            <span>이전 역할배치 기록</span>
            <span className="text-xs font-normal text-slate-500">({roleHistory.length}건)</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {roleHistory.map((entry) => (
              <Link
                key={entry.id}
                to={`/classes/${classId}/role-history/${entry.id}`}
                className="block p-3 bg-white border border-slate-200 rounded-md hover:border-slate-900 hover:shadow-sm transition"
              >
                <div className="text-xs text-slate-500 tabular-nums mb-0.5">
                  {formatDateTime(entry.createdAt)}
                </div>
                <div className="text-sm font-medium text-slate-800 truncate">{entry.title}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
