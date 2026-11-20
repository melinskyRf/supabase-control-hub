@echo off
setlocal
title Configurar acesso - Control Hub
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js nao encontrado. Instale Node.js 22 ou superior.
 goto failure
)
if not exist node_modules\next\package.json (
 echo Dependencias ausentes. Execute npm install nesta pasta.
 goto failure
)
if not exist .env.local (
 call npm run setup
 if errorlevel 1 goto failure
)
call npm run check:config
if errorlevel 1 goto failure
echo.
echo CADASTRO E VERIFICACAO CONCLUIDOS.
echo Volte a http://127.0.0.1:3000 e clique em Verificar configuracao novamente.
echo Se a pagina ainda indicar pendencia, reinicie o servidor.
pause
exit /b 0
:failure
echo.
echo A configuracao nao foi concluida. O erro permanece visivel acima.
pause
exit /b 1
