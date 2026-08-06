# Yahoo League Synchronization

Yahoo private fantasy leagues require OAuth authorization. A league ID alone identifies the league but cannot authorize access to private settings, teams, or rosters.

## Runtime flow

1. The dashboard stores the Yahoo league key in browser `localStorage` without expiration.
2. The user authorizes the deployed Yahoo adapter through OAuth.
3. The dashboard requests `/yahoo/league/<league_key>/snapshot` with credentials.
4. The adapter retrieves league settings, teams, and every team roster from Yahoo.
5. The dashboard stores the normalized snapshot locally and asks the user to select their team.
6. The active league and selected team remain persistent until explicitly removed.

## Required server environment

- `YAHOO_CLIENT_ID`
- `YAHOO_CLIENT_SECRET`
- `YAHOO_REDIRECT_URI`
- `YAHOO_SESSION_SECRET`
- `DASHBOARD_ORIGIN`

The adapter must be deployed behind HTTPS with durable server-side session storage before production use. Do not place Yahoo client secrets or refresh tokens in GitHub Pages or browser storage.

## Client configuration

Open `yahoo-connect.html` and save the deployed adapter base URL. The dashboard then uses that URL for authorization and synchronization.

## Normalized snapshot

The snapshot endpoint returns:

- league key, name, season, draft status, and scoring type;
- team keys, names, manager metadata, and logos when available;
- normalized roster players with Yahoo player keys, names, NFL teams, positions, and selected positions;
- the original Yahoo payload for troubleshooting only when `include_raw=1` is supplied.

Snapshots are cached in the browser by league key and remain available between sessions. A manual **Sync Yahoo** action refreshes them.