# Arquitetura do backend DelBicos

> "A arquitetura deve tornar a implementação correta a implementação óbvia."

Quem desenvolve, pessoa ou agente, precisa encontrar, entender e alterar um
trecho de código com segurança, sem aprender abstrações que não têm relação
com a mudança. Este documento explica *por que* cada regra existe. As regras
em si, curtas e imperativas, ficam em `.agents/rules/` e são o que os agentes
de código leem.

## Princípios

1. **Descoberta.** Cada trecho de código tem um lugar óbvio e uma forma óbvia.
2. **Responsabilidade explícita.** Cada camada existe por um motivo que dá
   para nomear.
3. **Arquitetura mínima necessária.** Uma camada nova precisa de uma
   responsabilidade concreta que nenhuma camada existente cobre. Nada de
   service, repositório ou caso de uso "porque o livro manda".
4. **Composição antes de herança.** Herança só onde o framework exige: models
   do Sequelize (`extends Model`) e classes de erro (`extends Error`).
5. **Biblioteca antes de abstração caseira.** Se a linguagem ou uma biblioteca
   resolve, não escreva helper nem wrapper.
6. **Abstraia comportamento, não aparência.** Una só quando a intenção e o
   comportamento são os mesmos. A mesma lógica duas vezes já é um mau cheiro.
   A terceira cópia é um sinal forte para extrair. DRY é uma fonte da verdade
   por comportamento, não a remoção de repetição de texto.
7. **Consistência antes da perfeição local.** Um pull request segue o padrão
   dominante, mesmo quando existe algo "mais elegante".
8. **Mudança de arquitetura é deliberada.** Proposta, discussão, acordo, plano
   de migração e só então a implementação. Nunca dentro de um pull request de
   feature.
9. **Exceção visível.** Um contorno fica evidente e comentado no lugar em que
   é aplicado, nunca disfarçado de abstração oficial.
10. **Facilidade de revisão.** O código precisa ser fácil para outra pessoa
    revisar.
11. **O backend protege o negócio.** O frontend não é uma fronteira confiável.
    O banco só é alcançado a partir do backend.

## Camadas

- **`server.ts`** configura os middlewares e registra um grupo de rotas por
  domínio (`app.use("/api/user", userRoutes)`), para a superfície da API ser
  lida num só lugar.
- **Rotas** só ligam um endpoint a middlewares e a um controller
  (`router.post("/login", logInUser)`). Lógica num arquivo de rota fica
  invisível para quem lê os controllers.
- **Controllers** são funções exportadas, nunca classes: dois paradigmas para
  a mesma responsabilidade dificultam a navegação. Um controller pode guardar
  a lógica inteira do endpoint quando essa lógica pertence só a ele.
- **Regras de negócio (decisão D1).** Um controller chama o model direto no
  CRUD simples. Regra de negócio, transação em mais de uma tabela e lógica
  reutilizada por mais de um endpoint vão para `src/services/<domain>/`.
  Camadas obrigatórias de repositório, caso de uso ou service continuam
  rejeitadas.
- **Services** existem para as regras de negócio de um domínio ou para uma
  capacidade externa (armazenamento, pagamento, e-mail, voz). Um service que
  só repassa a chamada para um model é uma camada sem responsabilidade. Os
  arquivos terminam em `.service.ts`, `.rules.ts`, `.types.ts` ou `.test.ts`,
  para o papel de cada arquivo aparecer no nome.
- **Models** guardam forma, tipos e restrição de campo, não a regra de
  negócio central. Toda mudança de schema sai com uma migration reversível.
- **Bancos (decisão D8).** PostgreSQL via Sequelize é o padrão. MongoDB via
  Mongoose guarda só `ChatMessage` e `LoginLog`. Collection nova é decisão de
  arquitetura.
- **Lista fechada de pastas (decisão D3).** Pastas de primeiro nível em
  `src/`: assets, config, constants, controllers, docs (OpenAPI), errors,
  interfaces, jobs, middlewares, models, realtime, routes, services,
  templates (e-mail), types, utils e `__tests__`. O único arquivo solto é
  `app.ts`. Pasta nova é um padrão concorrente sem decisão do time.

## Anti-padrões

| Anti-padrão | Por que atrapalha |
| --- | --- |
| Controller de classe no meio de controllers funcionais | Dois paradigmas para uma responsabilidade |
| Service que só repassa para um model | Camada sem responsabilidade |
| Repositório ou caso de uso obrigatório | Arquitetura extra sem necessidade |
| Herança para compartilhar um pouco de comportamento | Comportamento implícito, difícil de rastrear |
| Helper para uma expressão trivial | Indireção para algo óbvio |
| Abstração por semelhança sintática | Apaga diferença de intenção |
| Contorno genérico | Uma exceção local disfarçada de abstração oficial |
| Categoria nova de pasta dentro de um pull request | Padrão concorrente sem decisão |

