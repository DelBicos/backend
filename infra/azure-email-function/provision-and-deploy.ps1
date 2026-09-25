#requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $SubscriptionId,
    [Parameter(Mandatory)][string] $ResourceGroupName,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9-]{2,60}$')][string] $FunctionAppName,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]{3,24}$')][string] $StorageAccountName,
    [Parameter(Mandatory)][string] $Location,
    [string] $BackendResourceGroupName,
    [string] $BackendAppName
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI não encontrado. Consulte azure_email_function/README.md.'
}
if ([bool]$BackendResourceGroupName -ne [bool]$BackendAppName) {
    throw 'Informe ambos os parâmetros do backend ou omita ambos.'
}

function Invoke-AzureCli {
    param([string[]] $Arguments, [switch] $Sensitive)
    # Nunca incluir argumentos/saída com segredos em exceções.
    $cliOutput = & az @Arguments --subscription $SubscriptionId --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        if (-not $Sensitive) { Write-Warning ($cliOutput -join [Environment]::NewLine) }
        throw 'Azure CLI falhou. A operação foi interrompida.'
    }
    return $cliOutput
}

function Get-Setting {
    param([string] $Name, [string] $Default = '')
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrEmpty($value)) { return $Default }
    return $value
}

$smtpSettings = @{}
foreach ($settingName in @('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL')) {
    $smtpSettings[$settingName] = Get-Setting $settingName
    if ([string]::IsNullOrWhiteSpace($smtpSettings[$settingName])) {
        throw "Variável de ambiente obrigatória ausente: $settingName"
    }
}
$smtpSettings.SMTP_PORT = Get-Setting 'SMTP_PORT' '587'
$smtpSettings.SMTP_USE_SSL = Get-Setting 'SMTP_USE_SSL' $(if ($smtpSettings.SMTP_PORT -eq '465') { 'true' } else { 'false' })
$smtpSettings.SMTP_USE_TLS = Get-Setting 'SMTP_USE_TLS' $(if ($smtpSettings.SMTP_USE_SSL -eq 'true') { 'false' } else { 'true' })
$smtpSettings.DEFAULT_SUBJECT = Get-Setting 'DEFAULT_SUBJECT' 'Mensagem DelBicos'
$smtpSettings.SMTP_TIMEOUT_SECONDS = '15'
$smtpSettings.MAX_EMAIL_BODY_BYTES = '262144'

$null = Invoke-AzureCli @('account', 'show', '--output', 'none')
if ($BackendAppName) {
    $null = Invoke-AzureCli @('webapp', 'show', '-g', $BackendResourceGroupName, '-n', $BackendAppName, '-o', 'none')
}
$groupExists = Invoke-AzureCli @('group', 'exists', '-n', $ResourceGroupName, '-o', 'tsv')
if ($groupExists -ne 'true') {
    $null = Invoke-AzureCli @('group', 'create', '-n', $ResourceGroupName, '-l', $Location, '-o', 'none')
}
# Falha de permissão na listagem interrompe o script; não significa recurso ausente.
$storageNames = @(Invoke-AzureCli @('storage', 'account', 'list', '-g', $ResourceGroupName, '--query', '[].name', '-o', 'tsv'))
if ($StorageAccountName -notin $storageNames) {
    $null = Invoke-AzureCli @(
        'storage', 'account', 'create', '-g', $ResourceGroupName, '-n', $StorageAccountName,
        '-l', $Location, '--sku', 'Standard_LRS', '--kind', 'StorageV2',
        '--allow-blob-public-access', 'false', '--min-tls-version', 'TLS1_2', '-o', 'none'
    )
}
$functionNames = @(Invoke-AzureCli @('functionapp', 'list', '-g', $ResourceGroupName, '--query', '[].name', '-o', 'tsv'))
if ($FunctionAppName -notin $functionNames) {
    $null = Invoke-AzureCli @(
        'functionapp', 'create', '-g', $ResourceGroupName, '-n', $FunctionAppName,
        '--storage-account', $StorageAccountName, '--flexconsumption-location', $Location,
        '--runtime', 'python', '--runtime-version', '3.12', '--functions-version', '4',
        '--instance-memory', '512', '--maximum-instance-count', '40',
        '--https-only', 'true', '-o', 'none'
    )
}
$siteJson = Invoke-AzureCli @('functionapp', 'show', '-g', $ResourceGroupName, '-n', $FunctionAppName, '-o', 'json')
$site = ($siteJson -join [Environment]::NewLine) | ConvertFrom-Json
$planSku = Invoke-AzureCli @('appservice', 'plan', 'show', '--ids', $site.serverFarmId, '--query', 'sku.name', '-o', 'tsv')
if ($planSku -ne 'FC1' -or $site.functionAppConfig.runtime.name -ne 'python' -or $site.functionAppConfig.runtime.version -ne '3.12') {
    throw 'O destino existente deve ser uma Function Flex Consumption Python 3.12 dedicada ao e-mail.'
}
$settingsArguments = @('functionapp', 'config', 'appsettings', 'set', '-g', $ResourceGroupName, '-n', $FunctionAppName, '--settings')
foreach ($entry in $smtpSettings.GetEnumerator()) { $settingsArguments += "$($entry.Key)=$($entry.Value)" }
$null = Invoke-AzureCli -Arguments ($settingsArguments + @('-o', 'none')) -Sensitive

