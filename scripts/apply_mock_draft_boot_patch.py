from pathlib import Path

path = Path('js/league-switcher.js')
text = path.read_text(encoding='utf-8')
old = "    if (!league.provider_league_id) showSetup(league, statusText, syncButton);\n"
new = "    // Provider setup is explicit. Mock/auction drafting must remain usable without a connected league ID.\n    // The status strip and League ID / Connection button expose setup without blocking the draft room.\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f'Expected one auto-provider setup call, found {count}')
path.write_text(text.replace(old, new), encoding='utf-8')
print('Disabled automatic provider modal on draft-room boot')
