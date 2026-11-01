@echo off
rem Double-click to let Vektra install its updates itself. Add -Uninstall to undo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-updater.ps1" %*
pause
