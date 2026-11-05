# Momentum

Parkour speed trial game, served by a tiny Node server (no npm install needed).

## Run
1. Install Node.js 14 or newer: https://nodejs.org
2. In this folder run: `node server.js` (or `npm start`, or double-click `start.bat` on Windows / run `./start.sh` on Mac/Linux)
3. Open http://localhost:3000

Use a different port: `PORT=8080 node server.js` (Windows: `set PORT=8080 && node server.js`).

## Notes
- The game loads three.js from a CDN, so you need an internet connection the first time.
- Progress (best times, ranks, shards, custom maps) is saved in your browser's localStorage for the address you use, so keep using the same port.
- Game file: `public/index.html`
