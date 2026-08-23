// src/shared/errorCodes.ts
//
// How main-process code raises a catalogued failure.
//
//   throw posError('POS_VAL_TABLE_REQUIRED', { field: 'table' });
//   throw posError('POS_VAL_ITEM_NO_PRICE', { params: { name: item.name } });
//
// The code is the contract; the English sentence is only a fallback for a
// renderer that does not know the code yet. Adding a code means adding it to
// errorCatalog.ts first — there is nowhere else to put one.

import { AppError, type ErrorParams } from './errors';
import { ERROR_CATALOG, interpolate, type PosErrorCode } from './errorCatalog';

export type { PosErrorCode };
export { ERROR_CATALOG, interpolate };

export function posError(
  code: PosErrorCode,
  opts: { params?: ErrorParams; field?: string; cause?: unknown } = {}
): AppError {
  return new AppError(
    code,
    interpolate(ERROR_CATALOG[code].en.body, opts.params),
    opts
  );
}
