import { useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { exportBackup, importBackupFromFile } from '../lib/backup';
import defaultProblemDeck from '../data/idioms.json';
import idiomInitialProblemDeck from '../data/idiom_initials.json';
import idiomMeaningQuizDeck from '../data/idiom_meaning_quiz.json';
import proverbProblemDeck from '../data/proverbs.json';
import grade3ProblemDeck from '../data/grade3_vocab.json';
import grade4ProblemDeck from '../data/grade4_vocab.json';
import grade5ProblemDeck from '../data/grade5_vocab.json';
import grade6ProblemDeck from '../data/grade6_vocab.json';

type PrintableProblem = {
  phrase: string;
  meaning: string;
  hint?: string;
};

type ProblemPack = {
  id: string;
  name: string;
  description: string;
  problems: PrintableProblem[];
};

function readString(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizePrintableProblems(input: unknown): PrintableProblem[] {
  const source = Array.isArray(input) ? input : [];
  return source.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const word = readString(raw, ['word', 'term']);
    const definition = readString(raw, ['definition']);
    const example = readString(raw, ['example']);
    const hint = readString(raw, ['hint', 'category', 'type']) || undefined;

    if (word && definition) {
      return [{ phrase: definition, meaning: example ? `${word}\n예문: ${example}` : word, hint }];
    }

    const phrase = readString(raw, ['phrase', 'question', 'quiz', 'title']);
    const answer = readString(raw, ['answer', 'meaning', 'description']);
    const explanation = readString(raw, ['meaning', 'description']);
    const meaning = answer && explanation && answer !== explanation ? `${answer}\n뜻: ${explanation}` : answer;
    if (!phrase || !meaning) return [];
    return [{ phrase, meaning, hint }];
  });
}

const defaultProblemPacks: ProblemPack[] = [
  {
    id: 'idiom',
    name: '사자성어 기본팩',
    description: '사자성어와 뜻을 함께 확인하는 기본 문제팩입니다.',
    problems: normalizePrintableProblems(defaultProblemDeck),
  },
  {
    id: 'idiom-initials',
    name: '사자성어 기본팩(초성)',
    description: '뜻과 초성을 보고 사자성어를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(idiomInitialProblemDeck),
  },
  {
    id: 'idiom-meaning-quiz',
    name: '사자성어 기본팩(사자성어 맞추기)',
    description: '뜻을 보고 해당 사자성어를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(idiomMeaningQuizDeck),
  },
  {
    id: 'proverb',
    name: '속담 기본팩',
    description: '초성/빈칸 힌트로 속담을 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(proverbProblemDeck),
  },
  {
    id: 'grade3-vocab',
    name: '3학년 필수 어휘',
    description: '뜻을 보고 3학년 필수 어휘를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(grade3ProblemDeck),
  },
  {
    id: 'grade4-vocab',
    name: '4학년 필수 어휘',
    description: '뜻을 보고 4학년 필수 어휘를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(grade4ProblemDeck),
  },
  {
    id: 'grade5-vocab',
    name: '5학년 필수 어휘',
    description: '뜻을 보고 5학년 필수 어휘를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(grade5ProblemDeck),
  },
  {
    id: 'grade6-vocab',
    name: '6학년 필수 어휘',
    description: '뜻을 보고 6학년 필수 어휘를 맞히는 문제팩입니다.',
    problems: normalizePrintableProblems(grade6ProblemDeck),
  },
];

