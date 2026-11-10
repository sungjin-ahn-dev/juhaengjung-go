@echo off
rem JHGO (juhaengjung GO!) car app - Android shell build. Log: apps\car-android\build_log.txt
rem   build.bat           build demo + pleos (web screen is built first and bundled for offline mode)
rem   build.bat install   install the pleos APK on the running emulator and forward PC server port 8787
setlocal EnableDelayedExpansion
set "HERE=%~dp0"
set "ROOT=%HERE%..\.."
set "LOG=%HERE%build_log.txt"
echo === JHGO Android build %DATE% %TIME% === > "%LOG%"

rem --- find a working JDK (JAVA_HOME may point to a removed folder) ---
if defined JAVA_HOME if not exist "%JAVA_HOME%\bin\java.exe" (
  echo [INFO] JAVA_HOME invalid: %JAVA_HOME% >> "%LOG%"
  set "JAVA_HOME="
)
if not defined JAVA_HOME (
  for /d %%D in ("%ProgramFiles%\Android\Android Studio*" "%LOCALAPPDATA%\Programs\Android Studio*" "%LOCALAPPDATA%\JetBrains\Toolbox\apps\AndroidStudio\ch-0\*" "%LOCALAPPDATA%\Programs\Android\Android Studio*") do (
    if not defined JAVA_HOME if exist "%%~D\jbr\bin\java.exe" set "JAVA_HOME=%%~D\jbr"
  )
)
if not defined JAVA_HOME (
  for /d %%D in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*" "%ProgramFiles%\Eclipse Adoptium\jdk-21*" "%ProgramFiles%\Microsoft\jdk-17*" "%ProgramFiles%\Microsoft\jdk-21*" "%ProgramFiles%\Java\jdk-17*" "%ProgramFiles%\Java\jdk-21*") do (
    if not defined JAVA_HOME if exist "%%~D\bin\java.exe" set "JAVA_HOME=%%~D"
  )
)
echo JAVA_HOME=%JAVA_HOME% >> "%LOG%"
if not defined JAVA_HOME (
  echo [ERROR] JDK not found. Install Android Studio. >> "%LOG%"
  echo JDK not found. See %LOG%
  goto :done
)
rem SDK location via env var instead of local.properties (works with a Korean user folder)
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
echo ANDROID_HOME=%ANDROID_HOME% >> "%LOG%"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"

if /i "%~1"=="install" goto :install
if /i "%~1"=="release" goto :release

call :web

rem --- 2) build the app: demo (no SDK) then pleos (real Pleos SDK) ---
pushd "%HERE%"
echo. >> "%LOG%"
echo ===== assembleDemoDebug ===== >> "%LOG%"
call gradlew.bat assembleDemoDebug --no-daemon --console=plain >> "%LOG%" 2>&1
echo EXIT_DEMO=!ERRORLEVEL! >> "%LOG%"
echo ===== assemblePleosDebug ===== >> "%LOG%"
call gradlew.bat assemblePleosDebug --no-daemon --console=plain >> "%LOG%" 2>&1
echo EXIT_PLEOS=!ERRORLEVEL! >> "%LOG%"
popd
findstr /b /c:"EXIT_" "%LOG%"
echo Log: %LOG%
goto :done

:install
set "APK=%HERE%app\build\outputs\apk\pleos\debug\app-pleos-debug.apk"
if not exist "%APK%" (
  echo Build first: %APK%
  goto :done
)
"%ADB%" devices >> "%LOG%" 2>&1
"%ADB%" install -r "%APK%" >> "%LOG%" 2>&1
echo EXIT_INSTALL=!ERRORLEVEL! >> "%LOG%"
rem emulator localhost:8787 -> PC 8787 (the app uses 10.0.2.2:8787 by default; both work)
"%ADB%" reverse tcp:8787 tcp:8787 >> "%LOG%" 2>&1
"%ADB%" shell am start -n ai.jhgo.car/.MainActivity >> "%LOG%" 2>&1
findstr /b /c:"EXIT_" "%LOG%"
echo Installed. Keep the PC server running: npm start (repo root). Log: %LOG%

:release
rem submission APK: pleosRelease (signed with the debug key so it installs on the emulator; see README) -> <repo>\apk\
call :web
pushd "%HERE%"
echo. >> "%LOG%"
echo ===== assemblePleosRelease ===== >> "%LOG%"
call gradlew.bat assemblePleosRelease --no-daemon --console=plain >> "%LOG%" 2>&1
echo EXIT_RELEASE=!ERRORLEVEL! >> "%LOG%"
popd
set "RAPK=%HERE%app\build\outputs\apk\pleos\release\app-pleos-release.apk"
if exist "%RAPK%" (
  if not exist "%ROOT%\apk" mkdir "%ROOT%\apk"
  copy /y "%RAPK%" "%ROOT%\apk\juhaengjung-go_pleos_release.apk" >> "%LOG%" 2>&1
  echo Copied to %ROOT%\apk\juhaengjung-go_pleos_release.apk
)
findstr /b /c:"EXIT_" "%LOG%"
echo Log: %LOG%
goto :done

:web
rem --- build the car web screen and the demo page so the app runs without the PC server ---
echo. >> "%LOG%"
echo ===== npm run build:web ===== >> "%LOG%"
pushd "%ROOT%"
where npm >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [WARN] npm not found - skipping web build; the app will load the screen from the server >> "%LOG%"
) else (
  if not exist node_modules call npm install >> "%LOG%" 2>&1
  call npm run build:web >> "%LOG%" 2>&1
  echo EXIT_WEB=!ERRORLEVEL! >> "%LOG%"
  rem demo page (one file) for the start screen "auto demo"
  call npm run build:demo >> "%LOG%" 2>&1
  echo EXIT_DEMOPAGE=!ERRORLEVEL! >> "%LOG%"
)
popd
exit /b 0

:done
endlocal
