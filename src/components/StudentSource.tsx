import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export type SourceMode = 'class' | 'quick';

interface Props {
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  classId: number | null;
  onClassChange: (id: number | null) => void;
  quickText: string;
  onQuickTextChange: (s: string) => void;
}

export function parseQuickNames(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function StudentSource({
  mode,
  onModeChange,
  classId,
  onClassChange,
  quickText,
  onQuickTextChange,
}: Props) {
  const classes = useLiveQuery(() => db.classes.orderBy('createdAt').toArray(), []);
  const [expanded, setExpanded] = useState(true);

  const quickCount = useMemo(() => parseQuickNames(quickText).length, [quickText]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div className="flex gap-2">
          <button
            onClick={() => onModeChange('class')}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              mode === 'class'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            학급에서 선택
          </button>
          <button
            onClick={() => onModeChange('quick')}
            className={`px-3 py-1.5 rounded-md text-sm transition ${
              mode === 'quick'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            직접 입력
          </button>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          {expanded ? '접기' : '펼치기'}
        </button>
      </div>

      {expanded && (
        <div className="p-4">
          {mode === 'class' ? (
            <div>
              <label className="text-sm text-slate-600 block mb-2">학급 선택</label>
              <select
                value={classId ?? ''}
                onChange={(e) =>
                  onClassChange(e.target.value ? Number(e.target.value) : null)
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:outline-none focus:border-slate-500"
              >
                <option value="">선택하세요</option>
                {classes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {classes && classes.length === 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  등록된 학급이 없습니다. 상단 메뉴 "학급"에서 만들어 주세요.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-sm text-slate-600 block mb-2">
                이름 목록 <span className="text-slate-400">(줄바꿈 또는 쉼표로 구분)</span>
              </label>
              <textarea
                value={quickText}
                onChange={(e) => onQuickTextChange(e.target.value)}
                rows={6}
                placeholder={'김민수\n이서연\n박지훈'}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono text-sm focus:outline-none focus:border-slate-500"
              />
              <div className="mt-1 text-xs text-slate-500">{quickCount}명 인식됨</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
