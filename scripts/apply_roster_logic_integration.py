from pathlib import Path

files = {
    'js/draft-intelligence.js': [
        ('const POSITIONS = ["QB", "RB", "WR", "TE"];', 'const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];'),
        ('["QB", "RB", "WR", "TE"].forEach((position) => {', '["QB", "RB", "WR", "TE", "K", "DST"].forEach((position) => {'),
    ],
    'js/mock-draft-v4.js': [
        ('const POSITIONS = ["QB", "RB", "WR", "TE"];', 'const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];'),
        ('roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 },', 'roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DST: 1, BENCH: 6 },'),
        ('QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],\n      FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],', 'QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DST: ["DST"],\n      FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],'),
    ],
}

for filename, replacements in files.items():
    path = Path(filename)
    text = path.read_text(encoding='utf-8')
    original = text
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{filename}: expected one match for {old[:60]!r}, found {count}')
        text = text.replace(old, new)
    if text == original:
        raise SystemExit(f'{filename}: no changes applied')
    path.write_text(text, encoding='utf-8')
    print(f'patched {filename}')
