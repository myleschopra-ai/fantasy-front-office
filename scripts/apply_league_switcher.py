from pathlib import Path

for name in ['index.html', 'draft.html', 'league-config.html']:
    path = Path(name)
    text = path.read_text(encoding='utf-8')
    tag = '<script src="js/league-switcher.js"></script>'
    if tag not in text:
        marker = '</body>'
        if marker not in text:
            raise SystemExit(f'{name}: body marker missing')
        text = text.replace(marker, tag + marker, 1)
        path.write_text(text, encoding='utf-8')
print('Persistent league switcher applied')
