const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'js', 'ffo-shell.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'ffo-2.css'), 'utf8');
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

if (!shell.includes("'#roster': 'roster'") || !shell.includes("'#lineup': 'lineup'")) {
  throw new Error('The unified shell must deep-link to the existing Team and Matchup dashboard views.');
}
if (!shell.includes('ffo2-bottom-nav') || !shell.includes('ffo2-menu-sheet')) {
  throw new Error('The shell must provide mobile primary navigation and an accessible More sheet.');
}
if (!shell.includes('aria-current="page"') || !shell.includes('ffo2-skip')) {
  throw new Error('The shell must expose current-page and skip-navigation semantics.');
}
if (!css.includes('env(safe-area-inset-top)') || !css.includes('env(safe-area-inset-bottom)')) {
  throw new Error('The iOS shell must account for top and bottom safe areas.');
}
if (!css.includes('@media (max-width: 767px)') || !css.includes('min-height: 44px')) {
  throw new Error('The mobile contract must include its breakpoint and minimum touch target.');
}
if (!css.includes('prefers-reduced-motion') || !css.includes(':focus-visible')) {
  throw new Error('The design system must preserve reduced-motion and visible-focus behavior.');
}

const missing = htmlFiles.filter((name) => {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  return html.includes('</body>') && !html.includes('js/ffo-shell.js');
});
if (missing.length) throw new Error(`HTML entry points missing the 2.0 shell: ${missing.join(', ')}`);

console.log('Fantasy Front Office 2.0 shell contracts passed');
