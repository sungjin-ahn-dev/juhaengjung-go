@echo off
rem Double-click: install the pleos APK on the running emulator, forward PC port 8787, start the app. Log: build_log.txt
call "%~dp0build.bat" install
pause
