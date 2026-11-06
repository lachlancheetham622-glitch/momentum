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

## Multiplayer

Every mode is multiplayer. Each mode/map is its own room, so anyone on the same
mode and map sees each other live (coloured avatar + name tag), and finishing
Time Attack / Flow / Speed runs posts to a shared top-10 shown in the top-right
panel. Press N in game to change your name.

## Deploy on Render (momentum-game.onrender.com)

1. Push this folder to a GitHub repo (`node_modules` is ignored by `.gitignore`).
2. On render.com: New > Blueprint (uses `render.yaml`), or New > Web Service with
   Build `npm install` and Start `node server.js`. Name the service `momentum-game`.
3. Your URL is `https://momentum-game.onrender.com`. WebSockets work automatically (wss).

Notes: the free plan sleeps after ~15 min idle (first visit takes ~30 s, the game
reconnects on its own). Leaderboards are saved to `data/lb.json`, which resets on
redeploy unless you add a Render Disk and set env `DATA_DIR` to its mount path.
