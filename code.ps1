# add-themes-v2.ps1
# Adds / updates the "Vampire" and "Mint Gum" themes with a Cyberpunk-style multi-color setup.
# Replaces the earlier add-themes.ps1 (overwrites vampire.ts and mint-gum.ts; safe to re-run).
#
# Usage (from your project folder, or pass a path):
#   powershell -ExecutionPolicy Bypass -File .\add-themes-v2.ps1
#   powershell -ExecutionPolicy Bypass -File .\add-themes-v2.ps1 -ProjectRoot "C:\path\to\project"
#   powershell -ExecutionPolicy Bypass -File .\add-themes-v2.ps1 -ThemesDir "C:\path\to\themes"

param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$ThemesDir = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------- locate themes dir
if (-not $ThemesDir) {
  $skip = '\\(node_modules|dist|out|release|build|\.git)\\'
  $hit = Get-ChildItem -Path $ProjectRoot -Recurse -File -Filter 'light.ts' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $skip -and $_.Directory.Name -eq 'themes' } |
    Select-Object -First 1
  if (-not $hit) {
    throw "Could not find a 'themes' folder containing light.ts under $ProjectRoot. Re-run with -ThemesDir <path>."
  }
  $ThemesDir = $hit.DirectoryName
}
if (-not (Test-Path (Join-Path $ThemesDir 'light.ts'))) {
  throw "light.ts not found in $ThemesDir"
}
Write-Host "Themes folder: $ThemesDir" -ForegroundColor Cyan

# ---------------------------------------------------------------- vampire.ts
$vampire = @'
import type { Theme } from './types';

/**
 * Vampire — blood-crimson + amethyst + antique gold on near-black burgundy.
 * Same recipe as Cyberpunk, different palette:
 *
 *   dark-4                         -> dividers / panel borders (dim wine)
 *   --mantine-color-default-border -> input / button borders (brighter wine)
 *   indigo scale                   -> primary accent (blood crimson)
 *   blue scale                     -> links / secondary accent (amethyst)
 *   gold                           -> small highlights (slider thumb, waveform track)
 */
const BODY = '#0b0307';
const DEEP = '#070204';
const LINE = '#4d1226';        // dividers
const LINE_STRONG = '#7d1a3b'; // inputs / buttons
const ROW = '#1f0a14';         // hover / selected rows
const GOLD = '#a71935';

const vampire: Theme = {
  id: 'vampire',
  label: 'Vampire',
  colorScheme: 'dark',

  colors: {
    'dark-4': LINE,
    'dark-5': ROW,
    'dark-6': '#12050b',
    'dark-7': '#0e0409',
    'dark-8': BODY,

    'text-primary': '#f5e9ec',
    'text-dimmed': '#b08a95',
    'gray-2': '#f0dde2',
    'gray-3': '#e0c9cf',

    indigo: '#e03a52',
    teal: '#c084fc',
    violet: '#9d54ff',
    orange: '#ff8a3d',
    red: '#ff3b4e',
    grape: '#e03a52',
    green: '#4ade80',
    yellow: GOLD
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-dark-0': '#f5e9ec',
    '--mantine-color-dark-1': '#e0c9cf',
    '--mantine-color-dark-2': '#c4a3ad',
    '--mantine-color-dark-3': '#9b7480',
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': ROW,
    '--mantine-color-dark-6': '#12050b',
    '--mantine-color-dark-7': '#0e0409',
    '--mantine-color-dark-8': BODY,
    '--mantine-color-dark-9': DEEP,
    '--mantine-color-body': BODY,
    '--mantine-color-default': '#0e0409',
    '--mantine-color-default-hover': ROW,
    '--mantine-color-default-border': LINE_STRONG,

    // Primary accent: blood crimson
    '--mantine-color-indigo-0': '#ffe3e8',
    '--mantine-color-indigo-1': '#ffc2cd',
    '--mantine-color-indigo-2': '#ff9fb0',
    '--mantine-color-indigo-3': '#ff7a92',
    '--mantine-color-indigo-4': '#f2506d',
    '--mantine-color-indigo-5': '#e03a52',
    '--mantine-color-indigo-6': '#c9184a',
    '--mantine-color-indigo-7': '#a4133c',
    '--mantine-color-indigo-8': '#800f2f',
    '--mantine-color-indigo-9': '#590d22',
    '--mantine-primary-color-filled': '#c9184a',
    '--mantine-primary-color-filled-hover': '#e03a52',
    '--mantine-primary-color-light': 'rgba(224,58,82,0.15)',
    '--mantine-primary-color-light-hover': 'rgba(224,58,82,0.25)',
    '--mantine-primary-color-light-color': '#ff7a92',

    // Secondary accent: amethyst (links, info chips)
    '--mantine-color-blue-0': '#f3e8ff',
    '--mantine-color-blue-1': '#e2ccff',
    '--mantine-color-blue-2': '#d0adff',
    '--mantine-color-blue-3': '#bd8cff',
    '--mantine-color-blue-4': '#ab6dff',
    '--mantine-color-blue-5': '#9d54ff',
    '--mantine-color-blue-6': '#8a3df0',
    '--mantine-color-blue-7': '#7230cc',
    '--mantine-color-blue-8': '#5a26a3',
    '--mantine-color-blue-9': '#401b75',

    // App-specific
    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-waveform-filter': 'brightness(1.3) saturate(1.4)',
    '--wh3d-waveform-played': '#e03a52',
    '--wh3d-waveform-unplayed': 'rgba(125,26,59,0.45)',
    '--wh3d-viewport-bg': '#050104',
    '--wh3d-slider-track': 'rgba(125,26,59,0.35)',
    '--wh3d-slider-thumb-bg': '#e03a52',
    '--wh3d-slider-thumb-border': '#a71935',
    '--wh3d-overlay-bg': 'rgba(11,3,7,0.9)',
    '--wh3d-overlay-border': LINE_STRONG,
    '--wh3d-viz-top': '#ff7a92',
    '--wh3d-viz-mid': '#a4133c'
  }
};

