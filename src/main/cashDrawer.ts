// src/main/cashDrawer.ts
import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { MainServices } from './types/common';
import { getMeta, setMeta } from './db';
import { assertPermission } from './utils/permissions';

/**
 * A cash drawer is not a computer peripheral. It has no driver and no port of
 * its own: it plugs into the RJ11 socket on the back of the receipt printer,
 * and the printer fires a 24V pulse down that cable to flip the solenoid. So
 * "open the drawer" means "send five bytes to the printer".
 *
 * Those five bytes cannot ride along with the receipt. Receipts are rendered
 * as HTML and printed through the Windows driver (`webContents.print` in
 * print.ts), which hands the driver a rasterised page — there is nowhere in
 * that pipeline to inject raw ESC/POS. The kick therefore travels as its own
 * RAW spool job, which is why nothing in this file touches the print path.
 *
 * Going through the spooler rather than straight at the hardware is what makes
 * this work on both a USB printer and a networked one without knowing which is
 * which: the printer is already installed in Windows (it has to be, or
 * receipts would not print today), so the spooler owns that detail.
 */

/** ESC p m t1 t2 — the ESC/POS drawer kick. */
const ESC = 0x1b;
const KICK = 0x70;
/**
 * Pulse on/off widths, in 2ms units: 50ms on, 500ms off. These are the values
 * every drawer datasheet uses. Too short and a stiff solenoid does not throw;
 * far longer risks cooking the coil on a drawer that is jammed shut.
 */
const PULSE_ON = 0x19;
const PULSE_OFF = 0xfa;

/**
 * Which pin of the RJ11 the drawer answers on. Nearly every drawer is pin 2;
 * a few are pin 5. There is no way to detect it and no harm in trying the
 * other — a drawer on the wrong pin simply does nothing, which on site looks
 * exactly like a software fault. Hence a setting rather than a constant.
 */
export type DrawerPin = 0 | 1;

export function buildKickCommand(pin: DrawerPin = 0): Buffer {
  return Buffer.from([ESC, KICK, pin, PULSE_ON, PULSE_OFF]);
}

export type DrawerConfig = {
  enabled: boolean;
  pin: DrawerPin;
  cashOnly: boolean;
};

/**
 * Local to the till, like the printer choice next to it: two branches on one
 * account have different hardware, and a drawer setting pushed down from the
 * back office would be wrong for half of them. Stored in `meta`, never synced.
 *
 * Off by default. Every existing till must behave on upgrade exactly as it
 * does today, and only the one shop that asked for this turns it on.
 */
export function getDrawerConfig(): DrawerConfig {
  // `meta` only, with no app_settings fallback — unlike the printer settings
  // next door, which do fall back so a chain can push a house default.
  //
  // A drawer is a physical box of cash on a specific counter. A server setting
  // named `drawer.enabled` arriving in a future catalog push would otherwise
  // start popping tills open across every branch at once, with nobody having
  // touched the till that did it. The screen promises "saved on this device
  // only"; this is what makes that true.
  const enabled = String(getMeta('drawer.enabled') ?? '').trim() === '1';
  const pinRaw = String(getMeta('drawer.pin') ?? '0').trim();
  // Anything unrecognised means pin 2, the overwhelmingly common wiring.
  const pin: DrawerPin = pinRaw === '1' ? 1 : 0;
  // Absent means on: a till drawer is for cash, and popping it on a KNET sale
  // is the behaviour shops complain about in every other POS.
  const cashOnlyRaw = String(getMeta('drawer.cash_only') ?? '').trim();
  const cashOnly = cashOnlyRaw === '' ? true : cashOnlyRaw === '1';
  return { enabled, pin, cashOnly };
}

/**
 * Payment method slugs come from the server, so this cannot be an equality
 * check against a fixed list. `cash` is the built-in fallback slug used when
 * no method is chosen (see CheckoutModal), and a chain may well have `cash_kd`
 * or `cash-counter` alongside it.
 */
