# MATOKO DJ

App de escritorio del mezclador de MABRIONA (decks, EQ, hot cues,
mezcla automática, biblioteca, karaoke).

Standalone real: el código del mezclador vive en `renderer/` (copia
propia, sin depender de mabriona.com). `main.js` levanta un servidor
HTTP local que sirve ese build y lo carga en la ventana — no abre la
web de MABRIONA Studio. La única llamada de red que sigue yendo contra
`mabriona.com` es la búsqueda/verificación de YouTube (`/api/search`,
`/api/check`), porque ahí viven las claves secretas de esas APIs.

## Desarrollo

```bash
npm install
cd renderer && npm install && cd ..
npm start
```

## Construir el instalador

```bash
npm run dist:mac    # macOS — .app sin firmar (dist/mac/)
npm run dist:win    # Windows — requiere compilar en Windows o con Wine
npm run dist:linux  # Linux — AppImage
```

El build de macOS local queda **sin firmar** (no hay certificado de
Apple Developer configurado) — al abrirlo por primera vez, macOS puede
pedir confirmar en Preferencias del Sistema → Privacidad y Seguridad →
"Abrir de todas formas".
