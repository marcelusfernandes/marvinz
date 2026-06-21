# Build Guide — Complexity-Estimation Harness for Agent Teams

> **Para quem lê isto:** você (Claude) recebeu este arquivo para **construir um
> harness de estimativa de complexidade de tasks** num projeto novo. Este doc é
> autocontido: traz a filosofia, as decisões não-negociáveis (com o porquê), o
> código dos artefatos e os passos de build. Adapte os nomes/caminhos ao projeto
> alvo, mas **não dilua os princípios** — eles são a razão do harness não virar
> teatro de métricas.

---

## 0. TL;DR — o que é

Um loop de aprendizado em cima de um time de agentes que já faz discovery/triagem:

1. **Na criação da issue**, o time de discovery emite um `PredictionVector` —
   um vetor de sinais de complexidade (estruturais + de deliberação) + a decisão
   de roteamento (quanto oversight humano).
2. **Pós-merge da issue**, um time de medição separado emite um `OutcomeRecord` —
   o que de fato aconteceu (iterações, arquivos, retrabalho), lido de git/gh.
3. O par `(prediction, outcome)` com o mesmo `issue_id` é um **exemplo rotulado**.
4. Acumulados N pares, uma **trend card** (Camada 3) mostra quais sinais a priori
   realmente predizem dificuldade — validável contra o instinto de quem acompanha
   o projeto de perto.

**A barra é TENDÊNCIA, não precisão matemática.** Não é um modelo estatístico; é
um instrumento de legibilidade e accountability do roteamento.

---

## 1. Princípios não-negociáveis (com o porquê)

Estes são os pontos onde a ideia ingênua falha. Não pule nenhum.

### 1.1 O harness é o AGENTE, não código com chamadas de API

Os campos são preenchidos por agentes como **subproduto da deliberação que já
fazem** — não por um pipeline determinístico. Consequência direta no item seguinte.

### 1.2 Dois eixos de honestidade, não um

- **`ScoreSource`** (`heuristic` | `calibrated`): quão confiável é o peso agregado.
- **`Provenance`** (`measured` | `estimated`): **como o sinal numérico veio.**
  Um agente que devolve um float (ex.: centralidade de grafo) está emitindo
  OPINIÃO, não medida — a menos que tenha **rodado uma tool de verdade** (grep,
  script, query). Todo sinal numérico carrega `provenance` + `evidence` (o
  comando rodado). _Float sem proveniência é mentira neste harness._

### 1.3 Não estime o que não dá pra medir confiavelmente

Centralidade de nó (betweenness/pagerank) **não é estimável por LLM**. Deixe o
campo `null` a menos que tenha computado de verdade. Melhor um buraco honesto que
um número inventado que polui a calibração.

### 1.4 Outcomes vêm de git/gh, não de julgamento

O time de medição **consulta** `git`/`gh` para o factual (arquivos tocados,
ciclos de review, reopen, retrabalho) e só **julga** o resíduo genuinamente não
mensurável (ex.: "quantas vezes um humano teve que decidir algo"), marcando-o
`estimated`. **Trave a definição operacional de cada campo de outcome ANTES de
coletar o primeiro registro** — senão o label drifta e o corpus apodrece.

### 1.5 `harness_version` controla drift — e é traiçoeiro num harness agêntico

A "versão" não é um SHA de código de app: é a composição que muda o comportamento
dos agentes → `f"{model}+{hash(prompts dos agentes + specs dos comandos)}"`.
Toda edição nesses prompts muda a distribuição dos sinais. **Tendências só são
comparáveis dentro de uma mesma `harness_version`.** Use **content hash** (não
commit hash): edições locais não commitadas já mudam a distribuição.

> ⚠️ Risco real: se você muda os prompts toda semana, talvez nunca acumule
> exemplos suficientes por versão. Mitigação: congele a _lógica de extração de
> sinais_ mesmo evoluindo o resto.

