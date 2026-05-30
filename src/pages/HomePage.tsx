import { FormEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { exportBackup, importBackupFromFile } from '../lib/backup';

const classroomTools = [
  { to: '/seat', emoji: '🪑', title: '자리 배치', desc: '자리 자동 배치' },
  { to: '/role-assignment', emoji: '📋', title: '역할 배치', desc: '역할 무작위 배정' },
];

const activityTools = [
  { to: '/word-survival', emoji: '🔥', title: '단어 서바이벌', desc: '개인 활동' },
  { to: '/word-survival-team', emoji: '🤝', title: '팀 서바이벌', desc: '팀 대결 활동' },
  { to: '/cooperative-speed-quiz', emoji: '⚡', title: '협동 스피드 퀴즈', desc: '짝·팀 퀴즈' },
  { to: '/class-mission', emoji: '🚀', title: '학급 공동 미션', desc: '전체 협동 활동' },
];

export default function HomePage() {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!confirm('기존 데이터를 덮어씁니다. 계속할까요?')) return;
      await importBackupFromFile(file);
      alert('백업 파일을 불러왔습니다.');
    } catch (err) {
      alert(`불러오기 실패: ${(err as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function createAndGo(e: FormEvent) {
    e.preventDefault();
    const trimmed = newClassName.trim();
    if (!trimmed) return;
    const id = await db.classes.add({ name: trimmed, createdAt: Date.now() });
    setNewClassName('');
    setAdding(false);
    navigate(`/classes/${id}`);
  }

  async function removeClass(e: React.MouseEvent, classId: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('이 학급과 학생/기록 데이터를 모두 삭제할까요?')) return;

    await db.transaction('rw', db.classes, db.students, db.history, async () => {
      await db.students.where('classId').equals(classId).delete();
      await db.history.where('classId').equals(classId).delete();
      await db.classes.delete(classId);
    });
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
        <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-black tracking-[0.24em] text-slate-400">CLASSROOM</div>
              <h2 className="mt-1 text-xl font-black text-slate-900">학급 관리 · 운영</h2>
              <p className="mt-1 text-xs text-slate-500">학급 목록과 기본 운영 도구를 한곳에서 관리합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                onClick={exportBackup}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white hover:text-slate-900"
              >
                백업 내보내기
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white hover:text-slate-900"
              >
                백업 불러오기
              </button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={handleImport} />
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_320px]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(classes ?? []).map((classItem) => (
              <div key={classItem.id} className="group relative">
                <Link
                  to={`/classes/${classItem.id}`}
                  className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                >
                  <div className="pr-8 text-sm font-black text-slate-900">{classItem.name}</div>
                  <div className="mt-1 text-xs text-slate-500">학생 명단과 기록 보기</div>
                </Link>
                <button
                  onClick={(e) => removeClass(e, classItem.id!)}
                  title="학급 삭제"
                  aria-label="학급 삭제"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}

            <div>
              {adding ? (
                <form
                  onSubmit={createAndGo}
                  className="flex min-h-[78px] items-center gap-2 rounded-2xl border border-dashed border-slate-400 bg-white px-4 py-3"
                >
                  <input
                    autoFocus
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    onBlur={() => {
                      if (!newClassName.trim()) setAdding(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setAdding(false);
                        setNewClassName('');
                      }
                    }}
                    placeholder="학급 이름"
                    className="min-w-0 flex-1 bg-transparent font-semibold text-slate-800 focus:outline-none"
                  />
                  <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                    만들기
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  className="flex min-h-[78px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-transparent px-4 py-3 text-slate-500 transition hover:border-slate-900 hover:text-slate-900"
                >
                  <span className="text-lg leading-none">+</span>
                  <span className="text-sm font-semibold">새 학급 추가</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {classroomTools.map((tool) => (
              <Link
                key={tool.to}
                to={tool.to}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
              >
                <span className="text-2xl">{tool.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-slate-900">{tool.title}</span>
                  <span className="block text-xs text-slate-500">{tool.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
        <div>
          <div className="text-xs font-black tracking-[0.24em] text-slate-400">TOOLS</div>
          <h2 className="mt-1 text-xl font-black text-slate-900">게임 · 활동</h2>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {activityTools.map((tool) => (
            <Link
              key={tool.to}
              to={tool.to}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
            >
              <span className="text-2xl">{tool.emoji}</span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-slate-900">{tool.title}</span>
                <span className="block text-xs text-slate-500">{tool.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
