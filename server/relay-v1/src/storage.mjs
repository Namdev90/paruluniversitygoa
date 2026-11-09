// SPDX-License-Identifier: MIT
export class SqlMetadataStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec('CREATE TABLE IF NOT EXISTS relay_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL)');
  }
  load() { const row = this.sql.exec('SELECT json FROM relay_metadata WHERE id = 1').toArray()[0]; return row ? JSON.parse(row.json) : null; }
  save(state) { this.sql.exec('INSERT INTO relay_metadata (id,json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',JSON.stringify(state)); }
}