### 1.6 Independência dos três papéis

Quem **prediz** ≠ quem **implementa** ≠ quem **mede/calibra**. Se o mesmo contexto
prediz e mede, os erros se correlacionam e o sistema se auto-justifica. Times/
comandos separados.

### 1.7 Confound do oversight

A decisão de oversight é tomada A PARTIR da predição e depois AFETA o outcome
(mandar review denso reduz bugs). A calibração deve tratar `assigned_oversight`
como **variável de tratamento** (auditoria de roteamento), não como label limpo.

### 1.8 Calibração-por-agente é caça-ruído, não regressão

Com N pequeno (dezenas) e ~12 sinais, ajustar pesos = overfit; e um agente
"calibrando" sobre 20 exemplos **confabula** padrão confiante onde só há ruído.
A Camada 3 emite **direção + nº de exemplos + confiança honesta**, não um float
em que se confia. `score_source` fica `heuristic` por muito tempo, de propósito.

### 1.9 Nunca gateie o workflow

A emissão é **append-only e não-fatal**. Se falhar (CLI erra, sinal faltando),
registre o que deu ou pule — emitir JAMAIS pode travar a missão de discovery.

---

## 2. Adapte ao seu projeto (o que varia)

Antes de codar, mapeie:

| Variável                        | No projeto-fonte                                            | No seu projeto                                      |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| Onde nascem as "issues/tasks"   | comando `/discovery` (agent team) que cria issues no GitHub | ? (qualquer fluxo que produza unidades de trabalho) |
| Chave de pareamento             | nº da issue no GitHub                                       | ? (id estável: nº de issue, ticket, etc.)           |
| `domains_touched` possíveis     | módulos do monólito (auth, commerce, ...)                   | ? (liste os domínios reais)                         |
| Onde mora o código tocável      | `src/`                                                      | ?                                                   |
| Diretórios que definem o agente | `.claude/agents` + `.claude/commands`                       | ? (onde estão os prompts/specs)                     |
| Model id                        | `claude-opus-4-8`                                           | ?                                                   |
| Onde mora o harness (tooling)   | `scripts/complexity/` (pacote Python)                       | ? (fora do runtime do app)                          |

---

## 3. Arquitetura

```
DISCOVERY (emite)                MEDIÇÃO, separado (registra)        CAMADA 3
─────────────────                ───────────────────────────        ────────
delibera ─┐                      pós-merge ─┐
grep no   ├─> PredictionVector   lê git/gh  ├─> OutcomeRecord   ──> pareia por issue_id
repo    ──┘    │                            ┘    │                  (mesma harness_version)
               └──> predictions.jsonl ───────────└──> outcomes.jsonl  └──> TrendReport (trend card)
```

- **Ledger:** dois arquivos JSONL append-only (`predictions.jsonl`,
  `outcomes.jsonl`). Pareamento por `issue_id` na LEITURA (join em memória),
  "last write per issue_id wins". Versionado no git (você quer ler o histórico
  cru em diff).
- **Validação na fronteira:** toda escrita passa pelos modelos pydantic; registro
  malformado nunca chega ao ledger.

---

## 4. Fase 1 — emissão + ledger (construa primeiro, valide, só então Fase 2)

Crie um pacote de tooling (ex.: `scripts/complexity/`) — **fora do runtime do
app**. Dependências: `pydantic>=2`.

### 4.1 `schema.py` — o contrato