export default vampire;
'@

# ---------------------------------------------------------------- mint-gum.ts
$mint = @'
import type { Theme } from './types';

/**
 * Mint Gum — fresh mint green + bubble-gum pink on soft green-tinted white.
 * A light-mode take on the Cyberpunk recipe:
 *
 *   dark-4                         -> dividers / panel borders (soft mint)
 *   --mantine-color-default-border -> input / button borders (stronger mint)
 *   indigo scale                   -> primary accent (mint green)
 *   blue scale                     -> links / secondary accent (bubble-gum pink)
 *
 * The indigo steps 1-3 are dark greens on purpose: the app uses them as TEXT
 * colors (breadcrumbs, active links), which must read on a light background.
 */
const BODY = '#f3fcf6';
const LINE = '#a8dfbd';        // dividers
const LINE_STRONG = '#7fcfa0'; // inputs / buttons
const ROW = '#d6f3e0';         // hover / selected rows
const GUM = '#8fe3b0';

const mintGum: Theme = {
  id: 'mint-gum',
  label: 'Mint Gum',
  colorScheme: 'light',

  colors: {
    'dark-4': LINE,
    'dark-5': ROW,
    'dark-6': '#e6f8ec',
    'dark-7': '#eefaf2',
    'dark-8': BODY,

    'text-primary': '#12301f',
    'text-dimmed': '#5b7a68',
    'gray-2': '#1f4a33',
    'gray-3': '#2d5f45',

    indigo: '#0f9d58',
    teal: '#12b886',
    violet: '#9775fa',
    orange: '#fd7e14',
    red: '#e03131',
    grape: GUM,
    green: '#2f9e44',
    yellow: '#f08c00'
  },

  cssVars: {
    // Surfaces + lines
    '--mantine-color-text': '#12301f',
    '--mantine-color-dimmed': '#5b7a68',
    '--mantine-color-gray-2': '#1f4a33',
    '--mantine-color-gray-3': '#2d5f45',
    '--mantine-color-dark-4': LINE,
    '--mantine-color-dark-5': ROW,
    '--mantine-color-dark-6': '#e6f8ec',
    '--mantine-color-dark-7': '#eefaf2',
    '--mantine-color-dark-8': BODY,
    '--mantine-color-body': BODY,
    '--mantine-color-default': '#ffffff',
    '--mantine-color-default-hover': ROW,
    '--mantine-color-default-border': LINE_STRONG,

    // Primary accent: mint green (1-3 darkened for text legibility)
    '--mantine-color-indigo-0': '#e6fcf0',
    '--mantine-color-indigo-1': '#0a5c35',
    '--mantine-color-indigo-2': '#0b6b3e',
    '--mantine-color-indigo-3': '#117a48',
    '--mantine-color-indigo-4': '#18a058',
    '--mantine-color-indigo-5': '#12a150',
    '--mantine-color-indigo-6': '#0f9d58',
    '--mantine-color-indigo-7': '#0c8449',
    '--mantine-color-indigo-8': '#096b3b',
    '--mantine-color-indigo-9': '#06522d',
    '--mantine-primary-color-filled': '#0f9d58',
    '--mantine-primary-color-filled-hover': '#0c8449',
    '--mantine-primary-color-light': 'rgba(15,157,88,0.14)',
    '--mantine-primary-color-light-hover': 'rgba(15,157,88,0.22)',
    '--mantine-primary-color-light-color': '#0b6b3e',

    // Secondary accent: bubble-gum pink (links, info chips)
    '--mantine-color-blue-0': '#fff0f6',
    '--mantine-color-blue-1': '#ffdeeb',
    '--mantine-color-blue-2': '#fcc2d7',
    '--mantine-color-blue-3': '#faa2c1',
    '--mantine-color-blue-4': '#f783ac',
    '--mantine-color-blue-5': '#f06595',
    '--mantine-color-blue-6': '#e64980',
    '--mantine-color-blue-7': '#d6336c',
    '--mantine-color-blue-8': '#b02a5b',
    '--mantine-color-blue-9': '#8c1f48',

    // App-specific (blend/filter approach copied from the Light theme)
    '--wh3d-waveform-blend': 'normal',
    '--wh3d-waveform-opacity': '0.5',
    '--wh3d-waveform-filter': 'brightness(1.05) saturate(1.1)',
    '--wh3d-waveform-played': '#12a150',
    '--wh3d-waveform-unplayed': 'rgba(143,227,176,0.65)',
    '--wh3d-viewport-bg': '#dff5e7',
    '--wh3d-slider-track': '#b8edcc',
    '--wh3d-slider-thumb-bg': '#ffffff',
    '--wh3d-slider-thumb-border': '#8fe3b0',
    '--wh3d-overlay-bg': 'rgba(243,252,246,0.88)',
    '--wh3d-overlay-border': LINE_STRONG,
    '--wh3d-viz-top': '#b8edcc',
    '--wh3d-viz-mid': '#0f9d58'
  }
};

