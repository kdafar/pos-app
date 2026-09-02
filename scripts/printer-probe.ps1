<#
  On-site thermal printer probe.

  Answers, on the real hardware, the questions the receipt rewrite depends on
  and that no amount of reading the code can settle:

    1. Does a RAW ESC/POS spool job reach this printer at all?
       (If yes, the whole class of "driver dropped the page" faults goes away,
        because RAW has no page size to negotiate.)
    2. How many characters fit on a line -> 32 = 58mm head, 48 = 80mm head.
    3. Does the printer support GS v 0 raster graphics? That is how Arabic and
       the logo have to be printed, since ESC/POS text mode cannot shape or
       reverse Arabic.
    4. What is the true printable width in dots, measured off the paper?
    5. Does the cut command work, and the drawer kick?

  Nothing here touches the POS app or its settings. It talks straight to the
  Windows spooler, exactly the way cashDrawer.ts already does.

  Usage:
    powershell -ExecutionPolicy Bypass -File printer-probe.ps1
        -> lists printers, changes nothing

    powershell -ExecutionPolicy Bypass -File printer-probe.ps1 -PrinterName "XP-80C"
        -> runs the full probe on that printer

    Add -Drawer to also fire the cash drawer.
#>
param(
  [string]$PrinterName,
  [switch]$Drawer
)

$ErrorActionPreference = 'Stop'

