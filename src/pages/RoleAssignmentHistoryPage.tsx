import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ClassRoom, type HistoryEntry } from '../db';

type RoleHistoryAssignment = {
  roleId?: string;
  role: string;
  slotNumber?: number;
  total?: number;
  studentName: string;
  studentNumber?: number | null;
};

type RoleHistoryPayload = {
  format?: string;
  roleGroups?: Array<{ id: string; name: string; count: number }>;
  assignments?: RoleHistoryAssignment[];
};

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatStudentName(assignment: RoleHistoryAssignment) {
  return assignment.studentNumber
    ? `${assignment.studentNumber}번 ${assignment.studentName}`
    : assignment.studentName;
}

function buildRoleGroups(payload: RoleHistoryPayload) {
  const assignments = payload.assignments ?? [];
  if (payload.roleGroups?.length) {
    return payload.roleGroups.map((role) => ({
      id: role.id,
      name: role.name,
      count: role.count,
      assignments: assignments
        .filter((assignment) => assignment.roleId === role.id || assignment.role === role.name)
        .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0)),
    }));
  }

  const grouped = new Map<string, RoleHistoryAssignment[]>();
  assignments.forEach((assignment) => {
    const key = assignment.roleId ?? assignment.role;
    const current = grouped.get(key) ?? [];
    current.push(assignment);
    current.sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0));
    grouped.set(key, current);
  });

  return Array.from(grouped.entries()).map(([id, roleAssignments]) => ({
    id,
    name: roleAssignments[0]?.role ?? id,
    count: roleAssignments[0]?.total ?? roleAssignments.length,
    assignments: roleAssignments,
  }));
}

export default function RoleAssignmentHistoryPage() {
  const { classId, historyId } = useParams();
  const navigate = useNavigate();
  const cid = Number(classId);
  const hid = Number(historyId);

  const cls = useLiveQuery<ClassRoom | undefined>(() => db.classes.get(cid), [cid]);
  const entry = useLiveQuery<HistoryEntry | undefined>(() => db.history.get(hid), [hid]);

  async function removeEntry() {
    if (!confirm('이 역할배치 기록을 삭제할까요?')) return;
    await db.history.delete(hid);
    navigate('/role-assignment');
  }

  if (!entry) {
    return (
      <div>
        <Link to="/role-assignment" className="text-sm text-slate-500 hover:underline">
          ← 역할배치로
        </Link>
        <div className="mt-6 text-slate-600">기록을 찾을 수 없습니다.</div>
      </div>
    );
  }

  const payload = (entry.payload ?? {}) as RoleHistoryPayload;
  const roleGroups = buildRoleGroups(payload);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link to="/role-assignment" className="text-sm text-slate-500 hover:underline">
          ← 역할배치로
        </Link>
        <button onClick={removeEntry} className="text-xs text-slate-400 hover:text-red-600">
          기록 삭제
        </button>
      </div>

      <h1 className="text-xl font-bold text-slate-800">{entry.title}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {cls?.name ?? '학급'} · {formatDateTime(entry.createdAt)}
      </p>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5">
        <div className="mb-4 text-center">
          <div className="inline-block rounded bg-slate-800 px-16 py-2 text-xs tracking-[0.3em] text-white">
            역할 배치 결과
          </div>
        </div>

        {roleGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
            저장된 역할배치 결과가 없습니다.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roleGroups.map((role) => (
              <div
                key={role.id}
                className="min-h-[180px] rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-500">역할</div>
                    <div className="mt-1 break-keep text-2xl font-black text-slate-900">
                      {role.name}
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                    {role.assignments.length}/{role.count}명
                  </div>
                </div>
                <div className="mt-5 grid gap-2">
                  {Array.from({ length: role.count }, (_, index) => {
                    const assignment = role.assignments[index];
                    return (
                      <div
                        key={`${role.id}-${index + 1}`}
                        className="rounded-xl bg-white px-3 py-3 text-center text-slate-900 ring-1 ring-emerald-100"
                      >
                        {assignment ? (
                          <div className="text-lg font-black">{formatStudentName(assignment)}</div>
                        ) : (
                          <div className="text-sm text-slate-400">{index + 1}번 기록 없음</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
