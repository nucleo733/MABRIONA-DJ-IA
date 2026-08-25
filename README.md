# MABRIONA DJ IA

App de escritorio descargable del mezclador **DJ IA** de MABRIONA STUDIO.

Es una ventana nativa (Electron) que carga directamente
`https://mabriona.com/dj-ia-app` — la misma pantalla del mezclador que
vive en producción, sin el header/nav del resto de MABRIONA STUDIO
alrededor. No duplica el motor de audio ni el código del mezclador:
siempre queda igual de actualizado que la web, porque es la web.

## Desarrollo

```bash
npm install
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
