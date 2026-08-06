from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
marker='</header>'
insert='''</header>\n<div style="max-width:960px;margin:10px auto 0;padding:0 20px"><a href="league-config.html" style="display:block;text-decoration:none;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 12px;color:#fbbf24;font-size:12px;font-weight:700">League Formats & Draft Settings → Sleeper dynasty, Yahoo snake, and Yahoo auction</a></div>'''
if 'league-config.html' not in s:
    if marker not in s: raise SystemExit('header marker missing')
    s=s.replace(marker,insert,1)
p.write_text(s,encoding='utf-8')