export default mintGum;
'@

[System.IO.File]::WriteAllText((Join-Path $ThemesDir 'vampire.ts'), $vampire, $utf8)
[System.IO.File]::WriteAllText((Join-Path $ThemesDir 'mint-gum.ts'), $mint, $utf8)
Write-Host 'Wrote vampire.ts and mint-gum.ts' -ForegroundColor Green

# ---------------------------------------------------------------- register in index.ts
$indexPath = Join-Path $ThemesDir 'index.ts'
$needManual = $false

if (-not (Test-Path $indexPath)) {
  Write-Host 'No index.ts found in the themes folder.' -ForegroundColor Yellow
  $needManual = $true
} else {
  $src = [System.IO.File]::ReadAllText($indexPath)

  if ($src -match 'import\.meta\.glob') {
    Write-Host 'index.ts auto-registers every file in the folder - nothing to patch.' -ForegroundColor Green
  }
  elseif ($src -match "from\s+'\./vampire'") {
    Write-Host 'index.ts already registers the themes - nothing to patch.' -ForegroundColor Green
  }
  else {
    $imp = [regex]::Match($src, "(?m)^import\s+(\w+)\s+from\s+'\./light'[ \t]*;?[ \t]*\r?$")
    $arr = [regex]::Match($src, '(?s)(THEMES[^=]*=\s*\[)(.*?)(\])')

    if ($imp.Success -and $arr.Success) {
      $lightName = $imp.Groups[1].Value
      $inner = $arr.Groups[2].Value
      $re = New-Object System.Text.RegularExpressions.Regex("\b$lightName\b")

      if ($re.IsMatch($inner)) {
        Copy-Item $indexPath "$indexPath.bak" -Force
        $newInner = $re.Replace($inner, "$lightName, vampire, mintGum", 1)
        $patched = $src.Substring(0, $arr.Index) +
                   $arr.Groups[1].Value + $newInner + $arr.Groups[3].Value +
                   $src.Substring($arr.Index + $arr.Length)
        $nl = if ($src -match "`r`n") { "`r`n" } else { "`n" }
        $importLine = $imp.Value.TrimEnd("`r")
        $cr = if ($imp.Value.EndsWith("`r")) { "`r" } else { '' }
        $patched = $patched.Replace(
          $imp.Value,
          $importLine + $nl + "import vampire from './vampire';" + $nl + "import mintGum from './mint-gum';" + $cr
        )
        [System.IO.File]::WriteAllText($indexPath, $patched, $utf8)
        Write-Host 'Patched index.ts (backup: index.ts.bak)' -ForegroundColor Green
      } else {
        $needManual = $true
      }
    } else {
      $needManual = $true
    }
  }
}

if ($needManual) {
  Write-Host ''
  Write-Host 'Could not safely patch index.ts automatically (it is laid out differently than expected).' -ForegroundColor Yellow
  Write-Host 'Add these two imports and put both names in the THEMES array, then you are done:' -ForegroundColor Yellow
  Write-Host "  import vampire from './vampire';"
  Write-Host "  import mintGum from './mint-gum';"
}

Write-Host ''
Write-Host 'Done. Restart the dev server if it is running, then pick the theme from the palette icon.' -ForegroundColor Cyan