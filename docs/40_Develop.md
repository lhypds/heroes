
Develop
=======


Node.js 22 or later.  

`npm install`  
`npm run dev` — the page, reloading as files change  
`npm run build` — a static site in `dist/`  
`npm run check` — every entry under `data/leads/`; add `--online` to ask each
link whether it answers  


Deploy
------

The built site is served by `vite preview` under PM2. `.env` holds the port,
the PM2 process name and the public hostname; `.env.example` has the keys.  

`./setup.sh` — copies `.env.example` to `.env` if there is none, asks for
`HOST`, installs and builds  
`./start.sh` — starts the site under PM2, or reloads it if it is running  
`./stop.sh` — stops it  
`./restart.sh` — pulls, installs, builds and restarts  
