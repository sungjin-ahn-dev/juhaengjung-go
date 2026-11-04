@echo off
rem Double-click: build the submission APK (pleosRelease) and copy it to <repo>\apk\. Log: build_log.txt
call "%~dp0build.bat" release
pause
