---
description: Cria uma issue no GitHub seguindo o padrão User Story / Contexto / Cenário atual / Problema / Consequências / Solução / Resultado esperado
argument-hint: Descrição livre do problema/feature (texto, imagens, links, screenshots)
---

# /issues:create — Criação padronizada de issue no GitHub

Você está criando uma issue no GitHub a partir da descrição abaixo. **Siga rigorosamente** o padrão de seções definido neste comando — ele é o contrato para issues deste fluxo.

Entrada do usuário: $ARGUMENTS

---

## Passos obrigatórios

### 1. Capturar contexto

- Leia atentamente a descrição do usuário (texto + screenshots + referências a arquivos).
- Se o usuário citou arquivos, símbolos ou pastas, **abra rapidamente** com `Read` / `grep` para citar com precisão (`arquivo.py:linha`) na issue. Não invente referências.
- Não pergunte ao usuário se ele já disse "trabalhe sem parar para perguntas" — faça a chamada razoável e siga. Caso contrário, faça **no máximo 1-2 perguntas** apenas se houver ambiguidade séria sobre o objetivo da issue.

### 2. Identificar repositório e auth

- `git remote -v` para descobrir o repo (`owner/name`).
- Se o repo for de uma organização, confirme que a conta `gh` ativa tem acesso:
  - `gh auth status`
  - Se `gh issue create` falhar com `Could not resolve to a Repository`, rode `gh auth switch --user <conta-com-acesso>` e tente de novo.
- Se não houver `gh` autenticado para o repo, **pare** e peça ao usuário para autenticar.

### 3. Escolher título e label

- **Título** segue Conventional Commit: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`, com escopo opcional. Curto (< 80 chars), em PT-BR ou EN conforme o tom do usuário.
- **Labels**: use `gh label list` para ver as labels do repo e escolher 1-2 que façam sentido (`enhancement`, `bug`, `security`, `documentation`, etc.). Se a label não existir, omita — não crie label nova sem pedir.

### 4. Escrever o corpo da issue no padrão abaixo

**Header (antes de User Story)** — quote-block com metadata estrutural. Inclua:

```markdown
> **Tamanho:** <S | M | L> — <descrição curta do escopo>
> **Parent / Sub-issues:** <#refs ou "nenhuma">
```

**Convenção de Tamanho** (calibrada para AI Coding Agents executando via /squad ou Agent SDK, NÃO estimativa de dev humano):

- **S** — Cabe em 1 sessão curta (<30min de janela de contexto). Tipicamente: fix cirúrgico em 1-2 arquivos, ou refactor mecânico sem nova lógica.
- **M** — Cabe em 1 sessão média (1-2h). Tipicamente: feature cross-layer simples (1-2 IPC handlers + UI + testes), ou refactor com decisões de design.
- **L** — Requer múltiplas sessões ou squad com 3+ teammates e gates humanos. Tipicamente: feature cross-layer complexa com PRD + segurança + UI nova + testes E2E + risco de iterar review.

**Importante**: NÃO use "~N dias" em estimativas. Tempo wallclock pra agente é dominado por (a) tamanho da janela de contexto, (b) número de gates humanos, (c) iterações de review. Dias-pessoa só faz sentido pra reuniões e priorização de roadmap humano.

```markdown
## User Story

**Como** <persona>,
**quero** <capacidade desejada>,
**para que** <benefício/valor>.

---

## Contexto

<Background técnico/negócio necessário para entender a issue. Cite arquivos, módulos, fluxos, decisões prévias. Use links/refs concretas (`src/x/y.py:42`).>

## Cenário atual

<O que o sistema faz hoje, com precisão. Inclua trechos de código, JSON de exemplo, fluxos ou screenshots quando relevante. Liste arquivos/locais envolvidos.>

## Problema

<Descreva o(s) problema(s) de forma numerada quando houver mais de um. Foco no GAP entre o atual e o desejável. Sem solução aqui.>

## Consequências do problema

<Impacto concreto: experiência do usuário, risco técnico, custo, segurança, dívida, compliance, etc. Bullets.>

---

## O que é a solução

<Descrição da solução proposta. Pode subdividir em itens numerados (1., 2., ...) com sub-seções (`### 1. ...`) se for multi-parte. Cite contratos de dados, estados, módulos, testes. Indique trade-offs e preferências quando houver mais de uma opção.>

## Resultado esperado com a solução

<O estado final observável após a entrega. Lista de bullets descrevendo "depois desta mudança, X acontece e Y deixa de acontecer". Concreto e verificável.>

---

## Acceptance Criteria

- [ ] <critério 1 — verificável>
- [ ] <critério 2>
- [ ] Testes (unit / integration / e2e conforme aplicável)
- [ ] Documentação atualizada (README da pasta tocada, rules do projeto se necessário)

## Fora de escopo

- <itens explicitamente excluídos para não inflar a issue>

## Referências

- <arquivos relevantes com caminho:linha>
- <rules do projeto em `.claude/rules/permanent/` quando aplicável>
- <links externos / docs / issues relacionadas>
```

### 5. Criar a issue

Use HEREDOC para preservar formatação:

```bash
gh issue create \
  --repo <owner/name> \
  --title "<title>" \
  --label <label1> --label <label2> \
  --body "$(cat <<'EOF'
<corpo da issue conforme padrão>
EOF
)"
```

### 6. Reportar ao usuário

- Retorne a URL da issue.
- Resuma em 3-5 bullets: título, labels, seções incluídas, qualquer ajuste de auth que tenha sido necessário.

---

## Regras de qualidade

- **Padrão de seções é fixo**: header (Tamanho + Parent/Sub-issues) → User Story → Contexto → Cenário atual → Problema → Consequências do problema → O que é a solução → Resultado esperado com a solução → Acceptance Criteria → Fora de escopo → Referências. **Não pule seções**. Se uma seção genuinamente não se aplica, escreva "N/A" com 1 frase explicando.
- **Tamanho NÃO é estimativa de dias humanos**: é classificação de complexidade pra AI agent (S/M/L = sessão curta/média/múltiplas — ver definição completa no Passo 4). Não escreva "~N dias" no campo.
- **User Story em primeira pessoa do usuário do sistema**, não do dev. Persona realista (cliente, engenheiro de plantão, analista de segurança, etc.).
- **Cenário atual ≠ Problema**: Cenário descreve o comportamento; Problema é o gap. Não misturar.
- **Solução não vai dentro do Problema**, e vice-versa.
- **Citações concretas** > prosa genérica. Use `arquivo.py:linha` sempre que possível.
- **Acceptance criteria verificáveis**: cada item deve ser testável objetivamente (sem "melhorar X", sim "X passa a retornar Y quando Z").
- **Idioma**: respeite o idioma do usuário (geralmente PT-BR neste projeto).
- **Sem markdown quebrado**: valide que blocos de código fecham, listas estão consistentes, links válidos.
- **Não crie commits, branches ou PRs** — esta skill cria **somente issue**.
- **Não rotacione secrets nem invente CVEs** — issues de segurança descrevem o problema; mitigação operacional é responsabilidade de quem implementa.

## Anti-patterns

- Misturar "o que é" com "como fazer" na User Story.
- Listar 20 acceptance criteria que ninguém vai validar — prefira 5-10 incisivos.
- Copiar trechos longos de código sem necessidade — bloco curto + referência ao arquivo basta.
- Criar issue sem ler o screenshot/arquivo citado pelo usuário.
- Esquecer de listar referências às rules do projeto (`.claude/rules/permanent/`) quando a issue toca uma área governada por elas.
