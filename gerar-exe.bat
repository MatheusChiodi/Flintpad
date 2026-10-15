@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where npm >nul 2>nul || (echo Node.js/npm não encontrado. Instale o Node 22 ou superior. & pause & exit /b 1)

if not exist "node_modules" (
  echo Instalando dependências...
  call npm install --no-fund --no-audit || (echo Falha ao instalar dependências. & pause & exit /b 1)
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Baixando o Electron...
  node node_modules\electron\install.js || (echo Falha ao baixar o Electron. & pause & exit /b 1)
)

echo Fechando o Flintpad, se estiver aberto...
taskkill /im Flintpad.exe /f >nul 2>nul

if exist "release" rmdir /s /q "release"
if exist "dist" rmdir /s /q "dist"

echo Gerando o executável...
call npm run dist || (echo Falha ao gerar o executável. & pause & exit /b 1)

echo.
echo Pronto: %~dp0release
start "" explorer "%~dp0release"
pause
