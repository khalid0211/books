import sqlite3
from pathlib import Path

backup = sorted(Path('backups').glob('before-classification-*.db'))[-1]
with sqlite3.connect(backup.resolve().as_uri() + '?mode=ro', uri=True) as before, sqlite3.connect('file:prisma/dev.db?mode=ro', uri=True) as after:
    columns = [row[1] for row in before.execute('PRAGMA table_info(Book)')]
    query = 'SELECT ' + ','.join('"' + c + '"' for c in columns) + ' FROM Book ORDER BY id'
    old = before.execute(query).fetchall()
    current = after.execute(query).fetchall()
    assert old == current, 'Original book data differs from backup'
    print(f'All {len(old)} original books match the backup, including tags and shelf locations.')
    print('Categories:', after.execute('SELECT COUNT(*) FROM Category').fetchone()[0])
