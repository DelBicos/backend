# Azure Function de fallback de e-mail

HTTP trigger em Python usando o programming model v2 do Azure Functions. O
endpoint recebe o mesmo contrato usado anteriormente pela Lambda:

```json
{
  "to": "destinatario@example.com",
  "subject": "Assunto",
  "body": "<p>Mensagem em HTML</p>"
}
```

O endpoint publicado é `POST /api/send-email` e exige uma function key. O
backend envia a chave no header `x-functions-key`.

O SendGrid continua sendo o provedor principal. A Function é chamada quando o
envio pelo SendGrid falha; sua API key e `SENDER_EMAIL_VERIFICADO` continuam
necessários na configuração atual do backend. A migração não troca o provedor
SMTP: se ele também for SendGrid, permanece a mesma dependência de entrega.

Resposta de sucesso: HTTP 200 com `{"ok":true}` após aceitação pelo SMTP
(isso não garante entrega na caixa de entrada). JSON/payload inválido retorna
400, configuração ausente retorna 500 e falha de envio retorna 502.
Logs não incluem corpo, destinatário, senhas ou a mensagem bruta de exceções SMTP.
Limite padrão do HTML: 256 KiB; assunto: 255 caracteres.

## Executar localmente

Pré-requisitos:

- Python 3.12
- Azure Functions Core Tools v4
- Azurite ou uma connection string válida para `AzureWebJobsStorage`

```powershell
cd azure_email_function
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item local.settings.json.example local.settings.json
func start
```

O Core Tools desabilita a exigência da function key durante a execução local.
Nunca versione `local.settings.json`.

## Testes

```powershell
cd azure_email_function
python -m pytest -q
```

Na raiz do repositório:

```powershell
npm run build
npm run test:unit -- --runInBand azureEmailFunction.test.ts email.service.test.ts
pwsh -File infra/azure-email-function/tests/provision-and-deploy.Tests.ps1
```

O último comando simula Azure/HTTP sem criar recursos ou enviar mensagens.

## Provisionar e publicar manualmente

Requer PowerShell 7.2+ e Azure CLI atualizado. Core Tools é necessário apenas
para `func start`; o deploy usa ZIP com build remoto Linux pelo Azure CLI.
Autentique (`az login`), confirme a assinatura e execute a partir da raiz do
repositório. Leia a senha com prompt para não deixá-la no histórico:

```powershell
$env:SMTP_HOST = 'smtp.example.com'
$env:SMTP_USER = 'usuario@example.com'
$env:SMTP_PASS = Read-Host 'Senha SMTP' -MaskInput
$env:FROM_EMAIL = 'no-reply@example.com'

.\infra\azure-email-function\provision-and-deploy.ps1 `
  -SubscriptionId '<id-da-assinatura>' `
  -ResourceGroupName 'rg-delbicos-email-prod' `
  -FunctionAppName '<nome-globalmente-unico>' `
  -StorageAccountName '<nomeglobalmenteunico>' `
  -Location '<regiao-flex-disponivel>' `
  -BackendResourceGroupName '<resource-group-do-backend>' `
  -BackendAppName 'delbicos-backend-edu'
