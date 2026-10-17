param([ValidateSet('dev', 'build')][string]$Mode = 'dev')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Prefer the optional project-local toolchain without modifying the user's PATH.
$localCargo = Join-Path $projectRoot '.toolchain/cargo'
if (Test-Path -LiteralPath (Join-Path $localCargo 'bin/rustup.exe')) {
    $env:CARGO_HOME = $localCargo
    $env:RUSTUP_HOME = Join-Path $projectRoot '.toolchain/rustup'
    $env:PATH = (Join-Path $localCargo 'bin') + ';' + $env:PATH
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust is required. Install the stable MSVC toolchain from https://rustup.rs/.'
}

# An explicit SDK environment avoids Rust selecting mismatched VS/SDK installations.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (Test-Path -LiteralPath $vswhere) {
    $vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
        $msvc = Get-ChildItem -LiteralPath (Join-Path $vsPath 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $sdkRoot = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
        $sdk = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Lib') -Directory |
            Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'um/x64/dbghelp.lib')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'ucrt/x64/ucrt.lib')) } |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($msvc -and $sdk) {
            $env:VCINSTALLDIR = Join-Path $vsPath 'VC/'
            $env:VCToolsInstallDir = $msvc.FullName + '\'
            $env:WindowsSdkDir = $sdkRoot
            $env:WindowsSDKVersion = $sdk.Name + '\'
            $env:VSCMD_ARG_TGT_ARCH = 'x64'
            $env:VSCMD_ARG_HOST_ARCH = 'x64'
            $env:LIB = @((Join-Path $msvc.FullName 'lib/x64'), (Join-Path $sdk.FullName 'um/x64'), (Join-Path $sdk.FullName 'ucrt/x64')) -join ';'
            $sdkInclude = Join-Path $sdkRoot ('Include/' + $sdk.Name)
            $env:INCLUDE = @((Join-Path $msvc.FullName 'include'), (Join-Path $sdkInclude 'ucrt'), (Join-Path $sdkInclude 'shared'), (Join-Path $sdkInclude 'um'), (Join-Path $sdkInclude 'winrt')) -join ';'
            $compilerBin = Join-Path $msvc.FullName 'bin/Hostx64/x64'
            $sdkBin = Join-Path $sdkRoot ('bin/' + $sdk.Name + '/x64')
            $env:PATH = $compilerBin + ';' + $sdkBin + ';' + $env:PATH
            $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $compilerBin 'link.exe'
            Write-Host ('Using MSVC ' + $msvc.Name + ', Windows SDK ' + $sdk.Name)
        }
    }
}
& (Join-Path $projectRoot 'node_modules/.bin/tauri.cmd') $Mode
$buildExit = $LASTEXITCODE
if ($Mode -eq 'build' -and $buildExit -eq 0) {
    $releaseDir = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    $binary = Join-Path $projectRoot 'src-tauri/target/release/json-format-desktop.exe'
    $version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $versionedBinary = Join-Path $releaseDir ('JSON FORMAT ' + $version + '.exe')
    Copy-Item -LiteralPath $binary -Destination $versionedBinary
    try {
        Copy-Item -LiteralPath $binary -Destination (Join-Path $releaseDir 'JSON FORMAT.exe') -ErrorAction Stop
    } catch {
        Write-Warning ('The running application was kept open. Use: ' + $versionedBinary)
    }
    $installer = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src-tauri/target/release/bundle/nsis') -Filter '*setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($installer) { Copy-Item -LiteralPath $installer.FullName -Destination $releaseDir }
    Write-Host ('Ready: ' + $releaseDir)
}
exit $buildExit
