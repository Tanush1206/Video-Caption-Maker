@echo off
rem Lets `vcm start` work from cmd and PowerShell alike, whatever the
rem execution policy: it runs the PowerShell script beside it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vcm.ps1" %*
