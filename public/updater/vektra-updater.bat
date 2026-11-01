@echo off
rem Started by Chrome for Vektra updates (see vektra-updater.ps1). Keep this file unchanged:
rem Windows reads a running batch file as it goes, and the updater may replace files here.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0vektra-updater.ps1" %*
