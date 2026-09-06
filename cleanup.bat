@echo off
setlocal EnableExtensions
rem ============================================================
rem  cleanup.bat — Verified project cleanup (regenerated).
rem  Lists ONLY files confirmed empty / orphaned / junk /
rem  unreferenced after reviewing every view + script include.
rem
rem  NOT deleted on purpose:
rem    - backend/uploads/*   runtime data (may be referenced by ticket
rem                           records in the DB). Defer to manual review.
rem    - frontend/server.js  static dev server (serves views/ + assets/).
rem    - scripts referenced by backend/package.json:
rem        seed.js, scripts/seed.js, scripts/testAuth.js,
rem        resetUsers.js, migrateStudentToRequester.js
rem ============================================================
echo Removing verified-unreferenced / obsolete / junk files...
echo.

call :delfile "%~dp0tatus"
call :delfile "%~dp0nul"

call :delfile "%~dp0frontend\assets\js\auth.js"
call :delfile "%~dp0frontend\assets\js\push.js"
call :delfile "%~dp0frontend\package-lock.json"

rem ---- Dead push-notification subsystem (all files empty, no routes) ----
call :delfile "%~dp0backend\config\push.js"
call :delfile "%~dp0backend\routes\push.js"
call :delfile "%~dp0backend\controllers\pushController.js"
call :delfile "%~dp0backend\models\PushSubscription.js"
call :delfile "%~dp0backend\scripts\generate-vapid.js"

rem ---- Unreferenced backend utilities ----
call :delfile "%~dp0backend\middleware\validate.js"
call :delfile "%~dp0backend\utils\helpers.js"
call :delfile "%~dp0backend\check-port.js"

rem ---- Test / debug logs ----
call :delfile "%~dp0backend\logs\frontend-footer-test.log"
call :delfile "%~dp0backend\logs\frontend-home-test.log"
call :delfile "%~dp0backend\logs\frontend-test.log"
call :delfile "%~dp0backend\logs\server-test.log"
call :delfile "%~dp0backend\logs\server-test2.log"
call :delfile "%~dp0backend\logs\server-test3.log"
call :delfile "%~dp0backend\server.log"
call :delfile "%~dp0backend\server-e2e.log"

rem ============================================================
rem  Optional section: standalone dev/one-off scripts that are NOT
rem  referenced by any package.json script but are kept by default in
rem  case you run them manually. Remove the "rem " prefix to enable.
rem ============================================================
rem call :delfile "%~dp0backend\scripts\_test_uri.js"
rem call :delfile "%~dp0backend\scripts\diagnose.js"
rem call :delfile "%~dp0backend\scripts\migrate-statuses.js"
rem call :delfile "%~dp0backend\scripts\remove-manager.js"
rem call :delfile "%~dp0backend\scripts\reset-passwords.js"
rem call :delfile "%~dp0backend\scripts\seedAssets.js"
rem call :delfile "%~dp0backend\scripts\update-categories.js"

echo.
echo Done.
echo.
echo Remaining files under backend\uploads: (kept — runtime data)
for /r "%~dp0backend\uploads" %%F in (*) do echo   %%F
echo.
pause
goto :eof

:delfile
if exist "%~1" ( del /Q /F "%~1" && echo   DELETED  %~1 ) else ( echo   SKIPPED  %~1 )
goto :eof