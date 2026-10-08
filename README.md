# SMBActiveDirectoryDeployManager

A Windows desktop application for deploying software through Group Policy in
Samba Active Directory environments. This fork uses LDAP for directory access
and keeps Microsoft's GroupPolicy PowerShell module for GPO management.

Repository: [afaminx/SMBActiveDirectoryDeployManager](https://github.com/afaminx/SMBActiveDirectoryDeployManager)

Based on [ActiveDirectoryDeployManager by gpandres](https://github.com/gpandres/ActiveDirectoryDeployManager).
The application version is **1.2.11**. The current modification revision is
**mod-rev-2.1**; these are separate version numbers. The updater displays and compares the fork release version **2.1**, while deployment metadata retains the upstream application version **1.2.11**.

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
- Hidden SMB shares ending in `$` are supported for deployment scripts. Paths
  stay within the configured trusted roots and are preserved as literal strings.
- Application errors, activity messages and generated deployment diagnostics
  use English. System tools and user-provided scripts may return their own text.
- Selecting English also translates dashboard telemetry, dialogs, tooltips,
  template controls and the Office wizard. Spanish uses its own GUI dictionary.

The implementation supports Samba AD and Microsoft AD. See [revision notes](REVISION.txt) for the changes in this fork.

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
6. Create a deployment and link its GPO to the required OUs.

Deployment scripts execute at computer startup. Installers remain on the software share; they are not moved into SYSVOL.

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

The build creates `codex/bin/mod-rev-2.1/win-unpacked/` and
`codex/pkg/mod-rev-2.1/ADDeployManager-Portable.exe` in a standalone checkout.
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

## Automated checks

Local tests cover generated PowerShell syntax, LDAP response shapes, input
quoting, startup ownership, unrelated script/CSE preservation, policy versions,
and mocked LDAP write failures with local file rollback.

Legacy startup scripts without an ownership record require manual review before
automatic removal. Avoid concurrent GPMC edits to a policy while the application
is writing it. LDAP and SMB updates cannot form a single transaction, so rollback
is best effort and incomplete rollback is reported.

## Issues and license

Report problems in this fork's
[issue tracker](https://github.com/afaminx/SMBActiveDirectoryDeployManager/issues).
Include the modification revision, operation, relevant error and logs;
remove credentials and private environment details from attached logs.

Original application by **gpandres**. Fork maintained under **afaminx**.
Licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). The original license and
author attribution are retained. Application release checks use this fork's
GitHub repository.

Deployment GPO names preserve punctuation and Unicode. Existing policies created under shortened names by earlier builds are recognized through an exact-name-first compatibility lookup; no AD rename is performed.

Deployment scripts report failure and deferred user installations separately. User-only winget/Store apps are scheduled for an interactive sign-in using a language-independent group SID. MSI identity uses ProductCode/UpgradeCode rather than loose name prefixes, preventing unrelated products such as Nextcloud and Nextcloud Talk from matching. Regenerate affected app scripts and republish bundle scripts after upgrading; the script updater also checks the generator revision independently of the application version.

### WinGet deployment

In New Application, select Template → WinGet Package. Search by name or enter an exact package ID, choose winget or Microsoft Store, then select the installation scope. You can edit these settings on existing WinGet applications. Package search uses the local WinGet installation; an unavailable search does not prevent entering an ID manually. Installer scope is shown as unverified rather than guessed. Unsupported scope fails without switching to another scope.

For all users: the startup script uses Microsoft.WinGet.Client in PowerShell 7 MTA under SYSTEM. Install PowerShell 7 on the client beforehand. The optional prerequisite repair may install the WinGet PowerShell module for all users and repair the package manager; it does not install PowerShell 7. Without repair enabled, missing prerequisites produce an explicit failure.

For each user: the startup script registers a limited interactive group task and returns PENDING (60001). The task installs using winget.exe after each user's Windows sign-in and checks packages and trackers in that user's context. It remains registered for later users. SYSTEM does not invoke winget.exe. User results and logs are under LOCALAPPDATA/ADDeployManager; SYSTEM results are under ProgramData/AppDeploy_Logs. Dedicated logging sends pending, success and failure events if configured.

The optional prerequisite repair is off by default. User repair uses the current user's module scope. Downloads require access to PowerShell Gallery/GitHub and applicable client permissions/policies. No credentials are stored. A user package requiring elevation can fail rather than prompting for administrator credentials. The deployment version controls processing; it is not a pinned WinGet installer version. Missing packages are installed and, when a new deployment is processed, available updates are applied.

After upgrading, regenerate existing install/uninstall scripts, verify their scope and republish affected bundles. Old generated scripts are not replaced by copying the executable. Previously created ADDM_Install_* tasks from older scripts should be reviewed and removed manually for migrated applications; the new persistent tasks are ADDM_WinGet_*. Deleting an application does not automatically remove a task on disconnected clients. Machine bundles may remain pending for user apps; they cannot prove installation for every user.

Application and bundle action menus stay within the window, open above their button when needed and scroll when the available height is limited.