export function isCashPayment(slug?: string | null): boolean {
  const s = String(slug ?? '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  return /(^|[_-])cash([_-]|$)/.test(s);
}

/**
 * The Windows RAW spool job, via winspool. There is no way to do this from
 * Node without either a native module or an external process, and a native
 * module would need rebuilding against every Electron ABI we ship — the same
 * tax better-sqlite3 already charges. PowerShell is on every Windows target,
 * needs no install step, and adds nothing to the bundle.
 */
const PS_SCRIPT = [
  'param(',
  '  [Parameter(Mandatory=$true)][string]$PrinterName,',
  '  [Parameter(Mandatory=$true)][string]$DataPath',
  ')',
  "$ErrorActionPreference = 'Stop'",
  '',
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  '',
  'public static class PosRawPrinter',
  '{',
  '    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '    public class DOCINFOW',
  '    {',
  '        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;',
  '        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;',
  '        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;',
  '    }',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    public static extern bool OpenPrinterW(string src, out IntPtr hPrinter, IntPtr pd);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    public static extern bool ClosePrinter(IntPtr hPrinter);',
  '',
  '    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]',
  '    public static extern bool StartDocPrinterW(IntPtr hPrinter, int level,',
  '        [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    public static extern bool EndDocPrinter(IntPtr hPrinter);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    public static extern bool StartPagePrinter(IntPtr hPrinter);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    public static extern bool EndPagePrinter(IntPtr hPrinter);',
  '',
  '    [DllImport("winspool.drv", SetLastError = true)]',
  '    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);',
  '',
  '    static void Fail(string what)',
  '    {',
  '        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), what);',
  '    }',
  '',
  '    public static void Send(string printerName, byte[] bytes)',
  '    {',
  '        IntPtr hPrinter;',
  '        if (!OpenPrinterW(printerName, out hPrinter, IntPtr.Zero))',
  '            Fail("Could not open printer \'" + printerName + "\'");',
  '        try',
  '        {',
  '            DOCINFOW di = new DOCINFOW();',
  '            di.pDocName = "POS cash drawer";',
  '            di.pDataType = "RAW";',
  '            if (!StartDocPrinterW(hPrinter, 1, di)) Fail("StartDocPrinter failed");',
  '            try',
  '            {',
  '                if (!StartPagePrinter(hPrinter)) Fail("StartPagePrinter failed");',
  '                IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);',
  '                try',
  '                {',
  '                    Marshal.Copy(bytes, 0, buf, bytes.Length);',
  '                    int written;',
  '                    if (!WritePrinter(hPrinter, buf, bytes.Length, out written))',
  '                        Fail("WritePrinter failed");',
  '                }',
  '                finally { Marshal.FreeCoTaskMem(buf); }',
  '                EndPagePrinter(hPrinter);',
  '            }',
  '            finally { EndDocPrinter(hPrinter); }',
  '        }',
  '        finally { ClosePrinter(hPrinter); }',
  '    }',
  '}',
  "'@",
  '',
  '[PosRawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($DataPath))',
  "Write-Output 'OK'",
  '',
].join('\r\n');

async function sendRawToPrinter(
  printerName: string,
  bytes: Buffer
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Opening a cash drawer is only supported on Windows.');
  }
  if (!printerName.trim()) {
    // The kick has to name a printer. Unlike a receipt there is no "system
    // default" to fall back on that we could verify — a job sent to the wrong
    // device is silently swallowed and looks like broken hardware.
    throw new Error(
      'No receipt printer is selected, so there is nothing to send the drawer signal to. Choose the printer first.'
    );
  }

  // Both names are unique per call. A fixed path in a world-writable temp
  // directory is a script another local process can replace between our write
  // and PowerShell's read — and we then run it. Date.now() is not enough
  // either: two tills' worth of clicks inside the same millisecond collide.
  const dir = os.tmpdir();
  const token = crypto.randomUUID();
  const scriptPath = path.join(dir, `pos-drawer-kick-${token}.ps1`);
  const dataPath = path.join(dir, `pos-drawer-${token}.bin`);

  await fs.writeFile(scriptPath, PS_SCRIPT, 'utf8');
  await fs.writeFile(dataPath, bytes);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-PrinterName',
          printerName,
          '-DataPath',
          dataPath,
        ],
        // A drawer kick is five bytes. If the spooler has not taken them in ten
        // seconds it is wedged, and the cashier must not be left waiting.
        { timeout: 10_000, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            const detail = String(stderr || stdout || err.message)
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)[0];
            reject(new Error(detail || 'The drawer signal could not be sent.'));
            return;
          }
          resolve();
        }
      );
    });
  } finally {
    // Best effort, and both files: a per-call script name that is never
    // removed would fill the temp directory one file per sale.
    await Promise.all([
      fs.unlink(dataPath).catch(() => {}),
      fs.unlink(scriptPath).catch(() => {}),
    ]);
  }
}

