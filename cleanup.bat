@echo off
setlocal EnableExtensions
echo Removing proven-unreferenced test/obsolete files...
echo.

call :delfile "%~dp0server.js"
call :delfile "%~dp0nul"
call :delfile "%~dp0package-lock.json"
call :delfile "%~dp0frontend\assets\js\auth.js"
call :delfile "%~dp0frontend\assets\js\push.js"
call :delfile "%~dp0backend\config\push.js"
call :delfile "%~dp0backend\routes\push.js"
call :delfile "%~dp0backend\controllers\pushController.js"
call :delfile "%~dp0backend\models\PushSubscription.js"
call :delfile "%~dp0backend\scripts\generate-vapid.js"
call :delfile "%~dp0backend\middleware\validate.js"
call :delfile "%~dp0backend\utils\helpers.js"
call :delfile "%~dp0backend\check-port.js"
call :delfile "%~dp0backend\scripts\_test_uri.js"
call :delfile "%~dp0backend\scripts\diagnose.js"
call :delfile "%~dp0backend\scripts\migrate-statuses.js"
call :delfile "%~dp0backend\scripts\remove-manager.js"
call :delfile "%~dp0backend\scripts\reset-passwords.js"
call :delfile "%~dp0backend\scripts\seedAssets.js"
call :delfile "%~dp0backend\scripts\update-categories.js"
call :delfile "%~dp0backend\logs\frontend-footer-test.log"
call :delfile "%~dp0backend\logs\frontend-home-test.log"
call :delfile "%~dp0backend\logs\frontend-test.log"
call :delfile "%~dp0backend\logs\server-test.log"
call :delfile "%~dp0backend\logs\server-test2.log"
call :delfile "%~dp0backend\logs\server-test3.log"
call :delfile "%~dp0backend\uploads\1787137944416-861167561.png"
call :delfile "%~dp0backend\uploads\1787810760506-916593408.docx"

echo.
echo Done. Remaining files under suspect dirs:
for /r "%~dp0backend\uploads" %%F in (*) do echo   %%F
echo.
pause
goto :eof

:delfile
if exist "%~1" ( del /Q /F "%~1" && echo   DELETED  %~1 ) else ( echo   SKIPPED  %~1 )
goto :eof