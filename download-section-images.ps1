<#
    download-section-images.ps1
    Smart ICT Maintenance Management System — section image fetcher

    Downloads 15 unique, section-specific photos from Pexels into
    frontend\assets\images\<section>\ so the homepage galleries can use
    local files only (no hotlinking).

    Scope: the five navbar sections only —
      features\  workflow\  services\  contact\  about\
    The Home hero is out of scope: home1-home8 and the hero markup/CSS/JS
    are never read, written or referenced by this script.

    Design rules enforced by this script:
      * 5 sections x 3 images = 15 files, every file a DIFFERENT image.
      * Every download is verified: HTTP 200, minimum size, and a real
        image magic-byte header (JPEG, PNG or WebP accepted; an HTML
        error page saved as .jpg is still rejected).
      * The 15 SHA-256 hashes are compared; any duplicate is reported as
        a failure so a reused photo can never slip through unnoticed.
      * Existing root images (home1-home8, mau_logo.jpg, ...) are never
        read, moved, renamed or overwritten.
      * The folder frontend\assets\images\home\ is never created.

    Usage
      .\download-section-images.ps1
      .\download-section-images.ps1 -Force          # re-download even if present
      .\download-section-images.ps1 -Width 1920
#>

[CmdletBinding()]
param(
    [string] $ProjectRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [int]    $Width        = 1600,
    [int]    $Retries      = 3,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$ImageRoot = Join-Path $ProjectRoot 'frontend\assets\images'

# ---------------------------------------------------------------------------
# Manifest — 15 hand-picked Pexels photo IDs, one unique photo per slot.
# Every URL below was checked for HTTP 200 before being added to this list.
# To swap an image, change Id and Topic; do not reuse an Id.
# ---------------------------------------------------------------------------
$Manifest = @(
    # NOTE: the Home hero is deliberately NOT in this manifest. The hero keeps
    # its existing home1-home8 rotation and is handled separately.

    # --- Features: request / tracking / monitoring --------------------------
    @{ Folder = 'features'; File = 'features-01.jpg'; Id = 5912197;  Topic = 'User submitting a request online' }
    @{ Folder = 'features'; File = 'features-02.jpg'; Id = 3183153;  Topic = 'Tracking dashboard and maintenance records' }
    @{ Folder = 'features'; File = 'features-03.jpg'; Id = 6963944;   Topic = 'Real-time monitoring and notifications' }

    # --- Workflow: submit -> technician -> completed -----------------------
    @{ Folder = 'workflow'; File = 'workflow-01.jpg'; Id = 7075408;  Topic = 'User submits a maintenance request' }
    @{ Folder = 'workflow'; File = 'workflow-02.jpg'; Id = 7859349;   Topic = 'Technician works on the assignment' }
    @{ Folder = 'workflow'; File = 'workflow-03.jpg'; Id = 577210;   Topic = 'Completed request and status tracking' }

    # --- Services: computer / printer / network -----------------------------
    @{ Folder = 'services'; File = 'services-01.jpg'; Id = 6804590;   Topic = 'Computer and cable repair' }
    @{ Folder = 'services'; File = 'services-02.jpg'; Id = 37492296;  Topic = 'Printer and device maintenance' }
    @{ Folder = 'services'; File = 'services-03.jpg'; Id = 1054397;   Topic = 'Network and server support' }

    # --- Contact: help desk / communication ---------------------------------
    @{ Folder = 'contact';  File = 'contact-01.jpg';  Id = 7709099;   Topic = 'ICT help desk agent on headset' }
    @{ Folder = 'contact';  File = 'contact-02.jpg';  Id = 7709147;   Topic = 'Technical support at the service desk' }
    @{ Folder = 'contact';  File = 'contact-03.jpg';  Id = 3912378;   Topic = 'Technician communicating with requester' }

    # --- About Us: team / university / infrastructure ----------------------
    @{ Folder = 'about';    File = 'about-01.jpg';    Id = 12741849;  Topic = 'Professional ICT maintenance team' }
    @{ Folder = 'about';    File = 'about-02.jpg';    Id = 18265837;  Topic = 'University technology environment' }
    @{ Folder = 'about';    File = 'about-03.jpg';    Id = 6466141;   Topic = 'Modern IT infrastructure' }
)

# --- sanity check on the manifest itself (before any network call) --------
if ($Manifest.Count -ne 15) {
    throw "Manifest must contain exactly 15 entries, found $($Manifest.Count)."
}
$dupIds = $Manifest | Group-Object Id | Where-Object Count -gt 1
if ($dupIds) {
    throw "Duplicate Pexels Id(s) in manifest: $($dupIds.Name -join ', ')"
}
$dupFiles = $Manifest | Group-Object File | Where-Object Count -gt 1
if ($dupFiles) {
    throw "Duplicate filename(s) in manifest: $($dupFiles.Name -join ', ')"
}

function Test-ImageFile {
    <#  Verifies a file is a real image, not an HTML error page saved as .jpg.
        Pexels may serve JPEG, PNG or WebP depending on the query string and
        the CDN edge, so all three are accepted. An HTTP error page starts with
        '<' (0x3C) or is far too small, so it still fails.                  #>
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -lt 20000) { return $false }
    $fs = [IO.File]::OpenRead($Path)
    try {
        $buf = New-Object byte[] 12
        $read = $fs.Read($buf, 0, 12)
        if ($read -lt 4) { return $false }

        # JPEG: FF D8 FF
        if ($buf[0] -eq 0xFF -and $buf[1] -eq 0xD8 -and $buf[2] -eq 0xFF) { return $true }

        # PNG: 89 50 4E 47 0D 0A 1A 0A
        if ($read -ge 8 -and
            $buf[0] -eq 0x89 -and $buf[1] -eq 0x50 -and $buf[2] -eq 0x4E -and $buf[3] -eq 0x47) { return $true }

        # WebP: "RIFF" ....  "WEBP"
        if ($read -ge 12 -and
            $buf[0] -eq 0x52 -and $buf[1] -eq 0x49 -and $buf[2] -eq 0x46 -and $buf[3] -eq 0x46 -and
            $buf[8] -eq 0x57 -and $buf[9] -eq 0x45 -and $buf[10] -eq 0x42 -and $buf[11] -eq 0x50) { return $true }

        return $false
    } finally { $fs.Dispose() }
}

