import { Pool } from 'pg';

export const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME     ?? 'codelmdb',
  user:     process.env.DB_USER     ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  max: 10,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
});

export async function initDB(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255)        NOT NULL,
        name          VARCHAR(100)        NOT NULL,
        created_at    TIMESTAMPTZ         DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS analysis_history (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code           TEXT        NOT NULL,
        language       VARCHAR(50) NOT NULL,
        score          INTEGER     NOT NULL,
        grade          CHAR(1)     NOT NULL,
        issue_count    INTEGER     NOT NULL DEFAULT 0,
        suggestion     TEXT,
        syntax_count   INTEGER     NOT NULL DEFAULT 0,
        smell_count    INTEGER     NOT NULL DEFAULT 0,
        security_count INTEGER     NOT NULL DEFAULT 0,
        analysis_type  VARCHAR(20) NOT NULL DEFAULT 'analyze',
        rewritten_code TEXT,
        improved_score INTEGER,
        improved_grade CHAR(1),
        created_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_history_user_id    ON analysis_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON analysis_history(created_at DESC);

      -- Add columns for full issue arrays and improved breakdown (safe on re-runs)
      ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS issues               JSONB;
      ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS improved_issues      JSONB;
      ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS improved_syntax_count  INTEGER;
      ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS improved_smell_count   INTEGER;
      ALTER TABLE analysis_history ADD COLUMN IF NOT EXISTS improved_security_count INTEGER;
    `);
    console.log('[DB] Tables ready');
  } finally {
    client.release();
  }
}
