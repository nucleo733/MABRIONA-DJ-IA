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
