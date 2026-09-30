@echo off
chcp 65001 > nul
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행: 필요한 파일을 설치합니다...
  call npm install
)
echo 브라우저에서 게임이 열립니다. 이 창을 닫으면 게임도 꺼져요.
call npx vite --open