```python
"""Schema do harness de estimativa de complexidade (AGÊNTICO).

Campos preenchidos por AGENTES como subproduto da deliberação. Sinal numérico
sem `provenance` é opinião disfarçada de medida — ver Provenance/Metric.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

SCHEMA_VERSION = "2.0"


class Severity(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Band(StrEnum):
    """Banda qualitativa enquanto não houver dados p/ um float honesto."""

    low = "low"
    medium = "medium"
    high = "high"


class Oversight(StrEnum):
    autonomous = "autonomous"      # delega à IA, review leve
    light_review = "light_review"  # humano revisa, sem pareamento
    deep_review = "deep_review"    # sênior + supervisão densa


class ScoreSource(StrEnum):
    heuristic = "heuristic"    # pesos chutados — não confiar p/ decisão dura
    calibrated = "calibrated"  # pesos/tendências vindos da Camada 3


class Provenance(StrEnum):
    measured = "measured"    # agente RODOU tool (grep/script/query) — reproduzível
    estimated = "estimated"  # julgamento do agente — vibe, tratar com suspeita


class Metric(BaseModel):
    """Sinal numérico que carrega COMO foi obtido. Nunca finja `measured`."""

    value: float
    provenance: Provenance
    evidence: str | None = Field(
        None, description="Se measured: o comando rodado. Se estimated: a base do palpite."
    )


class Risk(BaseModel):
    description: str
    severity: Severity
    raised_by: str | None = Field(None, description="Qual agente levantou.")


class StructuralSignals(BaseModel):
    """CAMADA 1 — sinais do grafo de dependências. Só é 'não-opinião' quando measured."""

    downstream_fanout: Metric = Field(..., description="Quem QUEBRA se eu mexer = blast radius.")
    upstream_fanout: Metric = Field(..., description="De quanto dependo = carga de contexto p/ entender.")
    domains_touched: list[str] = Field(default_factory=list, description="Domínios atravessados.")
    # NÃO estime centralidade por LLM. Só preencha se computou de verdade; senão None.
    max_node_centrality: Metric | None = Field(None, description="Centralidade máx. [0..1] do nó tocado.")
    touches_shared_contract: bool = Field(..., description="Toca interface consumida por outros?")
    touches_nondeterministic: bool = Field(..., description="Toca prompt/IA em produção? Peso desproporcional.")

    @property
    def domain_boundaries_crossed(self) -> int:
        return max(0, len(set(self.domains_touched)) - 1)


class AgentSignals(BaseModel):
    """CAMADA 2 — subproduto da deliberação do time (quase de graça)."""

    risks_raised: list[Risk] = Field(default_factory=list)
    uncovered_angles_count: int = Field(0, description="Ângulos não contemplados trazidos pelos agentes.")
    spec_branch_count: int = Field(1, description="Cenários/ramos de aceitação que a spec implica.")
    rounds_to_convergence: int = Field(..., description="Rodadas até o time convergir. Proxy de divergência.")
    disagreement_score: float | None = Field(None, ge=0.0, le=1.0, description="0=consenso, 1=conflito.")

    @property
    def weighted_risk_score(self) -> float:
        w = {Severity.low: 1, Severity.medium: 3, Severity.high: 7, Severity.critical: 15}
        return float(sum(w[r.severity] for r in self.risks_raised))


class PredictionVector(BaseModel):
    issue_id: str
    predicted_at: str = Field(..., description="ISO 8601.")
    schema_version: str = SCHEMA_VERSION
    harness_version: str  # {model}+{hash dos prompts/comandos} — controla drift

    structural: StructuralSignals
    agents: AgentSignals

    predicted_size: Band = Field(..., description="Tamanho esperado do diff. Melhor preditor de esforço.")
    predicted_iterations: Band
    predicted_decision_density: Band = Field(..., description="Intervenções de julgamento humano esperadas.")
    prediction_confidence: Band = Field(Band.medium, description="Confiança do time NA predição.")

    complexity_score: float | None = None  # derivado; só p/ roteamento, nunca ranking de pessoas
    score_source: ScoreSource = ScoreSource.heuristic

    # Decidido A PARTIR da predição e AFETA o outcome → variável de tratamento na calibração.
    assigned_oversight: Oversight
    assigned_to: str | None = Field(None, description="NUNCA p/ ranquear pessoas.")


class OutcomeRecord(BaseModel):
    """Registrado pós-merge por um time SEPARADO. Factual vem de git/gh; resíduo é julgado."""

    issue_id: str
    completed_at: str
    harness_version: str

    actual_files_touched: Metric = Field(..., description="git diff --name-only base...merge | wc -l")
    actual_iterations: Metric = Field(..., description="DEF. TRAVADA: ciclos de review + commits de correção pós-1º review.")
    actual_downstream_fanout: Metric = Field(..., description="Fanout real recomputado pós-merge.")
    pr_review_cycles: Metric | None = None
    time_to_merge_hours: Metric | None = None

    revisited: bool = Field(False, description="Issue reaberta na janela. Medível via gh.")
    revisit_window_days: int = 30
    rework_after_merge: bool = Field(False, description="Código do merge reescrito/deletado na janela.")

    escaped_to_production: bool = False
    nondeterministic_regression: bool | None = Field(None, description="Se tocou IA: evals de prod degradaram?")

    # Único campo inerentemente julgado → estimated. Label mais ruidoso; calibração desconfia dele.
    actual_human_interventions: Metric = Field(..., description="Vezes que um humano teve que decidir/corrigir.")


class CalibrationPair(BaseModel):
    prediction: PredictionVector
    outcome: OutcomeRecord

    @property
    def fanout_underestimate(self) -> float:
        """>0 = discovery subestimou o alcance = sinal da qualidade do próprio harness."""
        return self.outcome.actual_downstream_fanout.value - self.prediction.structural.downstream_fanout.value

    @property
    def same_harness(self) -> bool:
        return self.prediction.harness_version == self.outcome.harness_version


class SignalTrend(BaseModel):
    signal_name: str
    direction: str                       # ex.: "tocar IA -> mais iterações"
    supporting_examples: int
    confidence: Band                     # fraco (<~8 ex.) | sugestivo | consistente
    based_on_measured_only: bool = True  # inclui sinais estimated? -> tendência mais frágil
    note: str | None = None


class TrendReport(BaseModel):
    generated_at: str
    harness_version: str                 # tendência só vale dentro de uma versão
    pairs_analyzed: int
    trends: list[SignalTrend] = Field(default_factory=list)
    routing_audit: str | None = None     # o assigned_oversight acertou?
    score_source: ScoreSource = ScoreSource.heuristic
```

