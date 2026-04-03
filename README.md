# IG Chat Extractor

Extensión de Chrome/Opera para exportar conversaciones de **Instagram Web** (DMs) como texto formateado y legible.

```
╔══════════════════════════════════════════════════════╗
║  💬 Conversación de Instagram                        ║
║  📅 2 de abril de 2026                               ║
║  👤 Armando ↔ María                                  ║
╚══════════════════════════════════════════════════════╝

  ─── Hoy ───

🔵 Armando (10:30):
   Hola! ¿cómo estás?

🟣 María (10:31):
   ↩️ En respuesta a: "Hola! ¿cómo estás?"
   Bien! y tú?
```

## Características

- Scroll automático para cargar más mensajes
- Indica reacciones y mensajes de voz
- Muestra respuestas citadas
- Separadores de fecha
- Copiar al portapapeles o descargar como `.txt`

## Instalación

La extensión **no está en la Chrome Web Store** — se instala en modo desarrollador en segundos:

1. Descarga o clona este repositorio
2. Abre Chrome y ve a `chrome://extensions`
3. Activa **"Modo desarrollador"** (esquina superior derecha)
4. Haz clic en **"Cargar descomprimida"**
5. Selecciona la carpeta `extension` de este repositorio

> También funciona en **Opera**: `opera://extensions` → mismo proceso.

## Uso

### Con la extensión (recomendado)

1. Abre [Instagram](https://www.instagram.com) en Chrome
2. Ve a los mensajes directos (DMs)
3. Abre la conversación que quieres exportar
4. **Importante:** Scrollea hacia arriba para cargar los mensajes que quieras incluir
5. Haz clic en el icono de la extensión
6. Escribe los nombres y extrae

### Con el script en consola (alternativo)

Si prefieres sin instalar la extensión:

1. Abre la conversación en Instagram Web
2. Presiona `F12` → pestaña **Console**
3. Copia el contenido de `extract-ig-chat-v2.js` y pégalo en la consola
4. Aparecerá un panel flotante con las opciones de extracción

> **Nota:** Instagram carga los mensajes dinámicamente. Solo se extraen los que están visibles/cargados en el DOM. Para más mensajes, scrollea hacia arriba antes de extraer.

## Proyectos relacionados

- [**wa-chat-extractor**](https://github.com/cocopsn/wa-chat-extractor) — Para WhatsApp Web
- [**wa-desktop-extractor**](https://github.com/cocopsn/wa-desktop-extractor) — Para la app nativa de WhatsApp Desktop (Windows)

## Licencia

MIT