/**
 * Opens the drawer and reports why it could not. For the Settings test button
 * and any explicit "open drawer" action, where silence would be the bug.
 */
export async function openCashDrawer(
  printerName: string,
  pin?: DrawerPin
): Promise<void> {
  const cfg = getDrawerConfig();
  await sendRawToPrinter(printerName, buildKickCommand(pin ?? cfg.pin));
}

/**
 * The variant the receipt path uses. It can fail, and when it does the sale is
 * already rung up and the receipt already printed — so a drawer that does not
 * open must never turn a completed sale into an error on screen. It logs and
 * returns false.
 */
export async function tryOpenCashDrawer(
  printerName: string,
  opts?: { paymentSlug?: string | null }
): Promise<boolean> {
  const cfg = getDrawerConfig();
  if (!cfg.enabled) return false;
  if (cfg.cashOnly && !isCashPayment(opts?.paymentSlug)) {
    console.log('[drawer] skipped: not a cash payment', {
      slug: opts?.paymentSlug ?? null,
    });
    return false;
  }
  try {
    await sendRawToPrinter(printerName, buildKickCommand(cfg.pin));
    console.log('[drawer] kick sent', { printerName, pin: cfg.pin });
    return true;
  } catch (e) {
    console.warn('[drawer] kick failed:', (e as Error)?.message);
    return false;
  }
}

/**
 * `resolvePrinterName` is passed in rather than imported so this module never
 * has to reach back into print.ts — print.ts imports this one, and a cycle
 * between them would be resolved differently in the dev and packaged builds.
 */
export function registerCashDrawerHandlers(
  resolvePrinterName: () => string,
  services?: MainServices
) {
  console.log('[drawer] registering IPC handlers');

  ipcMain.handle('drawer:getConfig', async () => {
    return { ...getDrawerConfig(), printerName: resolvePrinterName() };
  });

  ipcMain.handle(
    'drawer:setConfig',
    async (
      _e,
      payload?: { enabled?: boolean; pin?: number; cashOnly?: boolean }
    ) => {
      if (services) assertPermission(services, 'settings.manage');
      if (payload && 'enabled' in payload) {
        setMeta('drawer.enabled', payload.enabled ? '1' : '0');
      }
      if (payload && 'pin' in payload) {
        setMeta('drawer.pin', Number(payload.pin) === 1 ? '1' : '0');
      }
      if (payload && 'cashOnly' in payload) {
        setMeta('drawer.cash_only', payload.cashOnly ? '1' : '0');
      }
      return getDrawerConfig();
    }
  );

  /**
   * Opening the till by hand is a cash-handling action — making change,
   * correcting a miscount — so it sits behind the same permission as the
   * drawer settings rather than being available to any logged-in cashier.
   */
  ipcMain.handle('drawer:open', async () => {
    if (services) assertPermission(services, 'settings.manage');
    await openCashDrawer(resolvePrinterName());
    return { ok: true };
  });
}
