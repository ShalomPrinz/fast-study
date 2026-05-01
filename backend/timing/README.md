# timing.db

SQLite database that records how long each pipeline step takes, used to estimate future durations.

## Schema

```sql
CREATE TABLE timing (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    operation        TEXT     NOT NULL,   -- "audio" | "transcribe" | "summarize" | "pdf"
    file_size_bytes  INTEGER  NOT NULL,   -- size of the input file
    duration_seconds REAL     NOT NULL,   -- wall-clock time for the step
    recorded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Connecting

```bash
sqlite3 backend/timing/timing.db
```

Or with the full path if you're not in the repo root:

```bash
sqlite3 /path/to/fast_study/backend/timing/timing.db
```

## Useful queries

```sql
-- View all entries (newest first)
SELECT * FROM timing ORDER BY recorded_at DESC;

-- Count entries per operation
SELECT operation, COUNT(*) AS runs FROM timing GROUP BY operation;

-- Average duration per operation
SELECT operation, ROUND(AVG(duration_seconds), 2) AS avg_sec FROM timing GROUP BY operation;

-- View entries for a specific operation
SELECT * FROM timing WHERE operation = 'transcribe';
```

## Removing entries

```sql
-- Delete a specific row by id
DELETE FROM timing WHERE id = 3;

-- Delete all entries for one operation
DELETE FROM timing WHERE operation = 'summarize';

-- Wipe everything
DELETE FROM timing;

-- Reset the auto-increment counter after a full wipe
DELETE FROM sqlite_sequence WHERE name = 'timing';
```

Always run `.quit` to exit the shell, or press `Ctrl-D`.

## Formatting tips inside sqlite3

```sql
-- Readable column display
.mode column
.headers on

-- Then run any query
SELECT * FROM timing ORDER BY recorded_at DESC;
```

## One-liners (no interactive shell)

```bash
# Print all rows
sqlite3 -column -header backend/timing/timing.db "SELECT * FROM timing;"

# Delete by id
sqlite3 backend/timing/timing.db "DELETE FROM timing WHERE id = 3;"

# Wipe all rows
sqlite3 backend/timing/timing.db "DELETE FROM timing;"
```
