import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import SeatSettingsPanel from '../components/SeatSettingsPanel';
import RoleSettingsPanel from '../components/RoleSettingsPanel';
import {
  db,
  defaultRoleSettings,
  defaultSeatSettings,
  type Gender,
  type HistoryEntry,
} from '../db';

function parseGender(raw: string): Gender | undefined {
  const v = raw.trim().toUpperCase();
  if (v === 'M' || v === '남' || v === '남자') return 'M';
  if (v === 'F' || v === '여' || v === '여자') return 'F';
  return undefined;
}

export default function ClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const id = Number(classId);
  const cls = useLiveQuery(() => db.classes.get(id), [id]);
  const students = useLiveQuery(
    () => db.students.where('classId').equals(id).sortBy('number'),
    [id],
  );
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [className, setClassName] = useState('');
  const [seatToolOpen, setSeatToolOpen] = useState(false);
  const [roleToolOpen, setRoleToolOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cls) setClassName(cls.name);
  }, [cls?.name]);

  const seatHistory = useLiveQuery<HistoryEntry[]>(
    () =>
      db.history
        .where('classId')
        .equals(id)
        .toArray()
        .then((arr) =>
          arr
            .filter((h) => h.tool === 'seat')
            .sort((a, b) => b.createdAt - a.createdAt),
        ),
    [id],
  );

  const nextNumber = useMemo(() => {
    if (!students || students.length === 0) return 1;
    const max = students.reduce(
      (acc, s) => (typeof s.number === 'number' && s.number > acc ? s.number : acc),
      0,
    );
    return max + 1;
  }, [students]);

  async function saveClassName() {
    const trimmed = className.trim();
    if (!trimmed || !cls || trimmed === cls.name) return;
    await db.classes.update(id, { name: trimmed });
  }

  async function deleteClass() {
    if (!confirm('이 학급과 학생·기록을 모두 삭제할까요?')) return;
    await db.transaction('rw', db.classes, db.students, db.history, async () => {
      await db.students.where('classId').equals(id).delete();
      await db.history.where('classId').equals(id).delete();
      await db.classes.delete(id);
    });
    navigate('/');
  }

  async function addOne(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await db.students.add({
      classId: id,
      name: trimmed,
      number: nextNumber,
      gender: gender || undefined,
      createdAt: Date.now(),
    });
    setName('');
    setGender('');
    nameInputRef.current?.focus();
  }

  async function addBulk() {
    const lines = bulk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const now = Date.now();
    let running = nextNumber;
    await db.students.bulkAdd(
      lines.map((line, i) => {
        const parts = line.split(/\s+/);
        let num: number | undefined;
        let g: Gender | undefined;
        let nameParts = [...parts];

        const maybeNum = Number(parts[0]);
        if (!Number.isNaN(maybeNum) && parts.length > 1) {
          num = maybeNum;
          nameParts = parts.slice(1);
        }

        const lastGender = parseGender(nameParts[nameParts.length - 1] ?? '');
        if (lastGender && nameParts.length > 1) {
          g = lastGender;
          nameParts = nameParts.slice(0, -1);
        }

        const assignedNumber = num ?? running++;
        return {
          classId: id,
          name: nameParts.join(' ') || line,
          number: assignedNumber,
          gender: g,
          createdAt: now + i,
        };
      }),
    );
    setBulk('');
    setBulkOpen(false);
  }

  async function removeStudent(sid: number) {
    await db.students.delete(sid);
  }

  async function setStudentGender(sid: number, next: Gender | undefined) {
    await db.students.update(sid, { gender: next });
  }

  async function deleteHistoryEntry(hid: number) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    await db.history.delete(hid);
  }

  function formatDateTime(ts: number) {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  if (!cls) {
    return (
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:underline">
          ← 홈
        </Link>
        <div className="mt-4 text-slate-600">학급을 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Link to="/" className="text-sm text-slate-500 hover:underline">
          ← 홈
        </Link>
        <button
          onClick={deleteClass}
          className="text-xs text-slate-400 hover:text-red-600"
        >
          학급 삭제
        </button>
      </div>

      <input
        value={className}
        onChange={(e) => setClassName(e.target.value)}
        onBlur={saveClassName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="text-xl font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:outline-none w-full mb-6"
      />

      <section className="mb-4 p-4 bg-white border border-slate-200 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">
            학생 목록 <span className="text-slate-500">({students?.length ?? 0}명)</span>
          </h2>
          <button
            onClick={() => setBulkOpen((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            {bulkOpen ? '− 붙여넣기 닫기' : '+ 여러 명 붙여넣기'}
          </button>
        </div>

        {bulkOpen && (
          <div className="mb-4 pb-4 border-b border-slate-100">
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={5}
              placeholder={'김민수 남\n이서연 여\n박지훈 M'}
              className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:border-slate-500"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-slate-400">
                한 줄에 <code>이름</code> 또는 <code>번호 이름 성별</code>
              </p>
              <button
                onClick={addBulk}
                disabled={!bulk.trim()}
                className="px-3 py-1 bg-slate-900 text-white rounded-md text-xs hover:bg-slate-700 disabled:bg-slate-300"
              >
                전체 추가
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {students?.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 px-2 py-1.5 border border-slate-200 rounded-md bg-white group"
            >
              <span className="text-slate-400 text-xs tabular-nums w-5 text-right shrink-0">
                {s.number ?? '-'}
              </span>
              <span className="flex-1 truncate text-sm text-slate-800">{s.name}</span>
              <button
                onClick={() =>
                  setStudentGender(s.id!, s.gender === 'M' ? undefined : 'M')
                }
                className={`w-6 h-6 rounded text-[10px] font-medium transition shrink-0 ${
                  s.gender === 'M'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                남
              </button>
              <button
                onClick={() =>
                  setStudentGender(s.id!, s.gender === 'F' ? undefined : 'F')
                }
                className={`w-6 h-6 rounded text-[10px] font-medium transition shrink-0 ${
                  s.gender === 'F'
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                여
              </button>
              <button
                onClick={() => removeStudent(s.id!)}
                title="삭제"
                aria-label="삭제"
                className="w-4 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={addOne}
          className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2"
        >
          <span className="text-slate-400 w-8 text-right tabular-nums text-sm">
            {nextNumber}
          </span>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="학생 이름 입력 후 Enter"
            className="flex-1 px-2 py-1 border-b border-slate-200 bg-transparent focus:outline-none focus:border-slate-500"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setGender((g) => (g === 'M' ? '' : 'M'))}
            className={`w-7 h-7 rounded-md text-xs font-medium transition ${
              gender === 'M'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
          >
            남
          </button>
          <button
            type="button"
            onClick={() => setGender((g) => (g === 'F' ? '' : 'F'))}
            className={`w-7 h-7 rounded-md text-xs font-medium transition ${
              gender === 'F'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
          >
            여
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-6 text-slate-400 hover:text-slate-900 disabled:text-slate-200"
            title="추가"
            aria-label="추가"
          >
            +
          </button>
        </form>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <span>📅</span>
            <span>자리 배치 기록</span>
            <span className="text-xs font-normal text-slate-500">
              ({seatHistory?.length ?? 0}건)
            </span>
          </h3>
          <span className="text-xs text-slate-400">
            · 홈의 "내 컴퓨터에 저장"으로 함께 백업됩니다
          </span>
        </div>
        {seatHistory && seatHistory.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {seatHistory.map((h) => (
              <div key={h.id} className="relative group">
                <Link
                  to={`/classes/${id}/seat-history/${h.id}`}
                  className="block p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-900 hover:shadow-sm transition"
                >
                  <div className="text-xs text-slate-500 tabular-nums mb-1">
                    {formatDateTime(h.createdAt)}
                  </div>
                  <div className="font-semibold text-slate-800 pr-6 truncate">
                    {h.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    클릭하여 결과 보기 →
                  </div>
                </Link>
                <button
                  onClick={() => deleteHistoryEntry(h.id!)}
                  title="기록 삭제"
                  aria-label="삭제"
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500 px-4 py-3 bg-white border border-dashed border-slate-200 rounded-lg">
            아직 기록이 없습니다. 자리배치 도구에서 배치를 실행하면 날짜별로 자동
            저장됩니다.
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 flex items-center gap-2">
          <span>🔒</span>
          <span className="font-semibold">도구 설정 (교사 전용)</span>
          <span className="text-amber-700/80">
            — 학생 화면에 보여주지 마세요. 학급별로 저장됩니다.
          </span>
        </div>

        <div className="space-y-3">
          <div className="border-2 border-dashed border-amber-300 rounded-lg bg-white">
            <button
              onClick={() => setSeatToolOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-50/60 transition rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">🪑</span>
                <span className="font-semibold text-slate-800">자리 배치 도구</span>
                <span className="text-xs text-slate-500">
                  짝 금지 · 성별 배치 · 고정 자리 · 이전 기록 중복 방지
                </span>
              </div>
              <span className="text-slate-500 text-sm">
                {seatToolOpen ? '닫기 ▲' : '열기 ▼'}
              </span>
            </button>
            {seatToolOpen && (
              <div className="px-4 pb-4">
                <SeatSettingsPanel
                  classId={id}
                  students={students ?? []}
                  settings={cls.seatSettings ?? defaultSeatSettings}
                />
              </div>
            )}
          </div>

          <div className="border-2 border-dashed border-sky-300 rounded-lg bg-white">
            <button
              onClick={() => setRoleToolOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-sky-50/60 transition rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">🎭</span>
                <span className="font-semibold text-slate-800">역할 배치 도구</span>
                <span className="text-xs text-slate-500">
                  같은 역할 금지 · 성별 배치 · 이전 기록 중복 방지
                </span>
              </div>
              <span className="text-slate-500 text-sm">
                {roleToolOpen ? '닫기 ▲' : '열기 ▼'}
              </span>
            </button>
            {roleToolOpen && (
              <div className="px-4 pb-4">
                <RoleSettingsPanel
                  classId={id}
                  students={students ?? []}
                  settings={cls.roleSettings ?? defaultRoleSettings}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
