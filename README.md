# Canvas due

A tiny personal app: paste your Canvas calendar feed link once, and it shows everything
that's due, auto-refreshing every 5 minutes and whenever you reopen it.

## Get your link
Canvas → Calendar → Calendar Feed (bottom of the right sidebar) → copy the link.

## Run it
    node server.js          # Node 18+, no dependencies
    # open http://localhost:3000

## Host it
Any host that runs Node works (Render, Railway, Fly.io, a VPS). Start command: `node server.js`.
It reads `PORT` automatically.

**Set a passcode** when hosting publicly so strangers can't use your relay:

    PASSCODE=something-long node server.js

The app asks for it on first use and remembers it on your device.

## Why a server?
Canvas blocks browsers from reading the feed directly (CORS), so `server.js` fetches it for you.
It only accepts https links ending in `/feeds/calendars/<id>.ics`, refuses private network
addresses, and does not store or log your link (the app sends it in a POST body, not the URL).

## Add to your phone
Open the hosted URL, then Share → Add to Home Screen.
