import { db, type ClassRoom } from '../db';

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

type FileSystemFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

export type SeatResultSeat = {
  row: number;
  col: number;
  name: string;
  gender?: 'M' | 'F';
  number?: number;
};

function sanitizeFilePart(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 40) || '이름없음';
}

function formatBackupFileName(classes: ClassRoom[], exportedAt: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  const time = `${pad(exportedAt.getHours())}-${pad(exportedAt.getMinutes())}-${pad(exportedAt.getSeconds())}`;
  const className =
    classes.length === 0
      ? '학급없음'
      : classes.length === 1
        ? classes[0].name
        : '전체학급';
  return `문해력서바이벌_${date}_${sanitizeFilePart(className)}_${time}.json`;
}

async function saveBlob(blob: Blob, fileName: string) {
  const savePicker = (window as WindowWithSavePicker).showSaveFilePicker;

  if (savePicker) {
    try {
      const handle = await savePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'JSON 백업 파일',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      console.warn('파일 저장 창을 사용할 수 없어 기본 다운로드로 저장합니다.', err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportBackup() {
  const [classes, students, history] = await Promise.all([
    db.classes.toArray(),
    db.students.toArray(),
    db.history.toArray(),
  ]);
  const exportedAt = new Date();
  const payload = {
    app: 'classroom-tools',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    data: { classes, students, history },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  await saveBlob(blob, formatBackupFileName(classes, exportedAt));
}

export async function importBackupFromFile(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (parsed?.app !== 'classroom-tools' || !parsed.data) {
    throw new Error('지원하지 않는 파일 형식입니다.');
  }
  await db.transaction('rw', db.classes, db.students, db.history, async () => {
    await db.classes.clear();
    await db.students.clear();
    await db.history.clear();
    if (parsed.data.classes) await db.classes.bulkAdd(parsed.data.classes);
    if (parsed.data.students) await db.students.bulkAdd(parsed.data.students);
    if (parsed.data.history) await db.history.bulkAdd(parsed.data.history);
  });
}
