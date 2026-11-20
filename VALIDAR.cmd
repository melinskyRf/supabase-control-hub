@echo off
setlocal
cd /d "%~dp0"
echo Verificacao do Supabase Control Hub
echo.
node scripts\diagnose.mjs
if errorlevel 1 goto failure
call npm run typecheck
if errorlevel 1 goto failure
call npm run test:core
if errorlevel 1 goto failure
call npm run test:smoke
if errorlevel 1 goto failure
call npm test
if errorlevel 1 goto failure
call npm run build
if errorlevel 1 goto failure
echo.
echo VALIDACAO CONCLUIDA: tipos, testes e build aprovados.
pause
exit /b 0
:failure
echo.
echo VALIDACAO INTERROMPIDA. O erro permanece visivel acima.
pause
exit /b 1
