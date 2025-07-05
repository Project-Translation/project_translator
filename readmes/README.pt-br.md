# Tradutor do Projeto

Uma extensão do VSCode: Uma ferramenta fácil de usar para localização multilíngue de projetos.

<!--
## Traduções Disponíveis

A extensão suporta tradução para esses idiomas:

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

## Exemplos

| Projeto                                                                             | Repositório Original                                                                                       | Descrição                                                                                                                                                               | Estrelas | Marcadores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [algorithm-visualizer](https://github.com/Project-Translation/algorithm-visualizer) | [algorithm-visualizer/algorithm-visualizer](https://github.com/algorithm-visualizer/algorithm-visualizer) | :fireworks:Plataforma Online Interativa que Visualiza Algoritmos a partir de Código                                                                                      | 47301    | [`algorithm`](https://github.com/topics/algorithm), [`animation`](https://github.com/topics/animation), [`data-structure`](https://github.com/topics/data-structure), [`visualization`](https://github.com/topics/visualization)                                                                                                                                                                                                                                                                                                                                                                               |
| [algorithms](https://github.com/Project-Translation/algorithms)                     | [algorithm-visualizer/algorithms](https://github.com/algorithm-visualizer/algorithms)                     | :crystal_ball:Visualizações de Algoritmos                                                                                                                               | 401      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [cline-docs](https://github.com/Project-Translation/cline-docs)                     | [cline/cline](https://github.com/cline/cline)                                                             | Agente de codificação autônomo diretamente no seu IDE, capaz de criar/editar arquivos, executar comandos, usar o navegador e mais, com sua permissão em cada etapa do processo. | 39572    | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [cursor-docs](https://github.com/Project-Translation/cursor-docs)                   | [getcursor/docs](https://github.com/getcursor/docs)                                                       | Documentação de código aberto do Cursor                                                                                                                                 | 309      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [gobyexample](https://github.com/Project-Translation/gobyexample)                   | [mmcgrana/gobyexample](https://github.com/mmcgrana/gobyexample)                                           | Go por Exemplo                                                                                                                                                          | 7523     | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [golang-website](https://github.com/Project-Translation/golang-website)             | [golang/website](https://github.com/golang/website)                                                       | [mirror] Lar do go.dev e sites golang.org                                                                                                                               | 402      | N/A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [reference-en-us](https://github.com/Project-Translation/reference-en-us)           | [Fechin/reference](https://github.com/Fechin/reference)                                                   | ⭕ Compartilhar folha de dicas rápida para desenvolvedores.                                                                                                              | 7808     | [`awk`](https://github.com/topics/awk), [`bash`](https://github.com/topics/bash), [`chatgpt`](https://github.com/topics/chatgpt), [`cheatsheet`](https://github.com/topics/cheatsheet), [`cheatsheets`](https://github.com/topics/cheatsheets), [`css`](https://github.com/topics/css), [`golang`](https://github.com/topics/golang), [`grep`](https://github.com/topics/grep), [`markdown`](https://github.com/topics/markdown), [`python`](https://github.com/topics/python), [`reference`](https://github.com/topics/reference), [`sed`](https://github.com/topics/sed), [`snippets`](https://github.com/topics/snippets), [`vim`](https://github.com/topics/vim) |
| [styleguide](https://github.com/Project-Translation/styleguide)                     | [google/styleguide](https://github.com/google/styleguide)                                                 | Guias de estilo para projetos de código aberto originados pelo Google                                                                                                   | 38055    | [`cpplint`](https://github.com/topics/cpplint), [`style-guide`](https://github.com/topics/style-guide), [`styleguide`](https://github.com/topics/styleguide)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [vscode-docs](https://github.com/Project-Translation/vscode-docs)                   | [microsoft/vscode-docs](https://github.com/microsoft/vscode-docs)                                         | Documentação pública do Visual Studio Code                                                                                                                              | 5914     | [`vscode`](https://github.com/topics/vscode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Solicitação de Tradução de Projeto

Se você deseja contribuir com uma tradução ou precisa que um projeto seja traduzido:

1. Crie uma issue usando o seguinte modelo:

```md
**Projeto**: [project_url]
**Idioma Alvo**: [target_lang]
**Descrição**: Breve descrição de por que essa tradução seria valiosa
```

2. Fluxo de trabalho:

```mermaid
sequenceDiagram
  Contribuidor->>Tradutor do Projeto: Criar issue de tradução
  Tradutor do Projeto->>Comunidade: Revisar issue
  Comunidade-->>Contribuidor: Aprovar/Comentar
  Contribuidor->>Novo Projeto: Iniciar tradução
  Contribuidor->>Novo Projeto: Enviar para Novo Projeto
  Contribuidor->>Tradutor do Projeto: Criar Pull Request, modificar README.Samples
  Tradutor do Projeto-->>Tradutor do Projeto: Revisar & Mesclar
```

3. Depois que o PR for mesclado, a tradução será adicionada à seção de Exemplos.

Traduções em andamento: [Ver Issues](https://github.com/Project-Translation/project_translator/issues)

## Recursos

- 📁 Suporte a Tradução em Nível de Pasta
  - Traduzir pastas inteiras de projetos para múltiplos idiomas
  - Manter a estrutura original da pasta e hierarquia
  - Suporte à tradução recursiva de subpastas
  - Detecção automática de conteúdo tradutível
  - Processamento em lote para traduções eficientes em larga escala
- 📄 Suporte a Tradução em Nível de Arquivo
  - Traduzir arquivos individuais para múltiplos idiomas
  - Preservar a estrutura original do arquivo e formatação
  - Suporte para modos de tradução de pasta e arquivo
- 💡 Tradução Inteligente com IA
  - Mantém automaticamente a integridade da estrutura do código
  - Traduz apenas comentários de código, preserva lógica do código
  - Mantém formatos JSON/XML e outras estruturas de dados
  - Qualidade profissional em tradução de documentação técnica
- ⚙️ Configuração Flexível
  - Configurar pasta de origem e múltiplas pastas de destino
  - Suporte a intervalos personalizados de tradução de arquivos
  - Definir tipos específicos de arquivos para ignorar
  - Suporte para múltiplas opções de modelos de IA
- 🚀 Operações Amigáveis
  - Exibição em tempo real do progresso da tradução
  - Suporte para pausar/resumir/parar tradução
  - Manutenção automática da estrutura da pasta de destino
  - Tradução incremental para evitar trabalho duplicado
- 🔄 Aplicação Avançada de Diferenças na Tradução
  - **Atualizações Precisas**: Traduz apenas o conteúdo realmente alterado
  - **Controle Linha a Linha**: Mantém exatamente a formatação e estrutura
  - **Tradução Incremental**: Ideal para manter documentação traduzida
  - **Amigável ao Controle de Versão**: Gera mudanças mínimas e direcionadas
  - **Custo Eficiente**: Reduz chamadas à API traduzindo apenas diferenças
  - **Backup Automático**: Cria automaticamente arquivos de backup antes de aplicar alterações

## Instalação

1. Procure por "[Project Translator](https://marketplace.visualstudio.com/items?itemName=techfetch-dev.project-translator)" na loja de extensões do VS Code
2. Clique em instalar

## Configuração

A extensão suporta as seguintes opções de configuração:

```json
{
  "projectTranslator.specifiedFolders": [
    {
      "sourceFolder": {
        "path": "Caminho da pasta de origem",
        "lang": "Código do idioma de origem"
      },
      "targetFolders": [
        {
          "path": "Caminho da pasta de destino",
          "lang": "Código do idioma de destino"
        }
      ]
    }
  ],
  "projectTranslator.diffApply": {
    "enabled": true,
    "validationLevel": "normal",
    "autoBackup": true,
    "maxOperationsPerFile": 100
  },
  "projectTranslator.specifiedFiles": [
    {
      "sourceFile": {
        "path": "Caminho do arquivo de origem",
        "lang": "Código do idioma de origem"
      },
      "targetFiles": [
        {
          "path": "Caminho do arquivo de destino",
          "lang": "Código do idioma de destino"
        }
      ]
    }
  ],
  "projectTranslator.currentVendor": "openai",
  "projectTranslator.vendors": [
    {
      "name": "openai",
      "apiEndpoint": "URL do endpoint da API",
      "apiKey": "Chave de autenticação da API",
      "model": "Nome do modelo a ser usado",
      "rpm": "Máximo de requisições por minuto",
      "maxTokensPerSegment": 4096,
      "timeout": 30,
      "temperature": 0.0
    }
  ]
}
```

Detalhes importantes de configuração:

| Opção de Configuração                        | Descrição                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `projectTranslator.specifiedFolders`         | Múltiplas pastas de origem com suas pastas de destino correspondentes para tradução          |
| `projectTranslator.specifiedFiles`           | Múltiplos arquivos de origem com seus arquivos de destino correspondentes para tradução      |
| `projectTranslator.translationIntervalDays`  | Intervalo de tradução em dias (padrão 7 dias)                                                |
| `projectTranslator.copyOnly`                 | Arquivos para copiar mas não traduzir (com arrays `paths` e `extensions`)                    |
| `projectTranslator.ignore`                   | Arquivos para ignorar completamente (com arrays `paths` e `extensions`)                      |
| `projectTranslator.currentVendor`            | Fornecedor de API atual em uso                                                              |
| `projectTranslator.vendors`                  | Lista de configuração de fornecedores de API                                                |
| `projectTranslator.systemPrompts`            | Array de prompts do sistema para guiar o processo de tradução                               |
| `projectTranslator.userPrompts`              | Array de prompts definidos pelo usuário, esses prompts serão adicionados após os prompts do sistema durante a tradução |
| `projectTranslator.segmentationMarkers`      | Marcadores de segmentação configurados por tipo de arquivo, suporta expressões regulares    |
| `projectTranslator.debug`                    | Ativar modo de depuração para registrar todas as requisições e respostas da API no canal de saída (padrão: false) |
| `projectTranslator.logFile`                  | Configuração para arquivos de log de depuração (ver [Recurso de Arquivo de Log](./docs/log-file-feature.md)) |

## Uso

1. Abra a paleta de comandos (Ctrl+Shift+P / Cmd+Shift+P)
2. Digite "Traduzir Projeto" e selecione o comando
3. Se a pasta de origem não estiver configurada, aparecerá um diálogo de seleção de pasta
4. Aguarde a conclusão da tradução

Durante a tradução:

- Pode pausar/resumir a tradução através dos botões da barra de status
- Pode parar o processo de tradução a qualquer momento
- O progresso da tradução é mostrado na área de notificação
- Logs detalhados são exibidos no painel de saída

## Desenvolvimento

### Sistema de Build

Esta extensão usa esbuild para empacotamento rápido e desenvolvimento:

#### Scripts Disponíveis

- `npm run build` - Build de produção com minificação
- `npm run compile` - Build de desenvolvimento
- `npm run watch` - Modo de observação para desenvolvimento
- `npm test` - Executar testes

#### Tarefas do VS Code

- **Build** (Ctrl+Shift+P → "Tasks: Run Task" → "build") - Empacota a extensão para produção
- **Watch** (Ctrl+Shift+P → "Tasks: Run Task" → "watch") - Modo de desenvolvimento com reconstrução automática

### Configuração de Desenvolvimento

1. Clone o repositório
2. Execute `npm install` para instalar dependências
3. Pressione `F5` para iniciar a depuração ou execute a tarefa "watch" para desenvolvimento

A configuração do esbuild:

- Empacota todos os arquivos TypeScript em um único `out/extension.js`
- Exclui a API do VS Code (marcada como externa)

## Recursos Avançados

### Aplicação de Diferenças na Tradução

Para informações detalhadas sobre o modo avançado de tradução com aplicação de diferenças, veja o [Guia de Uso da Aplicação de Diferenças](./docs/diff-apply-usage.md).

Este recurso permite:
- Atualizações precisas linha a linha na tradução
- Redução de custos da API para arquivos grandes
- Melhor integração com controle de versão
- Preservação da formatação do documento

### Documentação de Design

Para detalhes técnicos sobre a implementação da aplicação de diferenças, veja a [Documentação de Design da Tradução com Aplicação de Diferenças](./docs/diff-apply-translation-design.md).
- Gera mapas de origem para builds de desenvolvimento
- Minifica código para builds de produção
- Fornece integração com problem matcher para o VS Code

## Observações

- Garanta cota suficiente de uso da API
- Recomenda-se testar com projetos pequenos primeiro
- Use chaves de API dedicadas e remova-as após a conclusão

## Licença

[Licença](LICENSE)