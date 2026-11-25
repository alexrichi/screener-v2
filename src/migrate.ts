import { runMigrations } from './lib/migrations';

// Runs before any other app module is evaluated: several modules read
// localStorage at import time (the alert log and rules, for example), so the
// storage must already be at the current schema.
runMigrations(window.localStorage);
