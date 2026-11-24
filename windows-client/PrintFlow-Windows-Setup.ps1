<#
.SYNOPSIS
  PrintFlow AutoPrint — Windows Print Agent & Installer (Windows 10 / 11)
.DESCRIPTION
  Installs the PrintFlow silent auto-print agent for a specific shop branch,
  creates a Desktop shortcut, optionally enables Windows startup, and dispatches
  paid print jobs directly to your local USB or Network Windows printers.
#>

param(
  [string]$ServerUrl = "__SERVER_URL__",
  [string]$ShopId = "__SHOP_ID__",
  [string]$ShopName = "__SHOP_NAME__",
  [string]$AgentKey = "__AGENT_KEY__",
  [string]$BwPrinter = "__BW_PRINTER__",
  [string]$ColorPrinter = "__COLOR_PRINTER__"
)

$ErrorActionPreference = "Stop"

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " PrintFlow AutoPrint — Windows Client Setup" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if ($ServerUrl -like "__*") {
  $ServerUrl = Read-Host "Enter PrintFlow Server URL (e.g. https://your-app.run.app)"
}
if ($ShopId -like "__*") {
  $ShopId = Read-Host "Enter Shop ID"
}
if ($AgentKey -like "__*") {
  $AgentKey = Read-Host "Enter Shop Agent Key (from Admin Panel -> Clients)"
}
if ($BwPrinter -like "__*") { $BwPrinter = "" }
if ($ColorPrinter -like "__*") { $ColorPrinter = "" }
if ($ShopName -like "__*") { $ShopName = "PrintFlow Shop" }

$InstallDir = Join-Path $env:LOCALAPPDATA "PrintFlowAgent"
$TempDir = Join-Path $env:TEMP "PrintFlowJobs"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# List available Windows printers
Write-Host "`nDetected Windows Printers:" -ForegroundColor Yellow
Get-Printer | Select-Object Name, DriverName, PrinterStatus | Format-Table -AutoSize

if ([string]::IsNullOrWhiteSpace($BwPrinter)) {
  $BwPrinter = Read-Host "Enter exact Windows Printer Name for B&W (leave blank for system default)"
}
if ([string]::IsNullOrWhiteSpace($ColorPrinter)) {
  $ColorPrinter = Read-Host "Enter exact Windows Printer Name for Color (leave blank for system default)"
}

$ConfigObj = @{
  serverUrl = $ServerUrl.TrimEnd('/')
  shopId = $ShopId
  shopName = $ShopName
  agentKey = $AgentKey
  bwPrinter = $BwPrinter
  colorPrinter = $ColorPrinter
  pollSeconds = 3
}
$ConfigPath = Join-Path $InstallDir "config.json"
$ConfigObj | ConvertTo-Json -Depth 4 | Set-Content -Path $ConfigPath -Encoding UTF8

$AgentScript = @'
$ErrorActionPreference = "Continue"
$InstallDir = Join-Path $env:LOCALAPPDATA "PrintFlowAgent"
$ConfigPath = Join-Path $InstallDir "config.json"
$TempDir = Join-Path $env:TEMP "PrintFlowJobs"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$cfg = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$headers = @{ "X-Agent-Key" = $cfg.agentKey }

Write-Host "PrintFlow Windows Agent active for [$($cfg.shopName)] ($($cfg.shopId))" -ForegroundColor Green
Write-Host "Polling $($cfg.serverUrl) every $($cfg.pollSeconds)s... Press Ctrl+C to stop."

while ($true) {
  try {
    $pendingUrl = "$($cfg.serverUrl)/api/agent/pending?shopId=$([uri]::EscapeDataString($cfg.shopId))"
    $resp = Invoke-RestMethod -Uri $pendingUrl -Headers $headers -Method Get -TimeoutSec 15

    foreach ($job in $resp.jobs) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Dispatching $($job.code): $($job.originalFilename) ($($job.options.colorMode), $($job.options.copies) copies)" -ForegroundColor Cyan
      $safeExt = if ($job.fileExtension) { $job.fileExtension } else { ".pdf" }
      $localFile = Join-Path $TempDir "$($job.id)$safeExt"

      $fileUrl = "$($cfg.serverUrl)/api/agent/jobs/$($job.id)/file"
      Invoke-WebRequest -Uri $fileUrl -Headers $headers -OutFile $localFile -TimeoutSec 60

      $targetPrinter = if ($job.options.colorMode -eq "color") { $cfg.colorPrinter } else { $cfg.bwPrinter }
      $copies = [Math]::Max(1, [int]$job.options.copies)

      for ($c = 1; $c -le $copies; $c++) {
        if (-not [string]::IsNullOrWhiteSpace($targetPrinter)) {
          Start-Process -FilePath $localFile -Verb PrintTo -ArgumentList "`"$targetPrinter`"" -WindowStyle Hidden -Wait
        } else {
          Start-Process -FilePath $localFile -Verb Print -WindowStyle Hidden -Wait
        }
      }

      $doneUrl = "$($cfg.serverUrl)/api/agent/jobs/$($job.id)/status"
      $body = @{ status = "completed" } | ConvertTo-Json
      Invoke-RestMethod -Uri $doneUrl -Headers $headers -Method Post -ContentType "application/json" -Body $body | Out-Null
      Write-Host "  -> Printed & marked completed: $($job.code)" -ForegroundColor Green

      if (Test-Path $localFile) { Remove-Item $localFile -Force -ErrorAction SilentlyContinue }
    }
  } catch {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Agent poll warning: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
  Start-Sleep -Seconds ([Math]::Max(2, [int]$cfg.pollSeconds))
}
'@

$AgentScriptPath = Join-Path $InstallDir "PrintFlow-Agent.ps1"
$AgentScript | Set-Content -Path $AgentScriptPath -Encoding UTF8

# Create Launcher .bat
$LauncherBatPath = Join-Path $InstallDir "Start-PrintFlow-Agent.bat"
"@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$AgentScriptPath`"`r`npause`r`n" | Set-Content -Path $LauncherBatPath -Encoding ASCII

# Create Desktop Shortcut
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "PrintFlow Agent ($ShopName).lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$AgentScriptPath`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Save()

$autoStart = Read-Host "`nStart PrintFlow Agent automatically on Windows login? (Y/N)"
if ($autoStart -match "^[Yy]") {
  $RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  Set-ItemProperty -Path $RegPath -Name "PrintFlowAgent_$ShopId" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$AgentScriptPath`""
  Write-Host "Added to Windows Startup." -ForegroundColor Green
}

Write-Host "`nInstallation complete!" -ForegroundColor Green
Write-Host "Installed folder : $InstallDir"
Write-Host "Desktop shortcut : $ShortcutPath"
$launchNow = Read-Host "Launch PrintFlow Windows Print Agent now? (Y/N)"
if ($launchNow -match "^[Yy]") {
  & $AgentScriptPath
}
