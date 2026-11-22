# BloxWeb
Deploy: push to GitHub → Render "New Web Service" (or Blueprint via render.yaml). Build `npm install`, start `node server.js`.
Set env `ADMIN_PASSWORD`; then open `/admin` to change it, view stats, and upload a `.rbxlx` to replace the game.
Data lives in `data.json`; add a Render Disk and `DATA_FILE=/var/data/data.json` to keep accounts across deploys.
