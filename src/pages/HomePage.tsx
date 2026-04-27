import { FormEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { exportBackup, importBackupFromFile } from '../lib/backup';

const tools = [
  {
    to: '/seat',
    emoji: '🪑',
    title: '자리 배치',
    desc: '학급 명단을 바탕으로 자리를 무작위 배정합니다.',
  },
  {
    to: '/role-assignment',
    emoji: '🎭',
    title: '역할 배치',
    desc: '자리배치 명단을 바탕으로 수업 역할을 로또처럼 배정합니다.',
  },
  {
    to: '/word-survival',
    emoji: '🏮',
    title: '단어 서바이벌(개인전)',
    desc: '사자성어·속담 등 문제 JSON을 바꿔가며 개인 대결을 진행합니다.',
  },
  {
    to: '/word-survival-team',
    emoji: '🏆',
    title: '단어 서바이벌(팀전)',
    desc: '최근 자리배치의 짝을 팀으로 묶어 팀 대결을 진행합니다.',
  },
  {
    to: '/cooperative-speed-quiz',
    emoji: '⚡',
    title: '협동 스피드 퀴즈',
    desc: '짝별로 설명자와 정답자를 나눠 스피드 퀴즈를 진행하고 팀 순위를 매깁니다.',
  },
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
      if (!confirm('기존 데이터를 모두 덮어씁니다. 계속하시겠습니까?')) return;
      await importBackupFromFile(file);
      alert('불러오기가 완료되었습니다.');
    } catch (err) {
      alert(`가져오기 실패: ${(err as Error).message}`);
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
    if (!confirm('이 학급과 학생·기록을 모두 삭제할까요?')) return;
    await db.transaction('rw', db.classes, db.students, db.history, async () => {
      await db.students.where('classId').equals(classId).delete();
      await db.history.where('classId').equals(classId).delete();
      await db.classes.delete(classId);
    });
  }

  return (
    <div className="space-y-10">
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">문해력 서바이벌</h1>
          <p className="text-slate-500 text-sm">
            학급 명단을 관리하고 자리 배치와 단어 서바이벌을 차근차근 추가해 나갑니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportBackup}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-100"
            title="저장 위치를 선택해 모든 학급·학생·기록을 JSON 파일로 저장"
          >
            💾 내 컴퓨터에 저장
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white hover:bg-slate-100"
            title="백업 파일에서 복원 (현재 데이터 덮어쓰기)"
          >
            📂 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-3">학급</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(classes ?? []).map((c) => (
            <li key={c.id} className="relative group">
              <Link
                to={`/classes/${c.id}`}
                className="block px-5 py-4 bg-white border border-slate-200 rounded-lg hover:border-slate-900 hover:shadow-sm transition"
              >
                <div className="font-semibold text-slate-800 pr-6">{c.name}</div>
                <div className="text-xs text-slate-500 mt-1">클릭하여 명단 입력</div>
              </Link>
              <button
                onClick={(e) => removeClass(e, c.id!)}
                title="학급 삭제"
                aria-label="학급 삭제"
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition"
              >
                ×
              </button>
            </li>
          ))}
          <li>
            {adding ? (
              <form
                onSubmit={createAndGo}
                className="flex items-center gap-2 px-5 py-4 bg-white border border-dashed border-slate-400 rounded-lg"
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
                  className="flex-1 min-w-0 bg-transparent font-semibold text-slate-800 focus:outline-none"
                />
                <button
                  type="submit"
                  className="text-sm px-3 py-1 bg-slate-900 text-white rounded-md hover:bg-slate-700"
                >
                  만들기
                </button>
              </form>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full h-full min-h-[72px] px-5 py-4 flex items-center justify-center gap-2 bg-transparent border border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-slate-900 hover:text-slate-900 transition"
              >
                <span className="text-lg leading-none">+</span>
                <span className="text-sm">새 학급</span>
              </button>
            )}
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-3">도구</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {tools.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="group relative min-h-[124px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-900 hover:shadow-sm"
            >
              <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-slate-100 transition group-hover:bg-amber-100" />
              <div className="relative flex h-full flex-col justify-between gap-3">
                <div>
                  <div className="mb-2 text-2xl">{t.emoji}</div>
                  <div className="font-semibold text-slate-800">{t.title}</div>
                  <div className="mt-1 text-sm leading-5 text-slate-500">{t.desc}</div>
                </div>
                <div className="text-xs font-semibold text-slate-400 group-hover:text-slate-700">
                  바로가기 →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
