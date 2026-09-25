#requires -Version 7.2
# Teste offline: comandos Azure e HTTP são substituídos; nenhum recurso é criado.
$ErrorActionPreference = 'Stop'
$deployScript = Join-Path (Split-Path $PSScriptRoot -Parent) 'provision-and-deploy.ps1'
$previousEnvironment = @{}
foreach ($name in @('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'GITHUB_ACTIONS')) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}
$previousExitCode = $global:LASTEXITCODE
try {
    $env:SMTP_HOST = 'smtp.example.test'
    $env:SMTP_USER = 'mailer@example.test'
    $env:SMTP_PASS = 'test-secret-with-spaces password'
    $env:FROM_EMAIL = 'mailer@example.test'
    $env:GITHUB_ACTIONS = 'false'
    foreach ($scenario in @('success', 'new-resources', 'unprotected', 'smtp-setting-failure')) {
        $scenarioState = @{
            Calls = [System.Collections.Generic.List[string]]::new()
            Requests = [System.Collections.Generic.List[string]]::new()
            Scenario = $scenario
            PackageChecked = $false
            KeyCreated = $false
        }
        function az {
            $command = $args -join ' '
            $scenarioState.Calls.Add($command)
            $global:LASTEXITCODE = 0
            if ($args -notcontains '--subscription') { throw 'Assinatura deve ser explícita.' }
            switch -Wildcard ($command) {
                'group exists*' { return $(if ($scenarioState.Scenario -eq 'new-resources') { 'false' } else { 'true' }) }
                'storage account list*' { if ($scenarioState.Scenario -ne 'new-resources') { return 'testemailstorage' } }
                'functionapp list*' { if ($scenarioState.Scenario -ne 'new-resources') { return 'test-email-function' } }
                'functionapp show*defaultHostName*' { return 'test-email-function-random.region.azurewebsites.net' }
                'functionapp show*' { return '{"serverFarmId":"/plans/test","functionAppConfig":{"runtime":{"name":"python","version":"3.12"}}}' }
                'appservice plan show*' { return 'FC1' }
                'functionapp config appsettings set*' {
                    if ($scenarioState.Scenario -eq 'smtp-setting-failure') {
                        $global:LASTEXITCODE = 1
                        return 'A provider error with test-secret-with-spaces password'
                    }
                }
                'functionapp deployment source config-zip*' {
                    $zipPath = $args[([array]::IndexOf($args, '--src') + 1)]
                    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
                    try {
                        $names = @($archive.Entries.FullName | Sort-Object)
                        if (($names -join ',') -ne 'email_sender.py,function_app.py,host.json,requirements.txt') {
                            throw 'Pacote contém arquivos inesperados.'
                        }
                        $scenarioState.PackageChecked = $true
                    } finally { $archive.Dispose() }
                }
                'functionapp function keys list*' {
                    if ($scenarioState.Scenario -ne 'new-resources' -or $scenarioState.KeyCreated) { return 'test-function-key' }
                }
                'functionapp function keys set*' { $scenarioState.KeyCreated = $true }
            }
        }
        function Start-Sleep { param($Seconds) }
        function Invoke-WebRequest {
            param($Uri, $Method, $ContentType, $Body, $Headers, [switch]$SkipHttpErrorCheck, $TimeoutSec)
            $scenarioState.Requests.Add($Uri)
            if ($Body -ne '{}') { throw 'Probe não pode enviar e-mail.' }
            if ($Uri -ne 'https://test-email-function-random.region.azurewebsites.net/api/send-email') { throw 'Hostname incorreto.' }
            if ($scenarioState.Scenario -eq 'unprotected') {
                return [PSCustomObject]@{ StatusCode = 200; Content = '{"ok":true}' }
            }
            if ($Headers) { return [PSCustomObject]@{ StatusCode = 400; Content = '{"ok":false}' } }
            return [PSCustomObject]@{ StatusCode = 401; Content = '{}' }
        }
        $parameters = @{
            SubscriptionId = 'test-subscription'
            ResourceGroupName = 'test-email-rg'
            FunctionAppName = 'test-email-function'
            StorageAccountName = 'testemailstorage'
            Location = 'testregion'
            BackendResourceGroupName = 'test-backend-rg'
            BackendAppName = 'test-backend'
        }
        $failure = $null
        $result = @()
        try { $result = @(& $deployScript @parameters) } catch { $failure = $_ }
        $backendWrites = @($scenarioState.Calls | Where-Object { $_ -like 'webapp config appsettings set*' })
        if ($scenario -in @('success', 'new-resources')) {
            if ($failure) { throw $failure }
            if ($backendWrites.Count -ne 1 -or -not $scenarioState.PackageChecked -or $scenarioState.Requests.Count -ne 2) {
                throw 'O deploy deve validar pacote e probes antes de configurar o backend.'
            }
            if ($scenario -eq 'new-resources' -and -not $scenarioState.KeyCreated) { throw 'Deve criar a chave ausente.' }
        } elseif (-not $failure -or $backendWrites.Count -ne 0) {
            throw 'Em falha, o deploy deve parar sem configurar o backend.'
        }
        if ((($result -join ' ') + [string]$failure) -match 'test-secret|test-function-key') {
            throw 'Saída do deploy expôs segredo.'
        }
        Write-Output "PASS: $scenario"
    }
} finally {
    foreach ($entry in $previousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
    }
    $global:LASTEXITCODE = $previousExitCode
}
