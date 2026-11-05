MUSIC SELECTOR — DEMO 01

Local demo
Run: python3 serve.py
Open: http://127.0.0.1:8000/
Click the record to authorize Spotify, then click again to play.
The Spotify app must register http://127.0.0.1:8000/callback.
Full playback requires an authorized Spotify Premium account.
Opening index.html directly as a file uses the original preview playback.

Files
index.html: interface, catalog and recommendation rules.
spotify-playback.js: Spotify Web Playback SDK and OAuth PKCE.
serve.py: local web server and authorization callback route.
imports/: source playlist metadata.

GitHub Pages
Serve index.html from the repository root. Register the exact deployed
https://<username>.github.io/<repository>/index.html address in Spotify's
Redirect URIs before signing in from the hosted page.
The public Spotify Client ID is included in spotify-playback.js.
No Client Secret is used. OAuth tokens are stored in browser sessionStorage,
not in the repository. Local backups and language review exports are excluded.

Controls
Entering the experience resets memory to longest, action to its lightest
level, and alternatives to none. Recommendation language proportions follow
five memory levels; action controls queue interaction; alternatives retain
0, 2, 6 or 8 candidates. Likes and saved items stay in this browser.
