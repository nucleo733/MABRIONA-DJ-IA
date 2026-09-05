# MATOKO DJ — reglas del proyecto

## CONGELADO — Brave y el buscador de YouTube (2026-09-04)

Esto está decidido y probado. **No se toca ni se "mejora" sin que el
usuario lo pida explícitamente.**

### 1. El buscador de YouTube va por Brave Search API

- La búsqueda de música de MATOKO DJ es **Brave Search API**, siempre,
  como predeterminado. Verificado en producción: la respuesta de
  `mabriona.com/api/search` viene marcada `source: brave`.
- El endpoint vive en el repo MABRIONA-STUDIO, en `app/api/search.ts`.
  La clave (`BRAVE_API_KEY`) está solo del lado del servidor — nunca
  dentro del binario descargable.
- La YouTube Data API de Google queda **solo como respaldo**, para si
  Brave falla o le falta la clave. No se promueve a predeterminada.
- La caja de búsqueda es 100% interfaz de MATOKO DJ. No se abre ningún
  navegador para buscar.

### 2. Brave viene EMBEBIDO dentro del instalador

Decisión del usuario, tomada sabiendo el costo en peso (+164 MB
Windows, +251 MB Mac, +148 MB Linux): el instalador lleva Brave adentro
para que instalar funcione **sin internet**. No volver a proponer
bajarlo en el momento para ahorrar peso.

- `scripts/fetchBrave.js` baja el instalador oficial real de Brave
  Software (github.com/brave/brave-browser — nunca un mirror) en el
  momento de compilar, enganchado como `build.beforePack`.
- Los binarios **no van al repo**: `vendor/` está en `.gitignore`
  porque pesan más que el límite de 100 MB por archivo de GitHub.
- Windows: `installer/checkBrave.nsh` mete el `.exe` con `File` en
  `$PLUGINSDIR` y lo corre en silencio. El chequeo de que el archivo
  exista es de COMPILACIÓN (`!if /FileExists`), no de runtime.
- Mac y Linux: el paquete queda en `resources/brave/` y se instala
  desde ahí (`braveInstaller.js`).
- Linux compila `.deb` y `.rpm` además de la AppImage. El `postinst`
  (`installer/linuxAfterInstall.sh`) instala Brave desacoplado,
  esperando a que se libere el lock de dpkg/rpm — no se puede llamar a
  apt-get dentro de un postinst sin que se trabe contra sí mismo.
- Los tres mantienen el respaldo de bajar Brave si el build se hizo sin
  `vendor/`. Ese respaldo se queda.

### 3. El orden y la condición

- Si la computadora **ya tiene Brave**: no se instala nada, solo MATOKO.
- Si **no lo tiene**: primero Brave, después MATOKO.
- En Windows y en el `.deb`/`.rpm` de Linux eso lo resuelve el propio
  instalador, como root, sin pedir contraseña extra.
- En Mac (una `.app` suelta) y en la AppImage no hay instalador, así
  que el mismo chequeo se repite al arrancar la app
  (`ensureBraveInstalled` en `main.js`): si falta Brave, se instala
  antes de abrir la ventana.

### 4. Al probar

Nunca ejecutar de verdad la instalación de Brave contra la Mac del
usuario. Probar la lógica con rutas simuladas — `braveInstaller.js`
captura `spawn` al cargarse, así que reemplazar `child_process.spawn`
después del `require` NO lo intercepta: lanza el instalador real.

---

## CONGELADO — Instalador de macOS (2026-09-04)

Validado con un build real y probado en la Mac del usuario. **Es
infraestructura congelada: no se toca, no se refactoriza, no se
renombra, no se mueve y no se "mejora"** — solo se corrige si una
auditoría futura encuentra un problema técnico real y el usuario
autoriza expresamente el arreglo.

### Rutas oficiales (congeladas)

Los cuatro artefactos de distribución de macOS viven siempre acá, con
estos nombres exactos:

```
release/mac/MATOKO DJ.app
release/mac/MATOKO DJ.dmg
release/mac/Uninstall MATOKO DJ.app
release/mac/MATOKO DJ Manual.pdf
```

`dist/` es solo el taller interno de electron-builder. `release/mac/`
es la única ubicación oficial: no se crea otra carpeta de
distribución paralela ni se cambian estos nombres.

`release/` está en `.gitignore` porque el DMG pesa ~450 MB y GitHub no
acepta archivos de más de 100 MB. Lo versionado es todo lo necesario
para regenerarlo con un comando.

### Cómo se genera

```
npm run dist:mac
```

Eso encadena: compilar el renderer → `electron-builder --mac` (la
`.app` Universal 2) → `scripts/afterPackMac.js` (desinstalador +
manual) → `scripts/makeDmg.sh` (el DMG y la copia a `release/mac/`).

### Identidad visual

- La imagen oficial es `build/identidad/MATOKODJ.png`, copia exacta
  (mismo SHA-256) de la que dio el usuario. **No se modifica, no se
  recorta, no se cambia de color y no se redibuja.** Es la fuente de
  todo lo demás.
- `scripts/makeMacAssets.py` genera desde ella los derivados:
  `build/icon.icns` (todos los tamaños que pide macOS) y el fondo del
  DMG. Se puede volver a correr con `npm run assets:mac`.
- La ventana del DMG mide 760×600, con la app a la izquierda y
  Applications a la derecha, y debajo el desinstalador y el manual.
  Si se cambian esas medidas hay que cambiarlas en los dos lados:
  `scripts/makeMacAssets.py` (que dibuja el fondo) y
  `scripts/dmgLayout.py` (que coloca los iconos).

### Dos cosas que costaron encontrar — no deshacerlas

1. **El DMG no lo arma el target `dmg` de electron-builder**, sino
   `scripts/makeDmg.sh`. Y el aspecto de la ventana lo escribe
   `scripts/dmgLayout.py` directo en el `.DS_Store`, sin pedírselo al
   Finder por AppleScript: el Finder guarda el aspecto de cada volumen
   POR NOMBRE en su caché, y en una Mac donde ya se abrió un DMG
   anterior de MATOKO DJ pisa lo que se le acaba de pedir — el fondo y
   el tamaño de icono se pierden. Escribirlo a mano da el mismo
   resultado en cualquier Mac.
2. **El build usa `/usr/bin/python3` por ruta absoluta**, no el
   `python3` del PATH: con Homebrew, el del PATH puede ser de otra
   arquitectura y el proceso ni arranca (error EBADARCH).

### Arquitectura

Universal 2 real: el mismo binario lleva `arm64` (Apple Silicon) y
`x86_64` (Intel), verificado con `lipo`. Mínimo macOS 11.

### Desinstalador

`installer/uninstall.applescript` — borra solo la app y los archivos
que la propia app crea. La lista de rutas es **fija y escrita a mano**;
nunca se arma con comodines. No toca música, documentos ni ninguna otra
app, y no desinstala Brave. Probado de verdad: borró las tres rutas de
MATOKO DJ y dejó intacto todo lo demás.

### Lo que falta para distribución pública

La app **no está firmada ni notarizada** — esta Mac no tiene ningún
certificado de firma. El DMG funciona, pero a quien lo descargue macOS
le va a advertir que es de un desarrollador no identificado (se abre
con clic derecho → Abrir). Para una distribución pública hace falta:
cuenta del Apple Developer Program (99 USD/año), un certificado
"Developer ID Application", el Team ID y una contraseña específica de
app para notarizar. Con eso, `notarytool` ya está instalado en esta Mac.