### 4.2 `harness_version.py` — content hash de prompts + comandos

```python
"""harness_version = f"{model}+{hash}", hash = content hash dos diretórios que
definem o comportamento dos agentes. Content-addressed (edições locais contam).
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]          # ajuste a profundidade
_DEFAULT_DIRS = (".claude/agents", ".claude/commands")     # ajuste ao seu projeto


def compute_hash(repo_root: Path | None = None, rel_dirs: tuple[str, ...] = _DEFAULT_DIRS) -> str:
    root = repo_root or _REPO_ROOT
    digest = hashlib.sha1()
    files: list[Path] = []
    for rel in rel_dirs:
        base = root / rel
        if base.is_dir():
            files.extend(p for p in base.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    for f in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        digest.update(f.relative_to(root).as_posix().encode())
        digest.update(f.read_bytes())
    return digest.hexdigest()[:7]


def harness_version(model: str, repo_root: Path | None = None) -> str:
    return f"{model}+{compute_hash(repo_root)}"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("usage: python -m <pkg>.harness_version <model-id>", file=sys.stderr)
        return 2
    print(harness_version(args[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

### 4.3 `ledger.py` — JSONL append-only + join

```python
"""Ledger JSONL append-only. Pareamento por issue_id na leitura."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from <pkg>.schema import CalibrationPair, OutcomeRecord, PredictionVector

if TYPE_CHECKING:
    from pydantic import BaseModel

_REPO_ROOT = Path(__file__).resolve().parents[2]
LEDGER_DIRNAME = "_complexity-ledger"
PREDICTIONS_FILE = "predictions.jsonl"
OUTCOMES_FILE = "outcomes.jsonl"


def ledger_dir(repo_root: Path | None = None) -> Path:
    return (repo_root or _REPO_ROOT) / LEDGER_DIRNAME


def _append(path: Path, model: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(model.model_dump_json() + "\n")


def append_prediction(prediction: PredictionVector, repo_root: Path | None = None) -> Path:
    path = ledger_dir(repo_root) / PREDICTIONS_FILE
    _append(path, prediction)
    return path


def append_outcome(outcome: OutcomeRecord, repo_root: Path | None = None) -> Path:
    path = ledger_dir(repo_root) / OUTCOMES_FILE
    _append(path, outcome)
    return path


def _read(path: Path, model_cls: type[BaseModel]) -> list:
    if not path.exists():
        return []
    return [model_cls.model_validate_json(s) for s in path.read_text("utf-8").splitlines() if s.strip()]


def read_predictions(repo_root: Path | None = None) -> list[PredictionVector]:
    return _read(ledger_dir(repo_root) / PREDICTIONS_FILE, PredictionVector)


def read_outcomes(repo_root: Path | None = None) -> list[OutcomeRecord]:
    return _read(ledger_dir(repo_root) / OUTCOMES_FILE, OutcomeRecord)


def calibration_pairs(repo_root: Path | None = None) -> list[CalibrationPair]:
    """Join por issue_id (last write wins). Só mesma harness_version entra."""
    preds = {p.issue_id: p for p in read_predictions(repo_root)}      # dict -> último vence
    outs = {o.issue_id: o for o in read_outcomes(repo_root)}
    pairs = []
    for issue_id, pred in preds.items():
        out = outs.get(issue_id)
        if out is not None and (pair := CalibrationPair(prediction=pred, outcome=out)).same_harness:
            pairs.append(pair)
    return pairs
```

### 4.4 `record_prediction.py` — CLI de emissão (valida + anexa)

```python
"""CLI: lê um PredictionVector JSON do stdin, valida, anexa. Exit: 0 ok / 1 inválido / 2 uso.
A emissão é NÃO-FATAL — o fluxo de discovery trata exit!=0 sem abortar a missão."""

from __future__ import annotations

import sys

from pydantic import ValidationError

from <pkg>.ledger import append_prediction
from <pkg>.schema import PredictionVector


def main(stdin_text: str | None = None) -> int:
    raw = (stdin_text if stdin_text is not None else sys.stdin.read()).strip()
    if not raw:
        print("error: nenhum JSON no stdin", file=sys.stderr)
        return 2
    try:
        prediction = PredictionVector.model_validate_json(raw)
    except ValidationError as exc:
        print(f"error: PredictionVector inválido:\n{exc}", file=sys.stderr)
        return 1
    print(f"recorded prediction for issue {prediction.issue_id} -> {append_prediction(prediction)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

### 4.5 Wiring — onde o agente emite

No seu fluxo de discovery/triagem, **depois de criar cada issue**, adicione um
passo (não-fatal) que instrui o agente a:

1. Computar `harness_version` com o seu model id:
   `python -m <pkg>.harness_version <model-id>`
2. Coletar **StructuralSignals (`measured`)** rodando tools reais:
   - `downstream_fanout` / `upstream_fanout`: grep de importadores / imports
     (registre o comando exato em `evidence`).
   - `domains_touched`: pelos paths que a solução tocaria.
   - `touches_shared_contract` / `touches_nondeterministic`: por path.
   - `max_node_centrality`: **`null`** (não estimar).
3. Coletar **AgentSignals** da própria deliberação: `rounds_to_convergence`,
   `risks_raised` (com `severity`), `uncovered_angles_count`, `spec_branch_count`.
4. Definir alvos + roteamento: `predicted_size/iterations/decision_density`,
   `prediction_confidence`, `assigned_oversight`.
5. Montar o JSON e fazer `echo '<json>' | python -m <pkg>.record_prediction`.

> Deixe explícito no prompt: **se qualquer passo falhar, registre o que conseguiu
> ou pule e siga — emitir nunca trava a missão.**

### 4.6 Testes (mínimos)

Cubra com `tmp_path` (nunca escreva no ledger real em teste):

- `harness_version`: formato, determinismo, muda quando o conteúdo muda.
- ledger: round-trip append/read; ledger vazio → `[]`.
- `calibration_pairs`: join por `issue_id`; exclui `harness_version` divergente;
  last-write-wins.
- CLI: JSON válido → 0; inválido → 1; vazio → 2; **nunca levanta exceção**.

---

## 5. Fase 2 — outcome + trend (só depois de validar a Fase 1 com dados reais)

1. **`record_outcome.py`** (análogo ao `record_prediction`) — um comando/time de
   medição **separado**, disparado **pós-merge**. Ele LÊ git/gh:
   - `actual_files_touched`: `git diff --name-only <base>...<merge> | wc -l`
   - `actual_iterations`: ciclos de review + commits de correção (`gh pr view --json reviews,commits`)
   - `revisited` / `rework_after_merge`: `gh` + `git log` na janela
   - `actual_human_interventions`: **julgado** (`estimated`, com `evidence`)
2. **Trend card** (`TrendReport`): sobre `calibration_pairs()` da MESMA
   `harness_version`:
   - binários → split + mediana de `actual_iterations`
   - ordinais → co-movimento por ranking
   - `confidence`: `fraco` (<~8 ex.), `sugestivo`, `consistente`
   - `routing_audit`: onde `assigned_oversight` sub/super-estimou (retorno mais
     acionável cedo — vira regra de roteamento antes de qualquer `complexity_score`).
3. **Não** ajuste pesos estatísticos com dezenas de exemplos. A trend card é
   leitura direcional pra cruzar com o instinto humano. `score_source` segue
   `heuristic`; só promova a `calibrated` quando uma tendência for `consistente`
   por mais de uma `harness_version` E sobreviver a uma janela de validação.

---

## 6. Anti-patterns (não faça)

- ❌ Colapsar tudo num `complexity_score` escalar cedo. Logue o VETOR cru.
- ❌ Emitir float de centralidade (ou qualquer métrica de grafo) sem ter rodado tool.
- ❌ Misturar `harness_version` diferentes na mesma análise de tendência.
- ❌ Deixar a emissão abortar a missão de discovery.
- ❌ Usar `assigned_to` para ranquear pessoas.
- ❌ Tratar `actual_human_interventions` como label confiável.
- ❌ Definir os campos de outcome só na hora de coletar (definição operacional
  tem que vir ANTES — senão o label drifta).
- ❌ Prometer "vira estimador" com dezenas de exemplos. É tendência, não modelo.

---

## 7. Checklist de validação (Fase 1)

- [ ] `schema.py` compila e valida um par predição/outcome de exemplo.
- [ ] Sinais numéricos carregam `provenance`; nenhum float `estimated` se passando por `measured`.
- [ ] `harness_version` muda quando você edita um prompt de agente.
- [ ] CLI rejeita JSON inválido com exit≠0 e **sem exceção**.
- [ ] Emissão não-fatal plugada no fluxo de discovery.
- [ ] `calibration_pairs` exclui pares de `harness_version` divergente.
- [ ] Ledger versionado; um `/discovery` real deposita ≥1 `PredictionVector`.
- [ ] Lint/format do projeto passando nos arquivos novos.

---

## 8. Por que isto vale, em uma frase

Mesmo que a calibração nunca vire estimador, o harness força o time a **articular
por que algo é complexo num formato consistente** e cria **trilha de auditoria do
roteamento** — e isso já melhora a qualidade das decisões de quem acompanha o
projeto de perto.
