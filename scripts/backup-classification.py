import sqlite3
from pathlib import Path
from datetime import datetime

source = Path('prisma/dev.db').resolve()
destination = Path('backups') / ('before-classification-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.db')
destination.parent.mkdir(exist_ok=True)
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
    with sqlite3.connect(destination) as dst:
        src.backup(dst)
print('Database backup:', destination)
