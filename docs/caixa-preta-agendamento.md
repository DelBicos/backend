# Teste de Caixa Preta — Fluxo de Agendamento

> Técnicas: **Partição de Equivalência** e **Análise de Valor Limite**.  
> Escopo: interfaces públicas do DelBicos usadas em [www.delbicos.com.br](https://www.delbicos.com.br) (app DelBicosV2 + API DelBicosBackend).  
> Os testes observam apenas entrada e saída da API. Não se baseiam em ramos internos do código.

**Execução:** `npm run test:unit` — suíte de agendamento e pagamento.

---

## 1. Funções observadas (visão de caixa preta)

| Função | Interface | Entradas observadas | Saída esperada |
| ------ | --------- | ------------------- | -------------- |
| Criar agendamento | `POST /api/appointments` | `service_id`, `professional_id`, `start_time`, `end_time`, endereço/coords | `201` / `400` / `401` / `403` / `404` |
| Avaliar agendamento | `POST /api/appointments/:id/review` | `rating` (1–5), `review` (0–500 chars) | `200` ou `400` |
| Iniciar pagamento do agendamento | `POST /api/payments/create-payment-intent` | `amount` > 0, `currency` ISO-3, dados do horário | `200` ou `400` |

---

## 2. Partição de Equivalência

Cada classe representa um conjunto de entradas que o sistema deve tratar da mesma forma. Um representante por classe é suficiente.

### 2.1 Criação de agendamento

| ID da classe | Tipo | Domínio | Representante | Resultado esperado |
| ------------ | ---- | ------- | ------------- | ------------------ |
| PE-CR-V1 | Válida | Cliente autenticado, serviço ativo, dentro do raio | payload completo | `201`, `status=pending` |
| PE-CR-I1 | Inválida | Sem autenticação | sem `user` | `401` |
| PE-CR-I2 | Inválida | Usuário sem perfil de cliente | user sem Client | `403` |
| PE-CR-I3 | Inválida | Campo obrigatório ausente | falta `service_id` / `professional_id` / `start_time` / `end_time` | `400` |
| PE-CR-I4 | Inválida | Serviço inativo | `active=false` | `400` |
| PE-CR-I5 | Inválida | Coordenadas não numéricas | `client_lat="abc"` | `400` |
| PE-CR-I6 | Inválida | Fora do raio | SP × Rio, raio 10 km | `400` |

### 2.2 Pagamento do agendamento

| ID da classe | Tipo | Domínio | Representante | Resultado esperado |
| ------------ | ---- | ------- | ------------- | ------------------ |
| PE-PG-V1 | Válida | `amount` número > 0, `currency` 3 letras, metadados completos | `150.50` + `"BRL"` | `200` + `clientSecret` |
| PE-PG-I1 | Inválida | `amount` ≤ 0 ou não numérico | `0`, `-10`, `"50"` | `400` |
| PE-PG-I2 | Inválida | `currency` com tamanho ≠ 3 | `"br"`, `"brls"` | `400` |
| PE-PG-I3 | Inválida | Metadado de horário ausente | falta `selectedTime` | `400` |

---

## 3. Análise de Valor Limite

Para cada intervalo `[mín, máx]`, testam-se **mín−1**, **mín**, **mín+1**, **máx−1** (quando fizer sentido), **máx** e **máx+1**.

### 3.1 Distância do cliente × raio do profissional (aceita se `distância ≤ raio`)

Raio de referência: **10 km**.

| Distância | Relação com o limite | Esperado | Caso |
| --------- | -------------------- | -------- | ---- |
| 0 km | mínimo (mesmo ponto) | aceito | AG-L-07 |
| 9,99 km | logo abaixo do raio | aceito | AG-L-08 |
| 10,5 km | logo acima do raio | recusado | AG-L-09 |

### 3.2 Avaliação `rating` ∈ [1, 5] e `review` ≤ 500

| Variável | mín−1 | mín | máx | máx+1 |
| -------- | ----- | --- | --- | ----- |
| `rating` | `0` → `400` (AG-L-12) | `1` (AG-L-10) | `5` (AG-L-11) | `6` → `400` (AG-L-13) |
| `review.length` | — | `0` (omitido) | `500` (AG-L-14) | `501` → `400` (AG-L-15) |

### 3.3 Valor do pagamento (`amount` > 0) e moeda (tamanho = 3)

| Variável | abaixo | no limite | acima |
| -------- | ------ | --------- | ----- |
| `amount` | `0` → `400` | `0.01` → `200` (1 centavo) | `150.50` → `200` |
| `currency.length` | `2` (`"br"`) → `400` | `3` (`"BRL"`) → `200` | `4` (`"brls"`) → `400` |

---

## 4. Casos de teste documentados

| ID | Técnica | Interface | Entrada | Esperado |
| -- | ------- | --------- | ------- | -------- |
| AG-L-07 | VL | criar agendamento dist 0 | mínimo | `201` |
| AG-L-08 | VL | criar agendamento 9,99 km | abaixo | `201` |
| AG-L-09 | VL | criar agendamento 10,5 km | acima | `400` |
| AG-L-10 | VL | `rating=1` | mínimo | aceito |
| AG-L-11 | VL | `rating=5` | máximo | aceito |
| AG-L-12 | VL | `rating=0` | mín−1 | `400` |
| AG-L-13 | VL | `rating=6` | máx+1 | `400` |
| AG-L-14 | VL | review 500 chars | máximo | aceito |
| AG-L-15 | VL | review 501 chars | máx+1 | `400` |
| AG-L-16 | VL | `amount=0.01` | mín+ε | `200`, 1 centavo |

---

## 5. Tabela de execução

Comando: `npm run test:unit`  
Ambiente: Node local, Jest projeto `unit` (sem banco).

| ID | Resultado obtido | Status | Evidência (arquivo de teste) |
| -- | ---------------- | ------ | ---------------------------- |
| AG-L-07 | `201` | PASSOU | `appointment.controller.test.ts` |
| AG-L-08 | `201` | PASSOU | `appointment.controller.test.ts` |
| AG-L-09 | `400` fora do raio | PASSOU | `appointment.controller.test.ts` |
| AG-L-10 | avaliação salva | PASSOU | `appointment.controller.test.ts` |
| AG-L-11 | avaliação salva | PASSOU | `appointment.controller.test.ts` |
| AG-L-12 | `400` rating obrigatório | PASSOU | `appointment.controller.test.ts` |
| AG-L-13 | `400` entre 1 e 5 | PASSOU | `appointment.controller.test.ts` |
| AG-L-14 | salva | PASSOU | `appointment.controller.test.ts` |
| AG-L-15 | `400` máximo 500 | PASSOU | `appointment.controller.test.ts` |
| AG-L-16 | `amount=1` centavo, `200` | PASSOU | `payment.controller.test.ts` |

**Resumo da execução**

| Suíte | Passou | Falhou |
| ----- | ------ | ------ |
| Agendamento (criação, consulta, avaliação) | 32 | 0 |
| Pagamento do agendamento | 18 | 0 |
| Serviço de pagamento | 15 | 0 |

---

## 6. Observação de comportamento nas fronteiras

- `rating=0` cai na partição “campo obrigatório ausente”, não na mensagem “entre 1 e 5”, porque `0` é tratado como valor vazio. AG-L-12 documenta o limite inferior real da interface.
