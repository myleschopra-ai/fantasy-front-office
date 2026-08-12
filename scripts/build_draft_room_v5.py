from pathlib import Path

out = Path('draft-room-v5.html')
src = out if out.exists() else Path('draft-room-v3.html')
html = src.read_text(encoding='utf-8')

if 'css/draft-room-ios-v5.css' not in html:
    html = html.replace('</head>', '<link rel="stylesheet" href="css/draft-room-ios-v5.css?v=5" />\n<link rel="stylesheet" href="css/draft-room-ios-v5-layout-fix.css?v=5.1" />\n</head>')
elif 'css/draft-room-ios-v5-layout-fix.css' not in html:
    html = html.replace('</head>', '<link rel="stylesheet" href="css/draft-room-ios-v5-layout-fix.css?v=5.1" />\n</head>')
if 'js/draft-room-ios-v5.js' not in html:
    html = html.replace('</body>', '<script src="js/draft-room-ios-v5.js?v=5"></script>\n</body>')
html = html.replace('<title>Front Office — Draft Room</title>', '<title>Front Office — Draftboard</title>')
html = html.replace('<meta name="theme-color" content="#070a10" />', '<meta name="theme-color" content="#0b1020" />\n<meta name="apple-mobile-web-app-capable" content="yes" />\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
if 'js/draft-review.js' not in html:
    html = html.replace('<script src="js/draft-intelligence.js"></script>', '<script src="js/draft-intelligence.js"></script><script src="js/draft-review.js"></script><script src="js/draft-calibration.js"></script>')
out.write_text(html, encoding='utf-8')

route = Path('draft.html')
route_html = route.read_text(encoding='utf-8')
route_html = route_html.replace('draft-room-v3.html', 'draft-room-v5.html')
route_html = route_html.replace('Loading isolated redesign candidate.', 'Opening iOS-first draftboard.')
route.write_text(route_html, encoding='utf-8')
print('built draft-room-v5.html and updated draft.html')
