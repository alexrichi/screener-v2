export type MigrationStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export interface Migration {
  /** Schema revision this step produces; one higher than the previous step. */
  schema: number;
  run(storage: MigrationStorage): void;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: number[];
  status: 'current' | 'upgraded' | 'newer' | 'failed';
  error?: string;
}