Write-Host ''
Write-Host ' Smart ICT Maintenance - section image downloader' -ForegroundColor Cyan
Write-Host " Target : $ImageRoot" -ForegroundColor DarkGray
Write-Host " Images : $($Manifest.Count) across 5 sections (width ${Width}px)" -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path -LiteralPath $ImageRoot)) {
    New-Item -ItemType Directory -Path $ImageRoot -Force | Out-Null
    Write-Host " Created $ImageRoot" -ForegroundColor Yellow
}

foreach ($folder in ($Manifest.Folder | Sort-Object -Unique)) {
    $dir = Join-Path $ImageRoot $folder
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}
Write-Host ' Section folders ready.' -ForegroundColor Green
Write-Host ''

$results = @()

foreach ($item in $Manifest) {
    $dir      = Join-Path $ImageRoot $item.Folder
    $dest     = Join-Path $dir $item.File
    $url      = "https://images.pexels.com/photos/$($item.Id)/pexels-photo-$($item.Id).jpeg?auto=compress&cs=tinysrgb&fm=jpg&w=$Width"
    $label    = "{0}/{1}" -f $item.Folder, $item.File

    $existingOk = (Test-ImageFile -Path $dest)
    if ($existingOk -and -not $Force) {
        Write-Host ("  [skip]  {0,-24} already present" -f $label) -ForegroundColor DarkGray
        $results += [pscustomobject]@{
            File = $label; Status = 'SKIP'; Bytes = (Get-Item -LiteralPath $dest).Length
            Topic = $item.Topic; Url = $url
            Hash  = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
        }
        continue
    }

    $ok = $false
    for ($attempt = 1; $attempt -le $Retries -and -not $ok; $attempt++) {
        try {
            $tmp = "$dest.part"
            if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }

            Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 60
            if (-not (Test-ImageFile -Path $tmp)) { throw 'downloaded file is not a valid image (or is too small)' }

            if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
            Move-Item -LiteralPath $tmp -Destination $dest
            $ok = $true
        } catch {
            if (Test-Path -LiteralPath "$dest.part") { Remove-Item -LiteralPath "$dest.part" -Force }
            if ($attempt -lt $Retries) {
                Write-Host ("  [retry] {0} attempt {1} failed: {2}" -f $label, $attempt, $_.Exception.Message) -ForegroundColor Yellow
                Start-Sleep -Seconds (2 * $attempt)
            } else {
                Write-Host ("  [FAIL]  {0} : {1}" -f $label, $_.Exception.Message) -ForegroundColor Red
            }
        }
    }

    if ($ok) {
        $len = (Get-Item -LiteralPath $dest).Length
        Write-Host ("  [ok]    {0,-24} {1,9:N0} bytes  {2}" -f $label, $len, $item.Topic) -ForegroundColor Green
        $results += [pscustomobject]@{
            File = $label; Status = 'OK'; Bytes = $len
            Topic = $item.Topic; Url = $url
            Hash  = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
        }
    } else {
        $results += [pscustomobject]@{
            File = $label; Status = 'FAIL'; Bytes = 0
            Topic = $item.Topic; Url = $url; Hash = ''
        }
    }
}

