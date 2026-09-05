; Integración real MABRIONA DJ AI + Brave — instalador Windows (NSIS)
; ============================================================
; Decisión de producto de la Dirección: Brave (Brave Software) es el
; navegador que usa MABRIONA DJ AI para buscar/elegir música de
; YouTube — reemplaza la integración anterior con MABRIONA Browser. El
; instalador de Windows de DJ AI comprueba si Brave ya está instalado
; ANTES de terminar de instalar DJ AI; si no, descarga el instalador
; oficial real de Brave (github.com/brave/brave-browser, nunca un
; mirror de terceros) y lo corre en silencio.
;
; Se engancha vía "include" real de electron-builder
; (build.nsis.include en package.json) — no reemplaza el instalador
; generado, se ejecuta DENTRO de él en el macro estándar
; customInstall.

!macro customInstall
  ; 1) ¿Ya está instalado? Misma ruta real que usa el cliente en
  ;    runtime (braveClient.js).
  IfFileExists "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" brave_already_installed 0
  IfFileExists "$PROGRAMFILES\BraveSoftware\Brave-Browser\Application\brave.exe" brave_already_installed 0
  IfFileExists "$PROGRAMFILES64\BraveSoftware\Brave-Browser\Application\brave.exe" brave_already_installed 0

  ; 2) No está — instalarlo. El instalador oficial real de Brave (el
  ;    "Standalone", completo, no el stub online) viene EMBEBIDO dentro
  ;    de este instalador: lo baja `scripts/fetchBrave.js` al compilar
  ;    y queda en `vendor/`, así instalar Brave funciona aunque la
  ;    computadora no tenga internet.
  DetailPrint "Instalando Brave (necesario para buscar música en YouTube desde MATOKO DJ)…"
  ;    Ojo: `File` es una instrucción de COMPILACIÓN, no de runtime, así
  ;    que el chequeo de que el archivo exista tiene que ser también de
  ;    compilación (`!if /FileExists`) — con un `IfFileExists` normal,
  ;    un build sin `vendor/` no fallaría en la máquina del usuario:
  ;    fallaría al compilar el instalador.
  !if /FileExists "${PROJECT_DIR}\vendor\BraveBrowserStandaloneSetup.exe"
    File "/oname=$PLUGINSDIR\BraveBrowserStandaloneSetup.exe" "${PROJECT_DIR}\vendor\BraveBrowserStandaloneSetup.exe"
    ExecWait '"$PLUGINSDIR\BraveBrowserStandaloneSetup.exe" /silent /install' $1
    Goto brave_step_done
  !else
  ; 2-bis) Respaldo real por si el build se hizo sin el archivo embebido:
  ;    se baja en el momento, que es como funcionaba antes. `inetc`
  ;    sigue los redirects reales de GitHub (github.com → CDN de GitHub).
  inetc::get /SILENT "https://github.com/brave/brave-browser/releases/latest/download/BraveBrowserStandaloneSetup.exe" "$TEMP\BraveBrowserStandaloneSetup.exe"
  Pop $0
  StrCmp $0 "OK" brave_download_ok brave_download_failed

  brave_download_failed:
    IfSilent brave_step_done 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudo instalar Brave automáticamente. MATOKO DJ va a quedar instalado, pero necesita Brave para buscar música — instalalo desde brave.com cuando puedas."
    Goto brave_step_done

  brave_download_ok:
    ; Instalador oficial real de Brave, flags reales documentados por
    ; Brave Software para instalación desatendida.
    ExecWait '"$TEMP\BraveBrowserStandaloneSetup.exe" /silent /install' $1
    Delete "$TEMP\BraveBrowserStandaloneSetup.exe"
    Goto brave_step_done
  !endif

  brave_already_installed:
    DetailPrint "Brave ya está instalado — no se reinstala."

  brave_step_done:
!macroend
