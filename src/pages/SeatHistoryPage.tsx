import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ClassRoom, type HistoryEntry, type Student } from '../db';
import { type SeatResultSeat } from '../lib/backup';

function buildSnapshot(h: HistoryEntry, students: Student[]): SeatResultSeat[] {
  const p = h.payload as { snapshot?: SeatResultSeat[]; seats?: unknown };
  if (Array.isArray(p?.snapshot)) return p.snapshot;
  const raw = Array.isArray(p?.seats) ? p.seats : [];
  return raw
    .filter(
      (x): x is [string, number] =>
        Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number',
    )
    .map(([key, dbId]) => {
      const [r, c] = key.split(',').map(Number);
      const s = students.find((x) => x.id === dbId);
      return {
        row: r + 1,
        col: c + 1,
        name: s?.name ?? `학생 ${dbId}`,
        gender: s?.gender,
        number: s?.number,
      };
    })
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SeatHistoryPage() {
  const { classId, historyId } = useParams();
  const navigate = useNavigate();
  const cid = Number(classId);
  const hid = Number(historyId);

  const cls = useLiveQuery<ClassRoom | undefined>(
    () => db.classes.get(cid),
    [cid],
  );
  const students = useLiveQuery<Student[]>(
    () => db.students.where('classId').equals(cid).toArray(),
    [cid],
  );
  const entry = useLiveQuery<HistoryEntry | undefined>(
    () => db.history.get(hid),
    [hid],
  );

  async function removeEntry() {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await db.history.delete(hid);
    navigate('/seat');
  }

  if (!entry) {
    return (
      <div>
        <Link
          to="/seat"
          className="text-sm text-slate-500 hover:underline"
        >
          ← 자리배치로
        </Link>
        <div className="mt-6 text-slate-600">기록을 찾을 수 없습니다.</div>
      </div>
    );
  }

  const snapshot = buildSnapshot(entry, students ?? []);
  const p = entry.payload as { layout?: { rows: number; cols: number } };
  const rows = p?.layout?.rows ?? Math.max(...snapshot.map((s) => s.row), 1);
  const cols = p?.layout?.cols ?? Math.max(...snapshot.map((s) => s.col), 1);
  const seatMap = new Map<string, SeatResultSeat>();
  snapshot.forEach((s) => seatMap.set(`${s.row},${s.col}`, s));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Link
          to="/seat"
          className="text-sm text-slate-500 hover:underline"
        >
          ← 자리배치로
        </Link>
        <button
          onClick={removeEntry}
          className="text-xs text-slate-400 hover:text-red-600"
        >
          기록 삭제
        </button>
      </div>

      <h1 className="text-xl font-bold text-slate-800">{entry.title}</h1>
      <p className="text-sm text-slate-500 mb-6">
        {cls?.name ?? '학급'} · {formatDateTime(entry.createdAt)}
      </p>

      <div className="p-4 bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="mx-auto mb-4 text-center">
          <div className="inline-block px-16 py-2 bg-slate-800 text-white text-xs tracking-[0.3em] rounded">
            칠판
          </div>
        </div>
        <div
          className="grid gap-2 mx-auto"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const r = Math.floor(i / cols) + 1;
            const c = (i % cols) + 1;
            const s = seatMap.get(`${r},${c}`);
            if (!s) {
              return (
                <div
                  key={i}
                  className="aspect-[3/2] rounded-md border border-dashed border-slate-200"
                />
              );
            }
            const genderClass =
              s.gender === 'M'
                ? 'border-blue-200 bg-blue-50/60'
                : s.gender === 'F'
                  ? 'border-rose-200 bg-rose-50/60'
                  : 'border-slate-300 bg-slate-50';
            return (
              <div
                key={i}
                className={`aspect-[3/2] flex flex-col items-center justify-center rounded-md border text-sm ${genderClass}`}
              >
                {s.number != null && (
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {s.number}
                  </span>
                )}
                <span className="text-slate-800 font-medium">{s.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