# ---- RAW spooler channel (same winspool path cashDrawer.ts uses) -----------
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PosProbePrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinterW(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinterW(IntPtr hPrinter, int level, [In] DOCINFOW di);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void Send(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinterW(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed for '" + printerName + "' (error " + Marshal.GetLastWin32Error() + ")");
        try
        {
            DOCINFOW di = new DOCINFOW();
            di.pDocName = "POS printer probe";
            di.pDataType = "RAW";
            if (!StartDocPrinterW(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ")");
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
                IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, buf, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
                        throw new Exception("WritePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
                }
                finally { Marshal.FreeCoTaskMem(buf); }
                EndPagePrinter(hPrinter);
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
'@

function Send-Raw([byte[]]$Bytes) { [PosProbePrinter]::Send($PrinterName, $Bytes) }
function A([string]$s) { [System.Text.Encoding]::ASCII.GetBytes($s) }

# ---- step 0: identify -----------------------------------------------------
Write-Host ""
Write-Host "=== PRINTERS ON THIS MACHINE ===" -ForegroundColor Cyan
Get-CimInstance Win32_Printer |
  Select-Object Name, Default, PortName, DriverName, PrinterStatus, WorkOffline |
  Format-List

if (-not $PrinterName) {
  Write-Host "No -PrinterName given. Copy the exact Name above and re-run:" -ForegroundColor Yellow
  Write-Host '  powershell -ExecutionPolicy Bypass -File printer-probe.ps1 -PrinterName "EXACT NAME"' -ForegroundColor Yellow
  Write-Host ""
  return
}

Write-Host "=== PAPER SIZES (FORMS) THIS DRIVER ACCEPTS ===" -ForegroundColor Cyan
Write-Host "(A page size the app asks for that is not in this list is what makes" -ForegroundColor DarkGray
Write-Host " the driver silently discard the job and feed blank paper.)" -ForegroundColor DarkGray
try {
  Get-PrintCapability -PrinterName $PrinterName -ErrorAction Stop |
    Select-Object -ExpandProperty PageMediaSize |
    Select-Object DisplayName, @{n='WidthMicrons';e={$_.Width}}, @{n='HeightMicrons';e={$_.Height}} |
    Format-Table -AutoSize
} catch {
  try {
    (Get-CimInstance Win32_Printer -Filter "Name='$($PrinterName -replace "'","''")'").PrinterPaperNames
  } catch { Write-Host "  could not read forms: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# ---- ESC/POS building blocks ---------------------------------------------
$ESC = 0x1B; $GS = 0x1D
$INIT     = [byte[]]@($ESC, 0x40)                 # ESC @  initialise
$FEED3    = [byte[]]@($ESC, 0x64, 0x03)           # ESC d 3  feed 3 lines
$CUT      = [byte[]]@($GS, 0x56, 0x42, 0x00)      # GS V B 0  feed and full cut
$BOLD_ON  = [byte[]]@($ESC, 0x45, 0x01)
$BOLD_OFF = [byte[]]@($ESC, 0x45, 0x00)
$KICK2    = [byte[]]@($ESC, 0x70, 0x00, 0x19, 0xFA)  # drawer, pin 2
$KICK5    = [byte[]]@($ESC, 0x70, 0x01, 0x19, 0xFA)  # drawer, pin 5

# ---- TEST 1: does RAW reach the printer, and how wide is a line? ----------
Write-Host ""
Write-Host "=== TEST 1: raw text + column count ===" -ForegroundColor Cyan
$ruler48 = "123456789012345678901234567890123456789012345678"   # 48 cols = 80mm
$bytes = @()
$bytes += $INIT
$bytes += $BOLD_ON;  $bytes += A("PROBE 1 - RAW TEXT`n"); $bytes += $BOLD_OFF
$bytes += A("If you can read this, RAW ESC/POS works.`n`n")
$bytes += A("Count where this line ends:`n")
$bytes += A("$ruler48`n")
$bytes += A("^ ends at 48 = 80mm head (576 dots)`n")
$bytes += A("^ wraps at 32 = 58mm head (384 dots)`n")
$bytes += $FEED3
Send-Raw ([byte[]]$bytes)
Write-Host "  sent. LOOK AT THE PAPER." -ForegroundColor Green

# ---- TEST 2: raster ruler at both candidate widths -----------------------
function New-RulerRaster([int]$WidthDots) {
  # GS v 0 : 1D 76 30 m xL xH yL yH [data], MSB first, 1 bit = black dot.
  $bytesPerLine = [int]($WidthDots / 8)
  $height = 24
  $data = New-Object 'System.Collections.Generic.List[byte]'
  for ($y = 0; $y -lt $height; $y++) {
    for ($b = 0; $b -lt $bytesPerLine; $b++) {
      $v = 0
      for ($bit = 0; $bit -lt 8; $bit++) {
        $x = $b * 8 + $bit
        # 203dpi: 8 dots = 1mm. Tall tick every 10mm, medium every 5mm, small every 1mm.
        $tick = 0
        if ($x % 80 -eq 0) { $tick = 24 } elseif ($x % 40 -eq 0) { $tick = 16 } elseif ($x % 8 -eq 0) { $tick = 8 }
        # solid 3-dot baseline across the full width, so the true printable
        # width can be measured straight off the paper with a ruler
        $on = ($y -ge ($height - 3)) -or (($height - $y) -le $tick)
        if ($on) { $v = $v -bor (1 -shl (7 - $bit)) }
      }
      $data.Add([byte]$v)
    }
  }
  $out = New-Object 'System.Collections.Generic.List[byte]'
  $out.AddRange([byte[]]@($GS, 0x76, 0x30, 0x00))
  $out.Add([byte]($bytesPerLine -band 0xFF)); $out.Add([byte](($bytesPerLine -shr 8) -band 0xFF))
  $out.Add([byte]($height -band 0xFF));       $out.Add([byte](($height -shr 8) -band 0xFF))
  $out.AddRange($data)
  return [byte[]]$out.ToArray()
}

Write-Host ""
Write-Host "=== TEST 2: GS v 0 raster ruler (576 then 384 dots) ===" -ForegroundColor Cyan
$bytes = @()
$bytes += $INIT
$bytes += A("PROBE 2 - RASTER 576 dots (80mm)`n")
$bytes += (New-RulerRaster 576)
$bytes += A("`nPROBE 2 - RASTER 384 dots (58mm)`n")
$bytes += (New-RulerRaster 384)
$bytes += A("`nTall tick = 10mm, short = 1mm.`n")
$bytes += A("The solid bar shows true print width.`n")
$bytes += $FEED3
Send-Raw ([byte[]]$bytes)
Write-Host "  sent. LOOK AT THE PAPER." -ForegroundColor Green

# ---- TEST 3: cut ---------------------------------------------------------
Write-Host ""
Write-Host "=== TEST 3: auto-cut ===" -ForegroundColor Cyan
$bytes = @()
$bytes += $INIT
$bytes += A("PROBE 3 - CUT TEST`nThe paper should cut below.`n")
$bytes += $FEED3
$bytes += $CUT
Send-Raw ([byte[]]$bytes)
Write-Host "  sent. Did it cut by itself?" -ForegroundColor Green

# ---- TEST 4: drawer (opt-in) --------------------------------------------
if ($Drawer) {
  Write-Host ""
  Write-Host "=== TEST 4: cash drawer ===" -ForegroundColor Cyan
  Send-Raw $KICK2; Write-Host "  pin 2 sent" -ForegroundColor Green
  Start-Sleep -Milliseconds 1500
  Send-Raw $KICK5; Write-Host "  pin 5 sent" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== DONE - report back ===" -ForegroundColor Cyan
Write-Host "  1. Did PROBE 1 print readable text?          (RAW works / does not)"
Write-Host "  2. Where did the number line end/wrap?       (48 or 32)"
Write-Host "  3. Did PROBE 2 print two clean rulers?       (GS v 0 works / garbled / nothing)"
Write-Host "  4. Measure the solid bar with a ruler:       (____ mm wide)"
Write-Host "  5. Did PROBE 3 cut the paper?                (yes / no)"
Write-Host ""
