# SMBActiveDirectoryDeployManager

A Windows desktop application for deploying software through Group Policy in
Samba Active Directory environments. This fork uses LDAP for directory access
and keeps Microsoft's GroupPolicy PowerShell module for GPO management.

Repository: [afaminx/SMBActiveDirectoryDeployManager](https://github.com/afaminx/SMBActiveDirectoryDeployManager)

Based on [ActiveDirectoryDeployManager by gpandres](https://github.com/gpandres/ActiveDirectoryDeployManager).
The application version is **1.2.11**. The current modification revision is
**mod-rev-1.4**; these are separate version numbers.

![Application screenshot](img/screenshot.png)

## Samba AD support

Samba AD does not provide Microsoft's Active Directory Web Services (ADWS).
This fork removes the application's dependency on the ActiveDirectory PowerShell
module and TCP port 9389.

- RootDSE, domain information, OU searches, GPO LDAP attributes and `gPLink`
  use `System.DirectoryServices` with the logged-on Windows account.
- GPO creation, enumeration, linking, unlinking and inheritance still use the
  Microsoft GroupPolicy module.
- A configured Domain Controller is used directly. An empty setting uses native
  domain/PDC discovery without ADWS.
- Startup-script changes preserve unrelated script entries and CSE registrations.
  LDAP and SYSVOL policy versions are checked and updated together; write
  failures are reported and rollback is attempted.
- Settings tests LDAP connectivity separately from OU enumeration. Readiness
  checks use LDAP and GroupPolicy availability.

The implementation is intended for both Samba AD and Microsoft AD. Local tests
and package checks pass; real-domain GPMC and Windows 11 integration testing is
still required. See [the manual validation plan](tests/ADMIN-VALIDATION.txt) and
[revision notes](REVISION.txt).

## Features

- Browse OUs, configure Base Search OUs and inspect existing GPO links.
- Create, link, unlink and delete deployment GPOs; assign them to multiple OUs.
- Generate install and uninstall scripts for EXE, MSI, winget and built-in or
  custom deployment templates.
- Group applications into bundles and configure deployment dependencies.
- Detect installed applications through tracker files, file versions or registry
  values to avoid unnecessary reinstallation.
- Keep installers and deployment scripts on your configured SMB share.
- Export/import configuration and use the application's language settings.
- Record local deployment logs or connect the optional self-hosted logging
  backend. See [logs.md](logs.md) for the MariaDB/Fastify/Caddy deployment guide.

## Requirements

On the administration workstation:

- Windows with Windows PowerShell 5.1 and access to your domain.
- A domain account with permission to read directory objects, manage the selected
  GPOs and links, and write the relevant SYSVOL files.
- RSAT **Group Policy Management Tools**, providing the `GroupPolicy` module.
- LDAP connectivity to the Domain Controller and SMB access to SYSVOL.
- A software-repository share writable by administrators and readable by target
  computers.

The ActiveDirectory PowerShell module and ADWS are not required. A failing
`Get-ADDomain` command on Samba AD does not by itself mean the domain is
unreachable. RSAT and domain access are not required on the development/build
machine for local tests and packaging.

## Download and first run

Download the portable executable or unpacked Windows archive from this fork's
[Releases](https://github.com/afaminx/SMBActiveDirectoryDeployManager/releases).
Release executables are currently unsigned.

1. Start the application and select your language.
2. Set the software-repository share path.
3. Set **Domain Controller (multi-DC)** to your DC hostname. Leave it empty only
   when you want native domain/PDC discovery.
4. Select Base Search OUs if you want to limit the OU browser.
5. Check LDAP/GroupPolicy readiness and use **Test AD Connection** in Settings.
6. Create a test deployment and link its GPO to a dedicated test OU before using
   it with production computers.

Deployment scripts execute at computer startup. After `gpupdate /force`, reboot
the test client to validate startup execution. Installers remain on the software
share; they are not moved into SYSVOL.

## Development and build

Use Node.js and pnpm **11.19.0** on Windows.

```powershell
git clone https://github.com/afaminx/SMBActiveDirectoryDeployManager.git
cd SMBActiveDirectoryDeployManager
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

Build the portable release:

```powershell
pnpm run build
```

The build creates `codex/bin/mod-rev-1.4/win-unpacked/` and
`codex/pkg/mod-rev-1.4/ADDeployManager-Portable.exe` in a standalone checkout.
`pnpm run build:dir` creates the unpacked application only. Existing revision
outputs are never overwritten. Select a new `ADDM_REVISION` for another build
and preserve matching source and revision notes; in the revision-directory
layout, copy the source into that new revision first.

If dependency lifecycle scripts are disabled, install Electron before building:

```powershell
node node_modules/electron/install.js
```

The root `pnpm-lock.yaml` is the application's dependency lockfile. The optional
logs server has its own `server/api/package-lock.json`. Dependencies, caches and
generated test files are excluded from Git.

## Validation

Local tests cover generated PowerShell syntax, LDAP response shapes, input
quoting, startup ownership, unrelated script/CSE preservation, policy versions,
and mocked LDAP write failures with local file rollback.

On the separate administration workstation, use the read-only diagnostic with
your actual DC hostname:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\diagnose-samba-ad.ps1 -Server dc.example.test
```

Replace `dc.example.test` with your own DC. The diagnostic can also accept
`-BaseOU` and `-GpoGuid` for a dedicated test OU/GPO. It does not change directory
objects. Follow [ADMIN-VALIDATION.txt](tests/ADMIN-VALIDATION.txt) for the full
GPMC, SYSVOL and Windows 11 test sequence.

Legacy startup scripts without an ownership record require manual review before
automatic removal. Avoid concurrent GPMC edits to a policy while the application
is writing it. LDAP and SMB updates cannot form a single transaction, so rollback
is best effort and incomplete rollback is reported.

## Issues and license

Report problems in this fork's
[issue tracker](https://github.com/afaminx/SMBActiveDirectoryDeployManager/issues).
Include the modification revision, operation, relevant error and test results;
remove credentials and private environment details from attached logs.

Original application by **gpandres**. Fork maintained under **afaminx**.
Licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). The original license and
author attribution are retained. Application release checks use this fork's
GitHub repository.
