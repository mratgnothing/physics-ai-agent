@echo off
cd /d "%~dp0"
"D:\Program Files\nodejs\node.exe" server.js >> server.out.log 2>> server.err.log
