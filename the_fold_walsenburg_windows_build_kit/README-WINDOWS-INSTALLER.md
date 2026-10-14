# The Fold / Walsenburg — Windows installer build

This project already includes an Electron desktop wrapper and a Windows packager in `desktop/`. The workflow at `.github/workflows/build-windows-installer.yml` builds the offline Vite game and invokes that Windows-only packager on a GitHub-hosted Windows runner.

## Build from GitHub

1. Create an empty GitHub repository for this game.
2. Extract this build-kit ZIP.
3. Upload **the contents of the extracted folder** to the repository's top level. Do not upload the ZIP alone and do not put all the files under an extra enclosing folder. The repository root should contain `package.json`, `package-lock.json`, `src/`, `desktop/`, `public/`, and `.github/`.
4. Commit the uploaded files.
5. Open the repository's **Actions** tab and select **Build The Fold Windows Launcher**.
6. After the run succeeds, open its **Summary** and download the artifact `The-Fold-Walsenburg-Windows-Installers`.
7. Extract the artifact ZIP. It should include `The-Fold-Setup-0.1.0.exe` and `The-Fold-Portable-0.1.0.exe`.

The build runs on GitHub's Windows machine. The target PC does not need Node.js installed to run the packaged app.

## Notes

- Output executables are produced by `desktop/package-windows.mjs` in the repository's `release/` folder.
- The portable and installed versions share the same Windows app-data profile (`%APPDATA%\\The Fold - Walsenburg`), so do not run both at once.
- A successful CI build is not the same as a complete gameplay QA pass. Test the portable build offline, then install and test the Setup build before distributing it.
