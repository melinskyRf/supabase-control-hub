@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js nao encontrado. Instale Node.js 22 ou superior e reabra esta janela.
 goto failure
)
if not exist node_modules\next\package.json (
 echo Dependencias ausentes. Execute npm install nesta pasta.
 pause
 exit /b 1
)
if not exist .env.local (
 echo Primeiro acesso: cadastre a senha neste terminal.
 call npm run setup
 if errorlevel 1 goto failure
)
call npm run check:config
if errorlevel 1 goto failure
echo.
echo Abra http://127.0.0.1:3000 quando aparecer Ready.
echo Para encerrar, pressione Ctrl+C nesta janela.
call npm run dev
if errorlevel 1 goto failure
exit /b 0
:failure
echo.
echo O servidor nao iniciou. O erro permanece visivel acima.
pause
exit /b 1
