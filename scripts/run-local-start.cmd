@echo off
cd /d "%~dp0.."
npm run start -- -p 3000 > dev-server-stable.log 2> dev-server-stable.err.log
