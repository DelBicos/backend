# Teste de Caixa Preta — Busca Semântica

> Técnicas: **Partição de Equivalência** e **Análise de Valor Limite**.  
> Escopo: interfaces públicas do DelBicos usadas em [www.delbicos.com.br](https://www.delbicos.com.br) (app DelBicosV2 + API DelBicosBackend).  
> Os testes observam apenas entrada e saída da API. Não se baseiam em ramos internos do código.

**Execução:** `npm run test:unit` — suíte de busca de serviços, profissionais, disponibilidade e raio.

---

## 1. Funções observadas (visão de caixa preta)

| Função | Interface | Entradas observadas | Saída esperada |
| ------ | --------- | ------------------- | -------------- |
| Busca semântica de serviços | `GET /api/services` | `q`, `day`, `page`, `limit` | `200` + `{ total, page, limit, data }` |
| Busca semântica de profissionais | `GET /api/professionals` | `termo` | `200` + `{ professionals, totalCount, currentPage, pageSize }` |
| Busca para agendar | `GET /api/professionals/search-availability` | `subCategoryId`, `date`, `lat`, `lng` | `200` (lista) ou `400` |
| Configurar raio | `PUT /api/professionals/:id/radius` | `service_radius_km` | `200` ou `400` |

---

## 2. Partição de Equivalência

Cada classe representa um conjunto de entradas que o sistema deve tratar da mesma forma. Um representante por classe é suficiente.

### 2.1 Busca semântica (`q` / `termo`)

| ID da classe | Tipo | Domínio | Representante | Resultado esperado |
| ------------ | ---- | ------- | ------------- | ------------------ |
| PE-BS-V1 | Válida | Termo textual não vazio | `"Limpeza"` / `"Ana"` | Filtro aplicado; `200` |
| PE-BS-V2 | Válida | Ausência de termo | `q` omitido / `""` | Lista sem filtro de texto; `200` |
| PE-BS-V3 | Válida | Só espaços | `"   "` | Tratado como ausência de termo; `200` |
| PE-BS-I1 | Inválida | Tipo diferente de string | `q=["Limpeza"]` | Filtro ignorado; busca não quebra |

### 2.2 Busca de disponibilidade para agendar

| ID da classe | Tipo | Domínio | Representante | Resultado esperado |
| ------------ | ---- | ------- | ------------- | ------------------ |
| PE-AG-V1 | Válida | `subCategoryId` + `date` `AAAA-MM-DD` | `1` + `2026-10-01` | `200` com horários |
| PE-AG-V2 | Válida | Subcategoria sem profissionais | `99` | `200` e `[]` |
| PE-AG-I1 | Inválida | `subCategoryId` ausente | só `date` | `400` |
| PE-AG-I2 | Inválida | `date` ausente | só `subCategoryId` | `400` |
| PE-AG-I3 | Inválida | Data em formato não ISO | `01/10/2026` | `400` |

---

## 3. Análise de Valor Limite

Para cada intervalo `[mín, máx]`, testam-se **mín−1**, **mín**, **mín+1**, **máx−1** (quando fizer sentido), **máx** e **máx+1**.

### 3.1 Paginação da busca (`page` ≥ 1, `limit` ∈ [1, 100])

| Variável | mín−1 | mín | máx | máx+1 | Observado |
| -------- | ----- | --- | --- | ----- | --------- |
| `page` | `0` → normaliza para `1` | `1` | (sem teto publicado) | — | BS-L-01, BS-L-02 |
| `limit` | `0` → cai no default `20` | `1` | `100` | `101` → `100` | BS-L-03 a BS-L-05 |

### 3.2 Dia da semana (`day` ∈ [0, 6])

| Valor | Classe | Caso |
| ----- | ------ | ---- |
| `-1` | abaixo do mínimo | BS-I-03 |
| `0` | mínimo (domingo) | BS-L-06 |
| `6` | máximo (sábado) | BS-L-07 |
| `7` | acima do máximo | BS-I-02 |

### 3.3 Distância do cliente × raio do profissional (aceita se `distância ≤ raio`)

Raio de referência: **10 km**.

| Distância | Relação com o limite | Esperado | Caso |
| --------- | -------------------- | -------- | ---- |
| 0 km | mínimo (mesmo ponto) | aceito | AG-L-03 |
| 9,99 km | logo abaixo do raio | aceito | AG-L-01 |
| 10,5 km | logo acima do raio | excluído | AG-L-02 |

### 3.4 `service_radius_km` ≥ 0

| Valor | Esperado | Caso |
| ----- | -------- | ---- |
| `-1` | `400` | AG-L-05 |
| `0` | aceito | AG-L-04 |
| `1` | aceito | AG-L-06 |

---

## 4. Casos de teste documentados

| ID | Técnica | Interface | Entrada | Esperado |
| -- | ------- | --------- | ------- | -------- |
| BS-V-01 | PE válida | `GET /services?q=Limpeza` | termo típico | `200`, filtro LIKE |
| BS-V-02 | PE válida | `q=""` | termo vazio | busca sem filtro de título |
| BS-V-03 | PE válida | `q="   "` | só espaços | igual a sem termo |
| BS-I-01 | PE inválida | `q=["Limpeza"]` | tipo errado | não quebra; ignora filtro |
| BS-V-04 | PE válida | `GET /professionals?termo=Ana` | termo típico | filtro nome/e-mail/CPF |
| BS-V-05 | PE válida | sem `termo` | — | lista sem filtro textual |
| BS-V-06 | PE válida | `termo=""` | vazio | sem filtro textual |
| BS-L-01 | VL | `page=1` | mínimo | `page=1`, `offset=0` |
| BS-L-02 | VL | `page=0` | mín−1 | normaliza para `1` |
| BS-L-03 | VL | `limit=1` | mínimo | `limit=1` |
| BS-L-04 | VL | `limit=100` | máximo | `limit=100` |
| BS-L-05 | VL | `limit=101` | máx+1 | `limit=100` |
| BS-L-06 | VL | `day=0` | mínimo | filtra domingo |
| BS-L-07 | VL | `day=6` | máximo | filtra sábado |
| BS-I-02 | PE inválida | `day=7` | fora do domínio | filtro aplicado (comportamento atual) |
| BS-I-03 | PE inválida | `day=-1` | fora do domínio | filtro aplicado (comportamento atual) |
| AG-V-01 | PE válida | busca disponibilidade | data ISO + subcategoria | lista com horários |
| AG-V-02 | PE válida | subcategoria vazia | `99` | `[]` |
| AG-I-01 | PE inválida | sem `subCategoryId` | — | `400` |
| AG-I-02 | PE inválida | sem `date` | — | `400` |
| AG-I-03 | PE inválida | `01/10/2026` | formato errado | `400` |
| AG-L-01 | VL | dist ≈ 9,99 km, raio 10 | abaixo do limite | profissional aparece |
| AG-L-02 | VL | dist ≈ 10,5 km, raio 10 | acima do limite | excluído |
| AG-L-03 | VL | dist = 0 | mínimo | aparece |
| AG-L-04 | VL | raio `0` | mínimo | `200` |
| AG-L-05 | VL | raio `-1` | mín−1 | `400` |
| AG-L-06 | VL | raio `1` | mín+1 | `200` |

---

## 5. Tabela de execução

Comando: `npm run test:unit`  
Ambiente: Node local, Jest projeto `unit` (sem banco).

| ID | Resultado obtido | Status | Evidência (arquivo de teste) |
| -- | ---------------- | ------ | ---------------------------- |
| BS-V-01 | `200`, LIKE `%Limpeza%` | PASSOU | `service.controller.test.ts` |
| BS-V-02 | sem `where.title` | PASSOU | `service.controller.test.ts` |
| BS-V-03 | sem `where.title` | PASSOU | `service.controller.test.ts` |
| BS-I-01 | lista retornada, filtro ignorado | PASSOU | `service.controller.test.ts` |
| BS-V-04 | filtro nome/e-mail/CPF | PASSOU | `professional.search.test.ts` |
| BS-V-05 | `where` sem `Op.or` | PASSOU | `professional.search.test.ts` |
| BS-V-06 | `where` sem `Op.or` | PASSOU | `professional.search.test.ts` |
| BS-L-01 | `page=1`, `offset=0` | PASSOU | `service.controller.test.ts` |
| BS-L-02 | `page` normalizado para `1` | PASSOU | `service.controller.test.ts` |
| BS-L-03 | `limit=1` | PASSOU | `service.controller.test.ts` |
| BS-L-04 | `limit=100` | PASSOU | `service.controller.test.ts` |
| BS-L-05 | `limit=100` (clamp) | PASSOU | `service.controller.test.ts` |
| BS-L-06 | `day_of_week=0` | PASSOU | `service.controller.test.ts` |
| BS-L-07 | `day_of_week=6` | PASSOU | `service.controller.test.ts` |
| BS-I-02 | `day_of_week=7` aplicado | PASSOU | `service.controller.test.ts` |
| BS-I-03 | `day_of_week=-1` aplicado | PASSOU | `service.controller.test.ts` |
| AG-V-01 | lista com `availableTimes` | PASSOU | `professional.search.test.ts` |
| AG-V-02 | `[]` | PASSOU | `professional.search.test.ts` |
| AG-I-01 | `400` campos obrigatórios | PASSOU | `professional.search.test.ts` |
| AG-I-02 | `400` campos obrigatórios | PASSOU | `professional.search.test.ts` |
| AG-I-03 | `400` formato AAAA-MM-DD | PASSOU | `professional.search.test.ts` |
| AG-L-01 | profissional retornado, dist ≤ 10 | PASSOU | `professional.search.test.ts` |
| AG-L-02 | `[]` | PASSOU | `professional.search.test.ts` |
| AG-L-03 | `distance=0` | PASSOU | `professional.search.test.ts` |
| AG-L-04 | raio gravado `0` | PASSOU | `professional.search.test.ts` |
| AG-L-05 | `400` número ≥ 0 | PASSOU | `professional.search.test.ts` |
| AG-L-06 | raio gravado `1` | PASSOU | `professional.search.test.ts` |

**Resumo da execução**

| Suíte | Passou | Falhou |
| ----- | ------ | ------ |
| Busca de serviços | 13 | 0 |
| Busca de profissionais / disponibilidade / raio | 14 | 0 |

---

## 6. Observação de comportamento nas fronteiras

- `day` fora de `[0, 6]` **não é rejeitado** pela API de busca: o filtro é aplicado e a lista tende a ficar vazia. Os casos BS-I-02 e BS-I-03 registram esse comportamento observado.
