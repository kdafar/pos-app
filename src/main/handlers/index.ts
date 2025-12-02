// src/main/handlers/index.ts
import type { IpcMain } from 'electron';
import type { MainServices } from '../types/common';

import { registerStoreHandlers } from './store';
import { registerSettingsHandlers } from './settings';
import { registerOrdersHandlers } from './orders';
import { registerCartHandlers } from './cart';
import { registerCatalogHandlers } from './catalog';
import { registerGeoHandlers } from './geo';
import { registerTableHandlers } from './tables';
import { registerPaymentHandlers } from './payments';
import { registerSyncHandlers } from './sync';
import { registerDevHandlers } from './dev';
import { registerAuthHandlers } from './auth';
import { registerOperationalReportHandlers } from './reports_operational';

export function registerAllHandlers(
  ipcMain: IpcMain,
  services: MainServices
): void {
  registerStoreHandlers(ipcMain);
  registerSettingsHandlers(ipcMain);
  registerOrdersHandlers(ipcMain, services);
  registerCartHandlers(ipcMain);
  registerCatalogHandlers(ipcMain);
  registerGeoHandlers(ipcMain);
  registerTableHandlers(ipcMain);
  registerPaymentHandlers(ipcMain);
  registerSyncHandlers(ipcMain, services);
  registerAuthHandlers(ipcMain, services);
  registerOperationalReportHandlers();

  if (process.env.NODE_ENV !== 'production') {
    registerDevHandlers(ipcMain, services);
  }
}
