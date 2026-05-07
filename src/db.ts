import Dexie, { type Table } from 'dexie';

export interface SeatSettings {
  forbiddenPairs: [number, number][];
  genderBalance: 'none' | 'strict';
  fixedSeats: { studentId: number; row: number; col: number }[];
  avoidDuplicates: boolean;
  seatLayout?: { rows: number; cols: number; activeSeats: string[] };
}

export interface RoleSettings {
  forbiddenPairs: [number, number][];
  genderBalance: 'none' | 'strict';
  avoidDuplicates: boolean;
  roleGroups?: { id: string; name: string; count: number }[];
}

export const defaultSeatSettings: SeatSettings = {
  forbiddenPairs: [],
  genderBalance: 'none',
  fixedSeats: [],
  avoidDuplicates: false,
};

export const defaultRoleSettings: RoleSettings = {
  forbiddenPairs: [],
  genderBalance: 'none',
  avoidDuplicates: false,
};

export interface ClassRoom {
  id?: number;
  name: string;
  createdAt: number;
  seatSettings?: SeatSettings;
  roleSettings?: RoleSettings;
}

export type Gender = 'M' | 'F';

export interface Student {
  id?: number;
  classId: number;
  name: string;
  number?: number;
  gender?: Gender;
  createdAt: number;
}

export interface HistoryEntry {
  id?: number;
  classId: number;
  tool:
    | 'seat'
    | 'order'
    | 'tournament'
    | 'idiom'
    | 'word-survival'
    | 'word-survival-team'
    | 'role-assignment'
    | 'cooperative-speed-quiz';
  title: string;
  payload: unknown;
  createdAt: number;
}

class ClassroomDB extends Dexie {
  classes!: Table<ClassRoom, number>;
  students!: Table<Student, number>;
  history!: Table<HistoryEntry, number>;

  constructor() {
    super('classroom-tools');
    this.version(1).stores({
      classes: '++id, name, createdAt',
      students: '++id, classId, name, number',
      history: '++id, classId, tool, createdAt',
    });
    this.version(2).stores({
      classes: '++id, name, createdAt',
      students: '++id, classId, name, number, gender',
      history: '++id, classId, tool, createdAt',
    });
  }
}

export const db = new ClassroomDB();
