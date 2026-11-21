@echo off
cd /d "%~dp0"
echo === Building VSIX (prepublish runs npm run package) ===
call vsce package --allow-missing-repository
if %ERRORLEVEL% NEQ 0 (
    echo VSIX build failed. Aborting.
    exit /b 1
)
echo === Installing VSIX ===
for %%f in (*.vsix) do (
    code --install-extension "%%f" --force
    echo Installed: %%f
)
echo === Done! Reload VS Code window (Ctrl+Shift+P ^> Developer: Reload Window) ===
