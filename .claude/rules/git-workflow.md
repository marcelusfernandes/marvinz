# Git Workflow

## Branch model

- `main` → produção. Atualizado **somente** via PR aprovada de `develop`.
- `develop` → desenvolvimento ativo. Base de toda branch nova.
- `<type>/<slug>` → feature/fix, criadas a partir de `develop`.

## Branch naming

Slug em kebab-case. Prefixo conforme o tipo:

| Prefixo      | Quando usar                                            |
| ------------ | ------------------------------------------------------ |
| `feat/`      | Nova funcionalidade voltada ao usuário                 |
| `fix/`       | Correção de bug                                        |
| `refactor/`  | Reestrutura de código sem mudar comportamento          |
| `perf/`      | Otimização de performance                              |
| `chore/`     | Deps, configs, tooling, infra                          |
| `docs/`      | Documentação apenas                                    |
| `test/`      | Adição/ajuste de testes                                |
| `ci/`        | CI/CD, GitHub Actions, hooks                           |

Exemplos: `feat/wikilinks`, `fix/pty-spawn-race`, `refactor/file-tree`, `chore/upgrade-electron`, `docs/readme`.

## Fluxo para uma nova mudança

1. `git checkout develop && git pull`
2. `git checkout -b <type>/<slug>`
3. Implementar e commitar na branch
4. **Aguardar usuário confirmar** que funciona
5. **Após confirmação**: `git push -u origin <type>/<slug>` e `gh pr create --base develop`
6. Parar. Usuário revisa e decide o merge.

## Regras invioláveis

- **Nunca** committar direto em `main` ou `develop`
- **Nunca** abrir PR para `main` (apenas `develop` → `main`, e essa decisão é do usuário)
- **Nunca** fazer merge de PR — usuário sempre revisa
- **Não** push da feature branch antes da confirmação do usuário
- **Não** force-push em `main` ou `develop` em hipótese nenhuma

## Commit message

Formato: `<type>: <descrição curta no imperativo>`
- Mesmo `<type>` da branch (`feat`, `fix`, `refactor`, etc.)
- Descrição em letra minúscula, sem ponto final
- Atribuição (Co-Authored-By) está desabilitada globalmente

Exemplo: `feat: wikilink resolver by basename`
