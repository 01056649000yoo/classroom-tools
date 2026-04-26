import { useState } from 'react';
import {
  db,
  defaultRoleSettings,
  type RoleSettings,
  type Student,
} from '../db';

interface Props {
  classId: number;
  students: Student[];
  settings: RoleSettings;
}

export default function RoleSettingsPanel({ classId, students, settings }: Props) {
  const [pairA, setPairA] = useState<number | ''>('');
  const [pairB, setPairB] = useState<number | ''>('');

  function studentName(sid: number) {
    return students.find((s) => s.id === sid)?.name ?? `(학생 ${sid})`;
  }

  async function update(next: Partial<RoleSettings>) {
    await db.classes.update(classId, {
      roleSettings: { ...defaultRoleSettings, ...settings, ...next },
    });
  }

  async function addForbiddenPair() {
    if (pairA === '' || pairB === '' || pairA === pairB) return;
    const exists = settings.forbiddenPairs.some(
      ([a, b]) =>
        (a === pairA && b === pairB) || (a === pairB && b === pairA),
    );
    if (exists) return;
    await update({ forbiddenPairs: [...settings.forbiddenPairs, [pairA, pairB]] });
    setPairA('');
    setPairB('');
  }

  async function removePair(index: number) {
    await update({
      forbiddenPairs: settings.forbiddenPairs.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">
          1. 같은 역할 금지 학생
        </div>
        <p className="text-xs text-slate-500 mb-2">
          한 역할에 여러 명이 배정될 때, 함께 같은 역할을 맡으면 안 되는 학생 쌍을 등록합니다.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <select
            value={pairA}
            onChange={(e) => setPairA(e.target.value ? Number(e.target.value) : '')}
            className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-sm"
          >
            <option value="">학생 A</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
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
              <option key={s.id} value={s.id}>{s.name}</option>
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
          여러 명이 같은 역할에 들어갈 때 가능하면 남녀가 섞이도록 배정합니다.
        </p>
        <div className="flex gap-2">
          {([
            { value: 'none', label: '상관없음' },
            { value: 'strict', label: '남녀 섞어 배치' },
          ] as const).map((opt) => (
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
        <div className="text-sm font-semibold text-slate-700 mb-1">
          3. 이전 배치와 중복 방지
        </div>
        <p className="text-xs text-slate-500 mb-2">
          이전 역할배치 기록을 참고해 같은 학생이 같은 역할을 반복해서 맡지 않도록 합니다.
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