Sinais objetivos (controller de classe, pasta nova, sufixo de arquivo de
service) podem virar checagens de CI. Os subjetivos (service que só repassa,
utilitário com lógica de domínio, abstração depois de uma ocorrência) ficam
como sugestão de review.

## Ainda não decidido

Isto nunca foi discutido com exemplos concretos e ainda não pode virar regra
rígida: onde a validação mora (controller, middleware ou schema do model),
onde cada camada é testada, convenções de nome, e services concretos para
retentativa, fila e outros clientes externos.

## Como as regras dos agentes funcionam

- **Fonte única.** `.agents/rules/*.md`, em inglês, com frontmatter
  (`description`, `trigger`, `globs`, `alwaysApply`):
  - `00-core.md`: stack, arquitetura, regras de código, governança. Toda
    ferramenta carrega este arquivo em toda conversa, por isso ele fica curto
    (cerca de 60 linhas).
  - `01-overlay.md`: iniciativas temporárias e exceções legadas, cada uma com
    dono e data de validade.
  - `02-<layer>.md`, `03-tests.md`, `04-infra.md`: carregados só quando o
    agente trabalha em arquivos correspondentes.
- **Arquivos gerados.** `npm run rules:sync` (`scripts/rules/sync.mjs`)
  escreve `AGENTS.md` (Codex, Cursor, Antigravity), `CLAUDE.md` (importa
  `AGENTS.md`), `.github/copilot-instructions.md`, `.claude/rules/`,
  `.cursor/rules/`, `.github/instructions/` e `.claude/settings.json`. Cada
  ferramenta recebe o mesmo texto, sem depender de import. Arquivo gerado
  nunca é editado à mão.
- **Trava de edição.** `.claude/settings.json` impede o Claude Code de editar
  as regras e a aplicação delas. As outras ferramentas só têm o texto de
  governança no núcleo.
- **Arquivos locais.** Os hooks do Git (`post-merge`, `post-checkout`,
  `post-rewrite`, instalados pelo husky no `npm install`) rodam
  `sync.mjs --enforce`: regeneram as saídas e movem arquivos de instrução não
  rastreados (`CLAUDE.local.md`, `.cursorrules`, `AGENTS.md` numa subpasta,
  arquivos soltos em `.cursor/rules/` e semelhantes) para
  `.git/rules-quarantine/<data>/`. Nada é apagado.
- **CI.** O workflow `Rules` (job `Rules (sync + instruction files)`) falha
  quando os arquivos gerados divergem da fonte, e quando um pull request
  adiciona arquivos de instrução fora do sistema, documentos no estilo de
  plano ou logs.
- **CODEOWNERS.** Regras e arquivos de aplicação precisam de aprovação de
  quem é dono das regras. O texto de governança tem uma abertura ("a menos
  que a pessoa diga que a tarefa atual é manutenção de rules"). O CODEOWNERS
  fecha essa abertura.
- **Ajuste gradual.** Código existente fora das regras não é refatorado em
  massa. Ele fica listado em `01-overlay.md`. Um agente que edita um arquivo
  desses corrige esse arquivo e só os imports diretos de que a correção
  precisa, e para para perguntar se a correção crescer além disso. As regras
  vencem o código existente, então o padrão errado nunca é copiado só porque
  já está lá.

As regras nunca mandam um agente ler este documento: isso gastaria tokens em
toda conversa.

## Manutenção

Uma regra nova nasce de um erro repetido de agente, nunca de "quem sabe um
dia".

1. **Mudar uma regra:** edite só o `.md` em `.agents/rules/`, rode
   `npm run rules:sync` e faça o commit da fonte e dos arquivos gerados
   juntos, num pull request que muda só rules, com título
   `chore(rules): ...`. A descrição nomeia o erro de agente que motivou a
   mudança.
2. **Convenção nova:** o que vale em todo lugar e cabe numa linha vai para o
   núcleo. O que vale para uma pasta vai para a camada dessa pasta. Camada
   nova só quando uma pasta não tem cobertura e os agentes falham ali mais de
   uma vez.
3. **Iniciativa temporária:** uma seção em `01-overlay.md` com nome, data de
   validade (até 90 dias) e dono. Quando acaba, apague a seção. Convenção
   permanente vira uma ou duas linhas numa camada.
4. **Orçamento de tokens:** núcleo em torno de 60 linhas. Camadas com 3 a 10
   itens que não repetem o núcleo. Nunca `alwaysApply: true` numa camada.
5. **Revisão mensal:** confira em pelo menos duas ferramentas se cada uma
   recebe o núcleo e a camada certa. No Claude Code, `/doctor prompt-audit`
   aponta instruções contraditórias e referências a arquivos que não existem.
6. **Preferência pessoal** (idioma da resposta, tom, estilo de commit) fica
   na configuração da ferramenta de cada pessoa, nunca no repositório.
