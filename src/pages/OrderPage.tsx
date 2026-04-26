import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import StudentSource, {
  parseQuickNames,
  type SourceMode,
} from '../components/StudentSource';
import { db, type Student } from '../db';
import { shuffle } from '../lib/shuffle';

export default function OrderPage() {
  const [mode, setMode] = useState<SourceMode>('class');
  const [classId, setClassId] = useState<number | null>(null);
  const [quickText, setQuickText] = useState('');
  const [pickCount, setPickCount] = useState(1);
  const [result, setResult] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(false);

  const classStudents = useLiveQuery<Student[]>(
    () =>
      mode === 'class' && classId
        ? db.students.where('classId').equals(classId).sortBy('number')
        : Promise.resolve([] as Student[]),
    [mode, classId],
  );

  const names = useMemo(() => {
    if (mode === 'class') return classStudents?.map((s) => s.name) ?? [];
    return parseQuickNames(quickText);
  }, [mode, classStudents, quickText]);

  function pick() {
    if (names.length === 0) return;
    setSpinning(true);
    setResult([]);
    const shuffled = shuffle(names);
    const picked = shuffled.slice(0, Math.min(pickCount, shuffled.length));

    let i = 0;
    const tick = () => {
      i++;
      setResult(shuffle(names).slice(0, picked.length));
      if (i < 15) {
        setTimeout(tick, 60 + i * 10);
      } else {
        setResult(picked);
        setSpinning(false);
        if (mode === 'class' && classId) {
          db.history.add({
            classId,
            tool: 'order',
            title: `순서 뽑기 ${picked.length}명`,
            payload: { picked },
            createdAt: Date.now(),
          });
        }
      }
    };
    tick();
  }

  function pickAllOrder() {
    if (names.length === 0) return;
    const shuffled = shuffle(names);
    setResult(shuffled);
    if (mode === 'class' && classId) {
      db.history.add({
        classId,
        tool: 'order',
        title: `전체 순서 ${shuffled.length}명`,
        payload: { order: shuffled },
        createdAt: Date.now(),
      });
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800 mb-4">순서 뽑기</h1>

      <div className="mb-4">
        <StudentSource
          mode={mode}
          onModeChange={setMode}
          classId={classId}
          onClassChange={setClassId}
          quickText={quickText}
          onQuickTextChange={setQuickText}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-white border border-slate-200 rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">뽑을 인원</label>
          <input
            type="number"
            min={1}
            max={Math.max(1, names.length)}
            value={pickCount}
            onChange={(e) => setPickCount(Math.max(1, Number(e.target.value)))}
            className="w-20 px-2 py-1.5 border border-slate-300 rounded-md"
          />
        </div>
        <button
          onClick={pick}
          disabled={spinning || names.length === 0}
          className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:bg-slate-300"
        >
          {spinning ? '뽑는 중...' : '뽑기'}
        </button>
        <button
          onClick={pickAllOrder}
          disabled={spinning || names.length === 0}
          className="px-4 py-2 border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50"
        >
          전체 순서 섞기
        </button>
        <span className="text-sm text-slate-600">대상 {names.length}명</span>
      </div>

      {result.length > 0 && (
        <div className="p-6 bg-white border border-slate-200 rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {result.map((name, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-md border border-slate-200"
              >
                <div className="w-8 h-8 flex items-center justify-center bg-slate-900 text-white rounded-full font-bold text-sm">
                  {i + 1}
                </div>
                <div className="text-lg font-medium text-slate-800">{name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
