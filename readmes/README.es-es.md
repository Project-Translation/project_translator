# Traductor de Proyectos

Una extensión de VSCode: Una herramienta fácil de usar para la localización multilingüe de proyectos.

<!--
## Traducciones Disponibles

La extensión soporta traducción a estos idiomas:

- [简体中文 (zh-cn)](./README.zh-cn.md)
- [繁體中文 (zh-tw)](./README.zh-tw.md)
- [日本語 (ja-jp)](./README.ja-jp.md)
- [한국어 (ko-kr)](./README.ko-kr.md)
- [Français (fr-fr)](./README.fr-fr.md)
- [Deutsch (de-de)](./README.de-de.md)
- [Español (es-es)](./README.es-es.md)
- [Português (pt-br)](./README.pt-br.md)
- [Русский (ru-ru)](./README.ru-ru.md)
- [العربية (ar-sa)](./README.ar-sa.md)
- [العربية (ar-ae)](./README.ar-ae.md)
- [العربية (ar-eg)](./README.ar-eg.md) -->

## Ejemplos
| Proyecto                                                                             | Repositorio Original                                                                                       | Descripción                                                                                                                                                               | Estrellas | Etiquetas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [algorithm-visualizer](https://github.com/Project-Translation/algorithm-visualizer) | [algorithm-visualizer/algorithm-visualizer](https://github.com/algorithm-visualizer/algorithm-visualizer) | :fireworks:Plataforma en línea interactiva que visualiza algoritmos a partir de código                                                                                   | 47301    | [`algorithm`](https://github.com/topics/algorithm), [`animation`](https://github.com/topics/animation), [`data-structure`](https://github.com/topics/data-structure), [`visualization`](https://github.com/topics/visualization)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [algorithms](https://github.com/Project-Translation/algorithms)                     | [algorithm-visualizer/algorithms](https://github.com/algorithm-visualizer/algorithms)                     | :crystal_ball:Visualizaciones de algoritmos                                                                                                                              | 401      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [cline-docs](https://github.com/Project-Translation/cline-docs)                     | [cline/cline](https://github.com/cline/cline)                                                             | Agente de codificación autónomo directamente en tu IDE, capaz de crear/editar archivos, ejecutar comandos, usar el navegador y más, con tu permiso en cada paso.          | 39572    | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [cursor-docs](https://github.com/Project-Translation/cursor-docs)                   | [getcursor/docs](https://github.com/getcursor/docs)                                                       | Documentación de código abierto de Cursor                                                                                                                                 | 309      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [gobyexample](https://github.com/Project-Translation/gobyexample)                   | [mmcgrana/gobyexample](https://github.com/mmcgrana/gobyexample)                                           | Go by Example                                                                                                                                                             | 7523     | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [golang-website](https://github.com/Project-Translation/golang-website)             | [golang/website](https://github.com/golang/website)                                                       | [espejo] Sitio web oficial de go.dev y golang.org                                                                                                                        | 402      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [reference-en-us](https://github.com/Project-Translation/reference-en-us)           | [Fechin/reference](https://github.com/Fechin/reference)                                                   | ⭕ Hoja de referencia rápida para desarrolladores.                                                                                                                        | 7808     | [`awk`](https://github.com/topics/awk), [`bash`](https://github.com/topics/bash), [`chatgpt`](https://github.com/topics/chatgpt), [`cheatsheet`](https://github.com/topics/cheatsheet), [`cheatsheets`](https://github.com/topics/cheatsheets), [`css`](https://github.com/topics/css), [`golang`](https://github.com/topics/golang), [`grep`](https://github.com/topics/grep), [`markdown`](https://github.com/topics/markdown), [`python`](https://github.com/topics/python), [`reference`](https://github.com/topics/reference), [`sed`](https://github.com/topics/sed), [`snippets`](https://github.com/topics/snippets), [`vim`](https://github.com/topics/vim) |
| [styleguide](https://github.com/Project-Translation/styleguide)                     | [google/styleguide](https://github.com/google/styleguide)                                                 | Guías de estilo para proyectos de código abierto originados en Google                                                                                                     | 38055    | [`cpplint`](https://github.com/topics/cpplint), [`style-guide`](https://github.com/topics/style-guide), [`styleguide`](https://github.com/topics/styleguide)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [vscode-docs](https://github.com/Project-Translation/vscode-docs)                   | [microsoft/vscode-docs](https://github.com/microsoft/vscode-docs)                                         | Documentación pública para Visual Studio Code                                                                                                                             | 5914     | [`vscode`](https://github.com/topics/vscode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Solicitando Traducción de Proyecto

Si deseas contribuir con una traducción o necesitas que se traduzca un proyecto:

1. Crea un issue usando la siguiente plantilla:

```md
**Proyecto**: [project_url]
**Idioma Objetivo**: [target_lang]
**Descripción**: Breve descripción de por qué esta traducción sería valiosa
```

2. Flujo de trabajo:
```mermaid
sequenceDiagram
  Contributor->>Project Translator: Create translation issue
  Project Translator->>Community: Review issue
  Community-->>Contributor: Approve/Comment
  Contributor->>New Project: Start translation
  Contributor->>New Project: Submit to New Project
  Contributor->>Project Translator: Create Pull Request, modify README.Samples
  Project Translator-->>Project Translator: Review & Merge
```

3. Después de que se fusione el PR, la traducción se agregará a la sección de Samples.

Traducciones en curso actuales: [Ver problemas](https://github.com/Project-Translation/project_translator/issues)

## Características

- 📁 Soporte de traducción a nivel de carpeta
  - Traducir carpetas de proyectos enteras a varios idiomas
  - Mantener la estructura y jerarquía de carpetas original
  - Soporte para traducción recursiva de subcarpetas
  - Detección automática de contenido traducible
  - Procesamiento por lotes para traducciones a gran escala eficientes
- 📄 Soporte de traducción a nivel de archivo
  - Traducir archivos individuales a varios idiomas
  - Preservar la estructura y formato original del archivo
  - Soporte para modos de traducción tanto de carpetas como de archivos
- 💡 Traducción inteligente con IA
  - Mantiene automáticamente la integridad de la estructura del código
  - Solo traduce comentarios de código, preserva la lógica del código
  - Mantiene formatos de JSON/XML y otras estructuras de datos
  - Calidad profesional en la traducción de documentación técnica
- ⚙️ Configuración flexible
  - Configurar carpeta de origen y múltiples carpetas de destino
  - Soporte para intervalos personalizados de traducción de archivos
  - Establecer tipos de archivos específicos para ignorar
  - Soporte para múltiples opciones de modelos de IA
- 🚀 Operaciones amigables para el usuario
  - Visualización en tiempo real del progreso de la traducción
  - Soporte para pausar/reanudar/detener la traducción
  - Mantenimiento automático de la estructura de la carpeta de destino
  - Traducción incremental para evitar trabajo duplicado

## Instalación

1. Buscar "[Project Translator](https://marketplace.visualstudio.com/items?itemName=techfetch-dev.project-translator)" en el marketplace de extensiones de VS Code
2. Hacer clic en instalar

## Configuración

La extensión soporta las siguientes opciones de configuración:

```json
{
  "projectTranslator.specifiedFolders": [
    {
      "sourceFolder": {
        "path": "Source folder path",
        "lang": "Source language code"
      },
      "destFolders": [
        {
          "path": "Target folder path",
          "lang": "Target language code"
        }
      ]
    }
  ],
  "projectTranslator.specifiedFiles": [
    {
      "sourceFile": {
        "path": "Source file path",
        "lang": "Source language code"
      },
      "destFiles": [
        {
          "path": "Target file path",
          "lang": "Target language code"
        }
      ]
    }
  ],
  "projectTranslator.currentVendor": "openai",
  "projectTranslator.vendors": [
    {
      "name": "openai",
      "apiEndpoint": "API endpoint URL",
      "apiKey": "API authentication key",
      "model": "Model name to use",
      "rpm": "Maximum requests per minute",
      "maxTokensPerSegment": 4096,
      "timeout": 30,
      "temperature": 0.0
    }
  ]
}
```

Detalles clave de configuración:

| Configuration Option                        | Description                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `projectTranslator.specifiedFolders`        | Múltiples carpetas de origen con sus carpetas de destino correspondientes para traducción       |
| `projectTranslator.specifiedFiles`          | Múltiples archivos de origen con sus archivos de destino correspondientes para traducción      |
| `projectTranslator.translationIntervalDays` | Intervalo de traducción en días (por defecto 7 días)                                           |
| `projectTranslator.copyOnly`                | Archivos para copiar pero no traducir (con arrays de `paths` y `extensions`)                   |
| `projectTranslator.ignore`                  | Archivos para ignorar completamente (con arrays de `paths` y `extensions`)                     |
| `projectTranslator.currentVendor`           | Proveedor de API actual en uso                                                                 |
| `projectTranslator.vendors`                 | Lista de configuración de proveedores de API                                                   |
| `projectTranslator.systemPrompts`           | Array de indicaciones del sistema para guiar el proceso de traducción                          |
| `projectTranslator.userPrompts`             | Array de indicaciones definidas por el usuario, estas se agregarán después de las indicaciones del sistema durante la traducción |
| `projectTranslator.segmentationMarkers`     | Marcadores de segmentación configurados por tipo de archivo, soporta expresiones regulares     |

## Uso

1. Abrir el panel de comandos (Ctrl+Shift+P / Cmd+Shift+P)
2. Escribir "Translate Project" y seleccionar el comando
3. Si no se ha configurado la carpeta de origen, aparecerá un diálogo de selección de carpeta
4. Esperar a que se complete la traducción

Durante la traducción:

- Se puede pausar/reanudar la traducción a través de los botones de la barra de estado
- Se puede detener el proceso de traducción en cualquier momento
- El progreso de la traducción se muestra en el área de notificaciones
- Los registros detallados se muestran en el panel de salida

## Notas
- Asegúrese de tener suficiente cuota de uso de API
- Se recomienda probar primero con proyectos pequeños
- Utilice claves de API dedicadas y elimínelas después de completarla

## Licencia

[Licencia](LICENSE)