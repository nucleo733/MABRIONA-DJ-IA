; Integración oficial MABRIONA Browser + MABRIONA DJ AI — instalador Windows (NSIS)
; ============================================================
; Decisión de producto: MABRIONA Browser es el navegador oficial del
; ecosistema. El instalador de MABRIONA DJ AI para Windows (único de
; los 3 sistemas operativos que hoy usa un instalador NSIS real —
; ver docs/INTEGRACION-DJ-AI.md, sección "Instalador por plataforma")
; comprueba si ya está instalado ANTES de terminar de instalar DJ AI;
; si no está, descarga e instala el suyo oficial. Nunca instala
; Brave, Chrome ni Firefox.
;
; Se engancha vía "include" real de electron-builder
; (build.nsis.include en package.json) — no reemplaza el instalador
; generado, se ejecuta DENTRO de él en el macro estándar
; customInstall.

!macro customInstall
  ; 1) ¿Ya está instalado? Mismo criterio real que usa el cliente del
  ;    puente en runtime (browserBridgeClient.js): la ruta real de
  ;    instalación de MABRIONA Browser en Windows.
  IfFileExists "$LOCALAPPDATA\Programs\mabriona-browser\MABRIONA Browser.exe" browser_already_installed 0
  IfFileExists "$PROGRAMFILES\MABRIONA Browser\MABRIONA Browser.exe" browser_already_installed 0

  ; 2) No está — descargar el instalador oficial real (nunca una URL
  ;    de terceros, nunca Brave/Chrome/Firefox) y ejecutarlo antes de
  ;    continuar. NSIS trae inetc de fábrica (electron-builder ya lo
  ;    empaqueta) para la descarga real.
  DetailPrint "Instalando MABRIONA Browser (navegador oficial de MABRIONA)…"
  NSISdl::download "https://mabriona.com/browser/download/windows" "$TEMP\MABRIONA-Browser-Setup.exe"
  Pop $0
  StrCmp $0 "success" browser_download_ok browser_download_failed

  browser_download_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudo descargar MABRIONA Browser automáticamente. MABRIONA DJ AI va a quedar instalado, pero necesita MABRIONA Browser para buscar música — instalalo desde mabriona.com/browser cuando puedas."
    Goto browser_step_done

  browser_download_ok:
    ; Instalador real de MABRIONA Browser (silencioso si su propio
    ; empaquetado NSIS lo soporta con /S — igual que este instalador).
    ExecWait '"$TEMP\MABRIONA-Browser-Setup.exe" /S' $1
    Delete "$TEMP\MABRIONA-Browser-Setup.exe"
    Goto browser_step_done

  browser_already_installed:
    DetailPrint "MABRIONA Browser ya está instalado — no se reinstala."

  browser_step_done:
!macroend