# --- cross-image duplicate detection --------------------------------------
$downloaded = $results | Where-Object { $_.Status -ne 'FAIL' -and $_.Hash }
$clashes    = $downloaded | Group-Object Hash | Where-Object Count -gt 1

Write-Host ''
Write-Host ' Summary' -ForegroundColor Cyan
Write-Host ' -------'
$results | Group-Object Status | Sort-Object Name | ForEach-Object {
    $c = $_.Count
    $col = if ($_.Name -eq 'FAIL') { 'Red' } elseif ($_.Name -eq 'OK') { 'Green' } else { 'DarkGray' }
    Write-Host ("  {0,-5} {1,3}" -f $_.Name, $c) -ForegroundColor $col
}
Write-Host ("  unique image hashes : {0} / {1}" -f ($downloaded.Hash | Sort-Object -Unique).Count, $downloaded.Count)
Write-Host ''

$failed = $results | Where-Object Status -eq 'FAIL'

if ($clashes) {
    Write-Host ' REUSED IMAGES DETECTED - the same photo was downloaded more than once:' -ForegroundColor Red
    $clashes | ForEach-Object { Write-Host ("   {0}" -f (($_.Group.File) -join '  ==  ')) -ForegroundColor Red }
    Write-Host ' Fix: give each slot a different Pexels Id in $Manifest.' -ForegroundColor Red
    Write-Host ''
}
if ($failed) {
    Write-Host ' To repair a failure, open this script, change the Id for these slots,' -ForegroundColor Yellow
    Write-Host ' then re-run. Failed URLs:' -ForegroundColor Yellow
    $failed | ForEach-Object { Write-Host ("   {0}  {1}" -f $_.File, $_.Url) -ForegroundColor Yellow }
    Write-Host ''
}

if ($failed -or $clashes) {
    Write-Host ' RESULT: incomplete. See messages above.' -ForegroundColor Red
    exit 1
}

Write-Host ' RESULT: 5 sections x 3 unique images = 15 verified local images.' -ForegroundColor Green
Write-Host ' features/ workflow/ services/ contact/ about/' -ForegroundColor DarkGray
Write-Host ' The Home hero and home1-home8 were not touched and are not part of this run.' -ForegroundColor DarkGray
exit 0