```

Consulte as regiões atualmente disponíveis antes do provisionamento:

```powershell
az functionapp list-flexconsumption-locations -o table
```

O script é idempotente para o Resource Group, Storage Account e Function App.
Use um Function App dedicado ao e-mail: publicar substitui o código desse app.
Recursos existentes incompatíveis com Flex/Python 3.12 fazem o script parar.
Ele publica somente quatro arquivos de runtime, obtém a chave sem imprimi-la,
consulta o hostname real no Azure e valida os probes HTTP antes de configurar
`AZURE_FUNCTION_URL`, `AZURE_FUNCTION_KEY` e `AZURE_FUNCTION_TIMEOUT_MS` no App
Service do backend quando seus parâmetros são fornecidos.

Os probes exigem recusa sem chave (401/403) e validação de payload com chave
(400). Eles não verificam a entrega SMTP. Há retries apenas para indexing e
esses probes; envio de e-mail não tem retry automático, pois um timeout pode
ocorrer depois da entrega e uma repetição poderia duplicar a mensagem.

O padrão é porta 587 com STARTTLS. Para TLS implícito, configure `SMTP_PORT=465`;
o script ajusta SSL/TLS automaticamente. `SMTP_USE_TLS` e `SMTP_USE_SSL` também
podem ser informados explicitamente. Autenticação sem criptografia é recusada.
O script cria Storage Standard LRS, plano Flex com 512 MB e máximo de 40
instâncias, sem always-ready, e o CLI associa Application Insights. Esses
recursos podem gerar custos; confirme região, cotas e orçamento da assinatura.
Após o uso, remova `SMTP_PASS` da sessão (`Remove-Item Env:SMTP_PASS`).

## Deploy pelo GitHub Actions

O workflow `deploy-azure-email-function.yml` provisiona, testa, publica e liga
a Function ao App Service. Configure no repositório:

Repository variables:

- `AZURE_EMAIL_RESOURCE_GROUP`
- `AZURE_EMAIL_FUNCTION_APP_NAME`
- `AZURE_EMAIL_STORAGE_ACCOUNT_NAME`
- `AZURE_EMAIL_LOCATION`
- `AZURE_BACKEND_RESOURCE_GROUP`
- `AZURE_BACKEND_APP_NAME`
- `EMAIL_SMTP_PORT` (opcional, padrão `587`)
- `AZURE_EMAIL_AUTO_DEPLOY` (opcional; `true` habilita deploy em pushes para
  `main` que alterem a Function, o script ou o workflow)

Repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `EMAIL_SMTP_HOST`
- `EMAIL_SMTP_USER`
- `EMAIL_SMTP_PASS`
- `EMAIL_FROM_ADDRESS`

Os três IDs são usados pelo login OIDC; não é necessário client secret ou
publish profile. Configure uma credencial federada para o repositório
`DelBicos/backend`, issuer `https://token.actions.githubusercontent.com`,
audience `api://AzureADTokenExchange` e subject
`repo:DelBicos/backend:ref:refs/heads/main`. Para o primeiro deploy manual em
outra branch, configure a credencial para aquela branch confiável.

A identidade precisa criar/alterar recursos no resource group dedicado à
Function e configurar o App Service do backend. Prefira criar previamente
o grupo e conceder Contributor apenas nesse grupo e Website Contributor no
App Service de destino. Criar um resource group exige permissão no escopo
da assinatura. Os provedores Microsoft.Web, Microsoft.Storage,
Microsoft.Insights e Microsoft.OperationalInsights precisam estar registrados.

Execute o primeiro deploy manualmente em Actions. O workflow de testes roda em
PRs sem credenciais Azure. O deploy automático começa somente após definir
`AZURE_EMAIL_AUTO_DEPLOY=true`, evitando falhas em ambientes ainda não configurados.

Para ambientes com Key Vault, substitua os valores de `SMTP_PASS` e demais
segredos por referências `@Microsoft.KeyVault(...)` nos secrets do workflow ou
nas variáveis do script, para que o próximo deploy preserve essas referências.
Nesse caso, habilite managed identity na Function e conceda leitura dos
segredos no cofre antes de rodar os probes.

## Cutover, evidência e rollback

1. Provisione/publique a Function e configure o backend **antes** de publicar
   a versão Node que remove a Lambda. A versão anterior ignora os novos envs.
2. Em staging, execute um envio para um destinatário de teste autorizado e
   confirme a recepção. Simule falha do SendGrid em staging para comprovar o
   caminho `EmailService -> Azure Function -> SMTP`; não altere sua chave de
   produção para simular falha. O endpoint auxiliar do backend só existe em
   development e não deve ser exposto publicamente para esse teste.
3. Registre no Jira o resource group/app/região, revisão publicada, resultado
   dos probes, entrega no destinatário e evidência de Application Insights.
   O status local dos testes não substitui essa evidência de infraestrutura.
4. Conserve a Lambda e suas configurações AWS durante a validação. Os arquivos
   legados foram removidos do código e permanecem recuperáveis pelo Git;
   nenhum recurso AWS é excluído pelo script.
5. Para rollback, publique a revisão anterior do backend com as antigas
   configurações `LAMBDA_FUNCTION_URL`/`LAMBDA_FUNCTION_NAME` ainda preservadas.
   Para um problema só na Function, republique a última revisão validada dela.
   Remova os recursos AWS e seus secrets apenas após validar o cutover.

O timeout HTTP do backend é 20 segundos, ajustável de 1 a 120000 ms.
O timeout SMTP é por operação de socket, não um limite total de execução.
Cold starts podem exigir aumentar o prazo HTTP; após timeout não há garantia
de que o SMTP deixou de enviar, por isso não repita o envio automaticamente.

Referências: [Flex Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to),
[deploy Python com remote build](https://learn.microsoft.com/en-us/azure/azure-functions/python-build-options),
[chaves de acesso](https://learn.microsoft.com/en-us/azure/azure-functions/function-keys-how-to).
