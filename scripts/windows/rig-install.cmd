@echo off
rem One-click install of the Busselton AC tracks on this PC (docs\rig-install.md).
rem Double-click it. Runs rig-install.ps1 with ExecutionPolicy Bypass, so no PowerShell setup is needed.
rem Works next to rig-install.ps1 (repo or kit) and as "Install Busselton.cmd" in the share top folder.
rem Extra arguments go through, e.g.  rig-install.cmd -DryRun   or   rig-install.cmd -InstallTask
setlocal
set "PS1=%~dp0rig-install.ps1"
if not exist "%PS1%" set "PS1=%~dp0rig\scripts\windows\rig-install.ps1"
if not exist "%PS1%" goto missing
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
:missing
echo Can not find rig-install.ps1 next to this file, or in rig\scripts\windows under it.
echo Publish the kit to the share first: rig-install.ps1 -PublishKit from a repo checkout.
pause
exit /b 1
