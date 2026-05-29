export type ProblemCard = {
  phrase: string;
  meaning: string;
  hint?: string;
};

export type SavedProblemPack = {
  id: string;
  name: string;
  problems: ProblemCard[];
  createdAt: number;
};

export const SAVED_PROBLEM_PACKS_KEY = 'word-survival:saved-problem-packs';

function readString(raw: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function normalizeProblemPack(input: unknown): ProblemCard[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).items)
      ? ((input as Record<string, unknown>).items as unknown[])
      : [];

  return source.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const word = readString(raw, ['word', 'term']);
    const definition = readString(raw, ['definition']);
    const example = readString(raw, ['example']);
    const hint = readString(raw, ['hint', 'category', 'type']) || undefined;

    if (word && definition) {
      return [{
        phrase: definition,
        meaning: example ? `${word}\n예문: ${example}` : word,
        hint,
      }];
    }

    const phrase = readString(raw, ['phrase', 'question', 'quiz', 'title']);
    const answer = readString(raw, ['answer', 'meaning', 'description']);
    const explanation = readString(raw, ['meaning', 'description']);
    const meaning = answer && explanation && answer !== explanation
      ? `${answer}\n뜻: ${explanation}`
      : answer;
    if (!phrase || !meaning) return [];
    return [{ phrase, meaning, hint }];
  });
}

function isProblemCard(value: unknown): value is ProblemCard {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.phrase === 'string' && typeof raw.meaning === 'string';
}

export function loadSavedProblemPacks(): SavedProblemPack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PROBLEM_PACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const pack = entry as Record<string, unknown>;
      if (typeof pack.id !== 'string' || typeof pack.name !== 'string' || !Array.isArray(pack.problems)) {
        return [];
      }
      const problems = pack.problems.filter(isProblemCard);
      if (problems.length === 0) return [];
      return [{
        id: pack.id,
        name: pack.name,
        problems,
        createdAt: typeof pack.createdAt === 'number' ? pack.createdAt : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

export function saveProblemPacks(packs: SavedProblemPack[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SAVED_PROBLEM_PACKS_KEY, JSON.stringify(packs));
}

export function makeSavedPackId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
