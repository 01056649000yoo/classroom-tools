import { useState } from 'react';
import {
  db,
  defaultSeatSettings,
  type SeatSettings,
  type Student,
} from '../db';

interface Props {
  classId: number;
  students: Student[];
  settings: SeatSettings;
}

export default function SeatSettingsPanel({ classId, students, settings }: Props) {
  const [pairA, setPairA] = useState<number | ''>('');
  const [pairB, setPairB] = useState<number | ''>('');
  const [fixStudent, setFixStudent] = useState<number | ''>('');
  const [fixRow, setFixRow] = useState('');
  const [fixCol, setFixCol] = useState('');

  function studentName(sid: number) {
    return students.find((s) => s.id === sid)?.name ?? `(학생 ${sid})`;
  }

  async function update(next: Partial<SeatSettings>) {
    await db.classes.update(classId, {
      seatSettings: { ...defaultSeatSettings, ...settings, ...next },
    });
  }

  async function addForbiddenPair() {
    if (pairA === '' || pairB === '' || pairA === pairB) return;
    const exists = settings.forbiddenPairs.some(
      ([a, b]) =>
        (a === pairA && b === pairB) || (a === pairB && b === pairA),
    );
    if (exists) return;
    await update({
      forbiddenPairs: [...settings.forbiddenPairs, [pairA, pairB]],
    });
    setPairA('');
    setPairB('');
  }

  async function removePair(index: number) {
    const next = settings.forbiddenPairs.filter((_, i) => i !== index);
    await update({ forbiddenPairs: next });
  }

  async function addFixed() {
    if (fixStudent === '' || !fixRow || !fixCol) return;
    const row = Number(fixRow);
    const col = Number(fixCol);
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    const filtered = settings.fixedSeats.filter((f) => f.studentId !== fixStudent);
    await update({
      fixedSeats: [...filtered, { studentId: fixStudent, row, col }],
    });
    setFixStudent('');
    setFixRow('');
    setFixCol('');
  }

  async function removeFixed(sid: number) {
    await update({
      fixedSeats: settings.fixedSeats.filter((f) => f.studentId !== sid),
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">
          1. 짝 금지 학생
        </div>
        <p className="text-xs text-slate-500 mb-2">
          서로 옆자리가 되면 안 되는 학생 쌍을 등록합니다.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <select
            value={pairA}
            onChange={(e) => setPairA(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm"
          >
            <option value="">학생 A</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="self-center text-slate-400 text-sm">↔</span>
          <select
            value={pairB}
            onChange={(e) => setPairB(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm"
          >
            <option value="">학생 B</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={addForbiddenPair}
            disabled={pairA === '' || pairB === '' || pairA === pairB}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-700 disabled:bg-slate-300"
          >
            추가
          </button>
        </div>
        {settings.forbiddenPairs.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {settings.forbiddenPairs.map(([a, b], i) => (
              <li
                key={i}
                className="inline-flex items-center gap-2 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800"
              >
                {studentName(a)} ↔ {studentName(b)}
                <button
                  onClick={() => removePair(i)}
                  className="text-amber-500 hover:text-amber-700"
                  aria-label="삭제"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">2. 성별 배치</div>
        <p className="text-xs text-slate-500 mb-2">
          성비가 다를 때 좌석에 남녀를 교차로 배치할지 정합니다.
        </p>
        <div className="flex gap-2">
          {(
            [
              { value: 'none', label: '상관없음' },
              { value: 'strict', label: '남녀 교차 배치' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ genderBalance: opt.value })}
              className={`px-3 py-1.5 rounded-md text-sm border transition ${
                settings.genderBalance === opt.value
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">3. 고정 자리</div>
        <p className="text-xs text-slate-500 mb-2">
          특정 학생을 미리 지정한 자리에 고정합니다. (행·열은 1부터)
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <select
            value={fixStudent}
            onChange={(e) =>
              setFixStudent(e.target.value ? Number(e.target.value) : '')
            }
            className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm"
          >
            <option value="">학생 선택</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            placeholder="행"
            value={fixRow}
            onChange={(e) => setFixRow(e.target.value)}
            className="w-16 px-2 py-1.5 border border-slate-300 rounded-md text-sm"
          />
          <input
            type="number"
            min={1}
            placeholder="열"
            value={fixCol}
            onChange={(e) => setFixCol(e.target.value)}
            className="w-16 px-2 py-1.5 border border-slate-300 rounded-md text-sm"
          />
          <button
            onClick={addFixed}
            disabled={fixStudent === '' || !fixRow || !fixCol}
            className="px-3 py-1.5 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-700 disabled:bg-slate-300"
          >
            추가
          </button>
        </div>
        {settings.fixedSeats.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {settings.fixedSeats.map((f) => (
              <li
                key={f.studentId}
                className="inline-flex items-center gap-2 px-2 py-1 bg-sky-50 border border-sky-200 rounded-md text-xs text-sky-800"
              >
                {studentName(f.studentId)} → {f.row}행 {f.col}열
                <button
                  onClick={() => removeFixed(f.studentId)}
                  className="text-sky-500 hover:text-sky-700"
                  aria-label="삭제"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">
          4. 이전 배치와 중복 방지
        </div>
        <p className="text-xs text-slate-500 mb-2">
          이전 자리 배치 기록을 참고해 같은 자리·같은 짝이 반복되지 않게 합니다.
        </p>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.avoidDuplicates}
            onChange={(e) => update({ avoidDuplicates: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm text-slate-700">이전 기록 참고해서 중복 피하기</span>
        </label>
      </div>
    </div>
  );
}