# ZIP com allowlist: nunca inclui .venv, testes ou local.settings.json.
$functionDirectory = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'azure_email_function'
$packagePath = Join-Path ([System.IO.Path]::GetTempPath()) ("delbicos-email-{0}.zip" -f [guid]::NewGuid())
try {
    $packageFiles = @('function_app.py', 'email_sender.py', 'host.json', 'requirements.txt') |
        ForEach-Object { Join-Path $functionDirectory $_ }
    Compress-Archive -LiteralPath $packageFiles -DestinationPath $packagePath
    $null = Invoke-AzureCli @(
        'functionapp', 'deployment', 'source', 'config-zip', '-g', $ResourceGroupName,
        '-n', $FunctionAppName, '--src', $packagePath, '--build-remote', 'true', '-o', 'none'
    )
}
finally {
    if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath }
}

# Azure pode atribuir um hostname com sufixo regional; nunca adivinhar o domínio.
$functionHostName = Invoke-AzureCli @('functionapp', 'show', '-g', $ResourceGroupName, '-n', $FunctionAppName, '--query', 'defaultHostName', '-o', 'tsv')
if ([string]::IsNullOrWhiteSpace($functionHostName)) { throw 'Hostname da Function indisponível.' }
$functionUrl = "https://$functionHostName/api/send-email"
$functionKey = ''
for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
        $functionKey = Invoke-AzureCli -Arguments @(
            'functionapp', 'function', 'keys', 'list', '-g', $ResourceGroupName,
            '-n', $FunctionAppName, '--function-name', 'send_email', '--query', 'default', '-o', 'tsv'
        ) -Sensitive
        if ([string]::IsNullOrWhiteSpace($functionKey)) {
            $null = Invoke-AzureCli -Arguments @(
                'functionapp', 'function', 'keys', 'set', '-g', $ResourceGroupName,
                '-n', $FunctionAppName, '--function-name', 'send_email', '--key-name', 'default', '-o', 'none'
            ) -Sensitive
            $functionKey = Invoke-AzureCli -Arguments @(
                'functionapp', 'function', 'keys', 'list', '-g', $ResourceGroupName,
                '-n', $FunctionAppName, '--function-name', 'send_email', '--query', 'default', '-o', 'tsv'
            ) -Sensitive
        }
        if (-not [string]::IsNullOrWhiteSpace($functionKey)) { break }
    } catch { if ($attempt -eq 6) { throw } }
    Start-Sleep -Seconds 5
}
if ([string]::IsNullOrWhiteSpace($functionKey)) { throw 'Chave da Function indisponível.' }
if ($env:GITHUB_ACTIONS -eq 'true') { Write-Output "::add-mask::$functionKey" }

# Os probes não enviam e-mail; confirmam autenticação, indexing e configuração.
$validated = $false
for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
        $anonymous = Invoke-WebRequest -Uri $functionUrl -Method Post -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 20
        $authenticated = Invoke-WebRequest -Uri $functionUrl -Method Post -ContentType 'application/json' -Body '{}' -Headers @{ 'x-functions-key' = $functionKey } -SkipHttpErrorCheck -TimeoutSec 20
        $responseBody = $authenticated.Content | ConvertFrom-Json
        if ($anonymous.StatusCode -in @(401, 403) -and $authenticated.StatusCode -eq 400 -and $responseBody.ok -eq $false) {
            $validated = $true
            break
        }
    } catch { # Cold start/indexing: apenas probes sem envio podem ser repetidos.
    }
    Start-Sleep -Seconds 5
}
if (-not $validated) { throw 'Smoke test falhou. Configuração do backend não foi alterada.' }

if ($BackendAppName) {
    $null = Invoke-AzureCli -Arguments @(
        'webapp', 'config', 'appsettings', 'set', '-g', $BackendResourceGroupName, '-n', $BackendAppName,
        '--settings', "AZURE_FUNCTION_URL=$functionUrl", "AZURE_FUNCTION_KEY=$functionKey",
        'AZURE_FUNCTION_TIMEOUT_MS=20000', '-o', 'none'
    ) -Sensitive
}
Write-Output "Function publicada e protegida: $functionUrl"
Write-Output 'O teste de entrega SMTP ainda exige um destinatário autorizado. Nenhum e-mail foi enviado pelos probes.'
