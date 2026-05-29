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
import {
  loadSavedProblemPacks,
  makeSavedPackId,
  normalizeProblemPack,
  saveProblemPacks,
  type SavedProblemPack,
} from '../lib/problemPacks';

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

const CUSTOM_PACK_TEMPLATE = `[
  {
    "question": "뜻을 보고 알맞은 사자성어를 말해 보세요.",
    "answer": "사자성어 정답",
    "hint": "사자성어"
  },
  {
    "word": "낱말 정답",
    "definition": "이 뜻을 가진 낱말은 무엇일까요?",
    "example": "예문이 있으면 함께 저장됩니다.",
    "hint": "어휘"
  }
]`;

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

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function formatPrintableText(value: string) {
  return escapeHtml(value).split('\n').join('<br />');
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
  const [savedProblemPacks, setSavedProblemPacks] = useState<SavedProblemPack[]>(() => loadSavedProblemPacks());
  const [previewPackId, setPreviewPackId] = useState<string | null>(null);
  const [printRangeStart, setPrintRangeStart] = useState(1);
  const [printRangeEnd, setPrintRangeEnd] = useState<number | null>(null);
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [showAllSavedProblemPacks, setShowAllSavedProblemPacks] = useState(false);
  const [packName, setPackName] = useState('');
  const [packJson, setPackJson] = useState(CUSTOM_PACK_TEMPLATE);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const previewPacks = useMemo(
    () => [
      ...defaultProblemPacks,
      ...savedProblemPacks.map((pack) => ({
        id: pack.id,
        name: pack.name,
        description: '교사가 브라우저에 직접 저장한 사용자 문제팩입니다.',
        problems: pack.problems,
      })),
    ],
    [savedProblemPacks],
  );
  const previewPack = useMemo(
    () => previewPacks.find((pack) => pack.id === previewPackId) ?? null,
    [previewPackId, previewPacks],
  );
  const previewProblems = useMemo(() => {
    if (!previewPack) return [];
    if (previewPack.problems.length === 0) return [];
    const startIndex = Math.max(0, Math.min(printRangeStart - 1, previewPack.problems.length - 1));
    const endIndex = Math.max(startIndex + 1, Math.min(printRangeEnd ?? previewPack.problems.length, previewPack.problems.length));
    return previewPack.problems.slice(startIndex, endIndex);
  }, [previewPack, printRangeEnd, printRangeStart]);
  const visibleSavedProblemPacks = useMemo(
    () => (showAllSavedProblemPacks ? savedProblemPacks : savedProblemPacks.slice(0, 5)),
    [savedProblemPacks, showAllSavedProblemPacks],
  );
  const editorStatus = useMemo(() => {
    try {
      const parsed = JSON.parse(packJson) as unknown;
      const problems = normalizeProblemPack(parsed);
      if (problems.length === 0) {
        return { valid: false, message: '유효한 문제를 찾지 못했습니다.' };
      }
      return { valid: true, message: `${problems.length}문항을 저장할 수 있습니다.` };
    } catch (error) {
      return { valid: false, message: `JSON 오류: ${(error as Error).message}` };
    }
  }, [packJson]);

  function startNewPackEditor() {
    setEditingPackId(null);
    setPackName('');
    setPackJson(CUSTOM_PACK_TEMPLATE);
    setPackNotice(null);
  }

  function startEditPack(pack: SavedProblemPack) {
    setEditingPackId(pack.id);
    setPackName(pack.name);
    setPackJson(JSON.stringify(pack.problems, null, 2));
    setPackNotice(null);
  }

  function persistSavedProblemPacks(nextPacks: SavedProblemPack[]) {
    setSavedProblemPacks(nextPacks);
    saveProblemPacks(nextPacks);
  }

  function saveCustomProblemPack() {
    const name = packName.trim();
    if (!name) {
      setPackNotice('문제팩 이름을 먼저 입력해 주세요.');
      return;
    }

    try {
      const parsed = JSON.parse(packJson) as unknown;
      const problems = normalizeProblemPack(parsed);
      if (problems.length === 0) {
        setPackNotice('저장 가능한 문제를 찾지 못했습니다.');
        return;
      }

      const existing = editingPackId
        ? savedProblemPacks.find((pack) => pack.id === editingPackId)
        : savedProblemPacks.find((pack) => pack.name === name);
      const nextPack: SavedProblemPack = {
        id: existing?.id ?? makeSavedPackId(),
        name,
        problems,
        createdAt: existing?.createdAt ?? Date.now(),
      };
      const nextPacks = existing
        ? savedProblemPacks.map((pack) => (pack.id === existing.id ? nextPack : pack))
        : [...savedProblemPacks, nextPack];
      persistSavedProblemPacks(nextPacks);
      setEditingPackId(nextPack.id);
      setPackNotice(`"${name}" 문제팩을 저장했습니다.`);
    } catch (error) {
      setPackNotice(`JSON을 저장하지 못했습니다: ${(error as Error).message}`);
    }
  }

  function deleteCustomProblemPack(pack: SavedProblemPack) {
    if (!confirm(`"${pack.name}" 문제팩을 삭제할까요?`)) return;
    const nextPacks = savedProblemPacks.filter((entry) => entry.id !== pack.id);
    persistSavedProblemPacks(nextPacks);
    if (editingPackId === pack.id) {
      startNewPackEditor();
    }
    if (previewPackId === pack.id) {
      setPreviewPackId(null);
    }
  }

  function openPreviewPack(packId: string) {
    const pack = previewPacks.find((entry) => entry.id === packId);
    setPreviewPackId(packId);
    setPrintRangeStart(1);
    setPrintRangeEnd(pack && pack.problems.length > 0 ? pack.problems.length : null);
  }

  function closePreviewPack() {
    setPreviewPackId(null);
    setPrintRangeStart(1);
    setPrintRangeEnd(null);
  }

  function handlePreviewPrint() {
    if (!previewPack || previewProblems.length === 0) return;

    const cards = previewProblems
      .map((problem, index) => {
        const number = printRangeStart + index;
        const hintHtml = problem.hint
          ? `<div class="hint">힌트: ${formatPrintableText(problem.hint)}</div>`
          : '';

        return `
          <article class="card">
            <div class="card-head">
              <div class="number">${number}</div>
              <div class="question-wrap">
                <div class="question">${formatPrintableText(problem.phrase)}</div>
                ${hintHtml}
              </div>
            </div>
            <div class="answer">
              <span class="answer-label">정답/뜻:</span>
              <span>${formatPrintableText(problem.meaning)}</span>
            </div>
          </article>
        `;
      })
      .join('');

    const printHtml = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(previewPack.name)} 출력</title>
    <style>
      @page {
        size: A4;
        margin: 12mm;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #0f172a;
        font-family: "Noto Sans KR", "Malgun Gothic", sans-serif;
      }

      body {
        padding: 0;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .card {
        break-inside: avoid;
        border: 1px solid #cbd5e1;
        padding: 12px;
        min-height: 0;
      }

      .card-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .number {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        min-width: 28px;
        height: 28px;
        border-radius: 999px;
        background: #0f172a;
        color: #ffffff;
        font-size: 12px;
        font-weight: 800;
      }

      .question-wrap {
        flex: 1;
        min-width: 0;
      }

      .question {
        font-size: 16px;
        font-weight: 800;
        line-height: 1.55;
        white-space: normal;
        word-break: keep-all;
      }

      .hint {
        margin-top: 6px;
        font-size: 12px;
        color: #475569;
      }

      .answer {
        margin-left: 40px;
        margin-top: 10px;
        font-size: 14px;
        line-height: 1.6;
        color: #334155;
        word-break: keep-all;
      }

      .answer-label {
        font-weight: 800;
        color: #0f172a;
      }
    </style>
  </head>
  <body>
    <main class="grid">${cards}</main>
  </body>
</html>`;

    const existingFrame = document.getElementById('problem-pack-print-frame');
    if (existingFrame) {
      existingFrame.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'problem-pack-print-frame';
    iframe.title = 'problem-pack-print-frame';
    iframe.setAttribute(
      'style',
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;',
    );
    document.body.appendChild(iframe);

    const frameDocument = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!frameDocument || !iframe.contentWindow) {
      iframe.remove();
      alert('인쇄 준비 중 문제가 생겼습니다. 다시 시도해 주세요.');
      return;
    }

    frameDocument.open();
    frameDocument.write(printHtml);
    frameDocument.close();

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 300);
    };

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        cleanup();
      }
    };
  }

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
    <div className="settings-page">
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
          {previewPacks.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => openPreviewPack(pack.id)}
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

      <section className="no-print p-4 bg-white border border-slate-200 rounded-lg mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold mb-2">직접 만든 문제팩 관리</h2>
            <p className="text-sm text-slate-600">
              JSON 파일을 올리지 않아도 여기서 문제 JSON을 직접 작성해 브라우저에 저장할 수 있습니다. 저장한 문제팩은 단어 서바이벌 문제팩 목록에 바로 나타납니다.
            </p>
          </div>
          <button
            type="button"
            onClick={startNewPackEditor}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            새 문제팩
          </button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-800">
              {editingPackId ? '문제팩 수정' : '새 문제팩 작성'}
            </div>
            <div className="space-y-3">
              <label className="block">
                <div className="mb-1 text-sm font-medium text-slate-700">문제팩 이름</div>
                <input
                  type="text"
                  value={packName}
                  onChange={(e) => setPackName(e.target.value)}
                  placeholder="예: 6학년 사회 어휘"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-slate-500"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-sm font-medium text-slate-700">문제 JSON</div>
                <textarea
                  value={packJson}
                  onChange={(e) => setPackJson(e.target.value)}
                  spellCheck={false}
                  className="min-h-[340px] w-full rounded-xl border border-slate-300 bg-slate-950 px-3 py-3 font-mono text-sm leading-6 text-slate-100 focus:outline-none focus:border-slate-400"
                />
              </label>
              <div className={`rounded-xl px-3 py-2 text-sm ${editorStatus.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                {editorStatus.message}
              </div>
              {packNotice && (
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{packNotice}</div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveCustomProblemPack}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  브라우저에 저장
                </button>
                <button
                  type="button"
                  onClick={startNewPackEditor}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  새로 쓰기
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <div className="font-semibold text-slate-800">지원 JSON 형식</div>
                <div className="mt-2">`question` / `answer` / `hint` 형식과 `word` / `definition` / `example` 형식을 모두 지원합니다.</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800">저장된 사용자 문제팩</div>
              <div className="text-xs text-slate-500">{savedProblemPacks.length}개</div>
            </div>
            {savedProblemPacks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                아직 저장한 사용자 문제팩이 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleSavedProblemPacks.map((pack) => (
                  <div key={pack.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900">{pack.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{pack.problems.length}문항</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPreviewPack(pack.id)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          보기
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditPack(pack)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCustomProblemPack(pack)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {savedProblemPacks.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSavedProblemPacks((value) => !value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    {showAllSavedProblemPacks ? '접기' : `${savedProblemPacks.length - 5}개 더 보기`}
                  </button>
                )}
              </div>
            )}
            <details className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <summary className="cursor-pointer select-none font-semibold text-slate-800">
                LLM 활용해서 만드는 법
              </summary>
              <div className="mt-3 space-y-3">
                <p>
                  ChatGPT 같은 LLM에게 아래 프롬프트를 붙여넣고 주제와 문항 수만 바꾸면 됩니다.
                  결과는 설명 없이 JSON 배열만 받아서 왼쪽 문제 JSON 칸에 그대로 붙여넣으면 됩니다.
                </p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <div className="font-semibold">추천 사용 순서</div>
                  <ol className="mt-1 list-decimal pl-4 space-y-1">
                    <li>주제와 문항 수를 정합니다.</li>
                    <li>LLM에게 JSON 배열만 출력하라고 요청합니다.</li>
                    <li>생성된 JSON을 복사해 문제 JSON 칸에 붙여넣습니다.</li>
                    <li>저장 전에 문항 수 안내가 정상으로 뜨는지 확인합니다.</li>
                  </ol>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 leading-relaxed text-slate-100">{`초등학생용 단어 서바이벌 문제 JSON을 만들어줘.
주제: 속담
문항 수: 20개
난이도: 초등학교 4~6학년
규칙:
- 반드시 JSON 배열만 출력해.
- 각 항목은 question, answer, hint 키만 사용해.
- question에는 학생에게 보여줄 문제를 넣어.
- answer에는 교사가 확인할 정답이나 뜻을 넣어.
- hint에는 문제 종류를 짧게 넣어. 예: 속담, 사자성어, 어휘
- 마크다운 코드블록이나 추가 설명은 쓰지 마.`}</pre>
                <div>
                  <div className="font-semibold text-slate-800">지원 JSON 예시</div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 leading-relaxed text-slate-100">{`[
  {
    "question": "가는 말이 고와야 오는 말이 곱다",
    "answer": "상대에게 좋게 말해야 상대도 좋게 말한다.",
    "hint": "속담"
  },
  {
    "word": "고진감래",
    "definition": "고생 끝에 즐거움이 찾아온다는 뜻",
    "example": "힘든 연습 끝에 대회에서 상을 받으니 고진감래를 느꼈다.",
    "hint": "사자성어"
  }
]`}</pre>
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>

      {previewPack && (
        <div className="print-modal fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm no-print"
            onClick={closePreviewPack}
            aria-label="문제팩 미리보기 닫기"
          />
          <div className="print-modal-panel relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-xs font-bold tracking-[0.25em] text-slate-400">A4 PREVIEW</div>
                <div className="mt-1 text-lg font-black text-slate-900">{previewPack.name}</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="font-semibold text-slate-700">출력 범위</span>
                  <input
                    type="number"
                    min={1}
                    max={previewPack.problems.length || 1}
                    value={printRangeStart}
                    onChange={(e) => setPrintRangeStart(Math.max(1, Math.min(parseInt(e.target.value, 10) || 1, previewPack.problems.length || 1)))}
                    className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm text-slate-700 focus:outline-none focus:border-slate-500"
                  />
                  <span>~</span>
                  <input
                    type="number"
                    min={printRangeStart}
                    max={previewPack.problems.length || 1}
                    value={printRangeEnd ?? previewPack.problems.length}
                    onChange={(e) => {
                      const nextValue = parseInt(e.target.value, 10) || previewPack.problems.length;
                      setPrintRangeEnd(Math.max(printRangeStart, Math.min(nextValue, previewPack.problems.length || 1)));
                    }}
                    className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-sm text-slate-700 focus:outline-none focus:border-slate-500"
                  />
                  <span className="text-xs text-slate-400">/ {previewPack.problems.length}문항</span>
                </div>
                <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePreviewPrint}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  A4로 출력
                </button>
                <button
                  type="button"
                  onClick={closePreviewPack}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  닫기
                </button>
                </div>
              </div>
            </div>

            <div className="print-modal-scroll overflow-y-auto bg-slate-100 p-4 print:bg-white print:p-0">
              <div className="print-shell mx-auto max-w-[794px] rounded-2xl bg-slate-100 p-3 print:bg-white print:p-0">
                <div className="print-area min-h-[1123px] bg-white p-8 text-slate-900 shadow-sm ring-1 ring-slate-200 print:min-h-0 print:shadow-none print:ring-0">
                  <div className="no-print border-b-2 border-slate-900 pb-4">
                    <div className="text-xs font-bold tracking-[0.35em] text-slate-500">WORD SURVIVAL PACK</div>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-3xl font-black text-slate-950">{previewPack.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{previewPack.description}</p>
                      </div>
                      <div className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
                        총 {previewProblems.length}문항
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 print:mt-0 print:grid-cols-2 print:gap-2.5">
                    {previewProblems.map((problem, index) => (
                      <div
                        key={`${previewPack.id}-${printRangeStart + index}`}
                        className="break-inside-avoid rounded-xl border border-slate-200 p-4 print:rounded-none print:border-slate-300 print:p-3"
                      >
                        <div className="mb-2 flex items-start gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
                            {printRangeStart + index}
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
