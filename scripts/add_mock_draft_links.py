from pathlib import Path

links = {
    'index.html': '<div style="max-width:960px;margin:10px auto 0;padding:0 20px"><a href="mock-draft.html" style="display:block;text-decoration:none;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;color:#2dd4bf;font-size:12px;font-weight:700">Mock Draft Companion → live manual mock tracking, roster fit, tier cliffs, and next-pick availability</a></div>',
    'draft.html': '<div style="max-width:1180px;margin:10px auto 0;padding:0 18px"><a href="mock-draft.html" style="display:block;text-decoration:none;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;color:#2dd4bf;font-size:12px;font-weight:700">Open Mock Draft Companion → provider-independent snake draft advisor</a></div>'
}
for name, link in links.items():
    p=Path(name)
    text=p.read_text(encoding='utf-8')
    if 'mock-draft.html' in text:
        continue
    marker='</header>'
    if marker not in text:
        raise SystemExit(f'{name}: header marker missing')
    text=text.replace(marker, marker+'\n'+link, 1)
    p.write_text(text, encoding='utf-8')
print('Mock draft links applied')