export default function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewPackId, setPreviewPackId] = useState<string | null>(null);
  const previewPack = useMemo(
    () => defaultProblemPacks.find((pack) => pack.id === previewPackId) ?? null,
    [previewPackId],
  );

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

  async function resetAll() {
    if (!confirm('정말 모든 데이터를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    await db.delete();
    location.reload();
  }

  return (
    <div>
      <h1 className="no-print text-xl font-bold text-slate-800 mb-4">설정</h1>

      <section className="no-print p-4 bg-white border border-slate-200 rounded-lg mb-4">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold mb-2">단어 서바이벌 기본 문항 보기/출력</h2>
            <p className="text-sm text-slate-600">
              문제팩을 클릭하면 A4 미리보기 모달로 열리고, 보이는 화면 그대로 출력할 수 있습니다.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {defaultProblemPacks.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => setPreviewPackId(pack.id)}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-900 hover:bg-white hover:shadow-sm"
            >
              <div className="text-sm font-black text-slate-900">{pack.name}</div>
              <div className="mt-2 text-xs leading-relaxed text-slate-500">{pack.description}</div>
              <div className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                {pack.problems.length}문항 보기
              </div>
            </button>
          ))}
        </div>
      </section>

      {previewPack && (
        <div className="print-modal fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm no-print"
            onClick={() => setPreviewPackId(null)}
            aria-label="문제팩 미리보기 닫기"
          />
          <div className="print-modal-panel relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold tracking-[0.25em] text-slate-400">A4 PREVIEW</div>
                <div className="mt-1 text-lg font-black text-slate-900">{previewPack.name}</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  A4로 출력
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPackId(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="print-modal-scroll overflow-y-auto bg-slate-100 p-4 print:bg-white print:p-0">
              <div className="print-shell mx-auto max-w-[794px] rounded-2xl bg-slate-100 p-3 print:bg-white print:p-0">
                <div className="print-area min-h-[1123px] bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:min-h-0 print:shadow-none print:ring-0">
                  <div className="border-b-2 border-slate-900 pb-4">
                    <div className="text-xs font-bold tracking-[0.35em] text-slate-500">WORD SURVIVAL PACK</div>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-3xl font-black text-slate-950">{previewPack.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{previewPack.description}</p>
                      </div>
                      <div className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
                        총 {previewPack.problems.length}문항
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-2.5">
                    {previewPack.problems.map((problem, index) => (
                      <div
                        key={`${previewPack.id}-${index}`}
                        className="break-inside-avoid rounded-xl border border-slate-200 p-4 print:rounded-none print:border-slate-300 print:p-3"
                      >
                        <div className="mb-2 flex items-start gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="whitespace-pre-line text-base font-bold leading-relaxed text-slate-900">
                              {problem.phrase}
                            </div>
                            {problem.hint && <div className="mt-1 text-xs text-slate-500">힌트: {problem.hint}</div>}
                          </div>
                        </div>
                        <div className="ml-10 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700 print:bg-white print:px-0">
                          <span className="font-bold text-slate-900">정답/뜻: </span>
                          <span className="whitespace-pre-line">{problem.meaning}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="no-print p-4 bg-white border border-slate-200 rounded-lg mb-4">
        <h2 className="font-semibold mb-2">💾 내 컴퓨터에 저장</h2>
        <p className="text-sm text-slate-600 mb-3">
          저장 위치를 선택해 학급·학생·기록을 JSON 파일로 저장합니다.
        </p>
        <button
          onClick={exportBackup}
          className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-700"
        >
          지금 저장하기
        </button>
      </section>

      <section className="no-print p-4 bg-white border border-slate-200 rounded-lg mb-4">
        <h2 className="font-semibold mb-2">📂 내 컴퓨터에서 불러오기</h2>
        <p className="text-sm text-slate-600 mb-3">
          이전에 저장한 JSON 파일로 복원합니다. 현재 데이터는 덮어써집니다.
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 border border-slate-300 rounded-md hover:bg-slate-100"
        >
          파일 선택
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          onChange={handleImport}
          className="hidden"
        />
      </section>

      <section className="no-print p-4 bg-white border border-red-200 rounded-lg">
        <h2 className="font-semibold text-red-700 mb-2">모든 데이터 삭제</h2>
        <p className="text-sm text-slate-600 mb-3">
          이 브라우저에 저장된 모든 데이터를 지웁니다.
        </p>
        <button
          onClick={resetAll}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          초기화
        </button>
      </section>
    </div>
  );
}
