// src/main/handlers/index.ts
import { app, type IpcMain } from 'electron';
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
import { registerCustomerHandlers } from './customers';
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
  registerCustomerHandlers(ipcMain);
  registerOperationalReportHandlers(services);

  // NODE_ENV is not substituted into the packaged main bundle, so the old
  // `!== 'production'` test was always true there. registerDevHandlers has its
  // own positive dev check, but gate it honestly anyway.
  if (!app.isPackaged) {
    registerDevHandlers(ipcMain, services);
  }
}
