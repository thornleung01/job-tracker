# Registers two Windows scheduled tasks (both run only while you're signed in):
#   JobTrackerSync      syncs your mail and looks for new jobs every hour
#   JobTrackerDashboard starts the dashboard at sign-in, hidden, so clicking a job notification opens a working page
# Run once from PowerShell:  .\scripts\install-task.ps1
# Remove with:               Unregister-ScheduledTask -TaskName JobTrackerSync, JobTrackerDashboard -Confirm:$false
param([int]$EveryMinutes = 60)

$root   = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\pythonw.exe"   # pythonw: no console window pops up
if (-not (Test-Path $python)) { throw "Virtual environment not found at $python" }

$action  = New-ScheduledTaskAction -Execute $python -Argument "-m jobtracker sync" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName "JobTrackerSync" -Action $action -Trigger $trigger -Settings $settings `
    -Description "Syncs job application emails into the Job Tracker database" -Force | Out-Null
Write-Host "Registered JobTrackerSync: runs every $EveryMinutes minutes as $env:USERNAME (only while signed in)."

$serve = New-ScheduledTaskAction -Execute $python -Argument "-m jobtracker serve" -WorkingDirectory $root
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$serveSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "JobTrackerDashboard" -Action $serve -Trigger $logon -Settings $serveSettings `
    -Description "Runs the Job Tracker dashboard at http://127.0.0.1:8765" -Force | Out-Null
Write-Host "Registered JobTrackerDashboard: starts at sign-in, hidden, at http://127.0.0.1:8765"
