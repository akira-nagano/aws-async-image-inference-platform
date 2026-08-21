@echo off
setlocal
for /f "usebackq delims=" %%i in (`mise where "pipx:awscli"`) do set "AWSCLI_ROOT=%%i"
"%AWSCLI_ROOT%\awscli\Scripts\python.exe" -m awscli %*
