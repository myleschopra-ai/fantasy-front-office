from pathlib import Path

p = Path('js/mock-draft-v4.js')
s = p.read_text()

old = '''  function ensureProviderPolling() {
    stopProviderPolling();
    if (state.mode !== "live" || !providerEligible()) return;
    state.providerPoller = SleeperDraft.createPoller(
      () => syncSleeperDraft({ manual: false }),
      { intervalMs: 8000, isVisible: () => document.visibilityState !== "hidden" },
    );
    state.providerPoller.start();
  }
'''
new = '''  function ensureProviderPolling({ immediate = true } = {}) {
    stopProviderPolling();
    if (state.mode !== "live" || !providerEligible()) return;
    state.providerPoller = SleeperDraft.createPoller(
      () => syncSleeperDraft({ manual: false }),
      { intervalMs: 8000, isVisible: () => document.visibilityState !== "hidden" },
    );
    state.providerPoller.start({ immediate });
  }
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'function ensureProviderPolling({ immediate = true } = {})' not in s:
    raise SystemExit('ensureProviderPolling marker not found')

# A manual/binding sync has already fetched the provider; don't immediately fetch again.
s = s.replace('.then(() => ensureProviderPolling());', '.then(() => ensureProviderPolling({ immediate: false }));')

p.write_text(s)
print('Sleeper poll cadence fixed')
