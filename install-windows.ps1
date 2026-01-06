<# 
CloudPainel installer (Windows Server)
Usage (PowerShell as Administrator):
  iwr -useb https://example.com/install-windows.ps1 | iex
#>

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/your-org/cloudpainel.git"
$InstallDir = "C:\CloudPainel"
$AdminUser = "admin"
$AdminPass = "admin123"
$PanelPort = 3000
$FrontendPort = 4173

function Log($Message) {
  Write-Host "`n[cloudpainel] $Message"
}

function Ensure-Choco {
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Log "Installing Chocolatey"
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  }
}

function Install-Dependencies {
  Log "Installing dependencies"
  choco install -y git nodejs-lts postgresql16
  npm install -g pm2
}

function Start-Postgres {
  Log "Starting PostgreSQL"
  Start-Service postgresql-x64-16 -ErrorAction SilentlyContinue
}

function Clone-Repo {
  Log "Cloning repository"
  if (-not (Test-Path $InstallDir)) {
    git clone $RepoUrl $InstallDir
  } else {
    Log "Repository already exists, pulling latest"
    git -C $InstallDir pull
  }
}

function Setup-Database {
  Log "Configuring PostgreSQL database"
  $psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
  if (-not (Test-Path $psql)) {
    $psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
  }
  & $psql -U postgres -c "CREATE DATABASE cloudpainel;" 2>$null
  & $psql -U postgres -d cloudpainel -f "$InstallDir\backend\src\config\schema.sql"
}

function Install-DependenciesApp {
  Log "Installing backend dependencies"
  Push-Location $InstallDir
  npm install
  Pop-Location

  Log "Installing frontend dependencies"
  Push-Location "$InstallDir\frontend"
  npm install
  Pop-Location
}

function Build-Frontend {
  Log "Building frontend"
  Push-Location "$InstallDir\frontend"
  npm run build
  Pop-Location
}

function Configure-Env {
  Log "Configuring backend environment"
  $envPath = "$InstallDir\backend\.env"
  $jwt = [guid]::NewGuid().ToString("N")
  @"
PORT=$PanelPort
DATABASE_URL=postgres://postgres@localhost:5432/cloudpainel
DATABASE_SSL=false
CORS_ORIGIN=*
JWT_SECRET=$jwt
JWT_EXPIRES_IN=1d
DEFAULT_ADMIN_USER=$AdminUser
DEFAULT_ADMIN_PASS=$AdminPass
"@ | Set-Content -Path $envPath -Encoding ascii
}

function Configure-PM2 {
  Log "Starting services with PM2"
  Push-Location $InstallDir
  pm2 start backend/src/server.js --name cloudpainel-backend
  Pop-Location

  Push-Location "$InstallDir\frontend"
  pm2 start npm --name cloudpainel-frontend -- run preview -- --host 0.0.0.0 --port $FrontendPort
  Pop-Location

  pm2 save
}

function Print-Summary {
  Log "Installation complete"
  Write-Host "Panel URL: http://localhost:$FrontendPort"
  Write-Host "API URL:   http://localhost:$PanelPort"
  Write-Host "Admin user: $AdminUser"
  Write-Host "Admin pass: $AdminPass"
}

function Main {
  Ensure-Choco
  Install-Dependencies
  Start-Postgres
  Clone-Repo
  Setup-Database
  Install-DependenciesApp
  Build-Frontend
  Configure-Env
  Configure-PM2
  Print-Summary
}

Main
