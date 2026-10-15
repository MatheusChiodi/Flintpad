@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Uso: gerar-exe.bat            pergunta o tipo (Enter ou 10 s = rápido)
rem      gerar-exe.bat rapido     pasta release\win-unpacked com o Flintpad.exe (~1 min)
rem      gerar-exe.bat portatil   arquivo único release\Flintpad <versão>.exe (~6 min, para distribuir)

where npm >nul 2>nul || (echo Node.js/npm não encontrado. Instale o Node 22 ou superior. & pause & exit /b 1)

set "MODO=%~1"
if /i "%MODO%"=="rapido" goto modo_ok
if /i "%MODO%"=="portatil" goto modo_ok
echo Como gerar o Flintpad?
echo   [1] Rápido: pasta com o Flintpad.exe (cerca de 1 minuto)
echo   [2] Portátil: um único .exe para distribuir (cerca de 6 minutos)
choice /c 12 /t 10 /d 1 /n /m "Escolha 1 ou 2 (em 10 s vai o rápido): "
if errorlevel 2 (set "MODO=portatil") else (set "MODO=rapido")
:modo_ok

if not exist "node_modules\.bin\electron-builder.cmd" (
  echo Instalando dependências...
  call npm install --no-fund --no-audit || (echo Falha ao instalar dependências. & pause & exit /b 1)
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Baixando o Electron...
  node node_modules\electron\install.js || (echo Falha ao baixar o Electron. & pause & exit /b 1)
)

echo Fechando o Flintpad, se estiver aberto...
taskkill /im Flintpad.exe /f >nul 2>nul

rem Um arquivo preso (Flintpad aberto, outra geração em andamento, antivírus) faz o
rem empacotamento falhar no meio; melhor avisar antes com uma mensagem clara.
if exist "release" (
  rmdir /s /q "release" 2>nul
  if exist "release\win-unpacked" (
    timeout /t 3 /nobreak >nul
    rmdir /s /q "release" 2>nul
  )
  if exist "release\win-unpacked" (
    echo.
    echo Não foi possível limpar a pasta release: algum arquivo está em uso.
    echo Feche o Flintpad e qualquer outra geração do executável em andamento e rode de novo.
    pause
    exit /b 1
  )
)

echo.
if /i "%MODO%"=="portatil" (
  echo Gerando o executável portátil...
  call npm run dist || goto falhou
) else (
  echo Gerando o executável rápido...
  call npm run dist:dir || goto falhou
)

echo.
if /i "%MODO%"=="portatil" (
  echo Pronto: %~dp0release
  start "" explorer "%~dp0release"
) else (
  echo Pronto: %~dp0release\win-unpacked\Flintpad.exe
  start "" explorer "%~dp0release\win-unpacked"
)
pause
exit /b 0

:falhou
echo.
echo Falha ao gerar o executável. A mensagem de erro está acima.
pause
exit /b 1
