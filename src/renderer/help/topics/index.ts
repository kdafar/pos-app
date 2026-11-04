// Topic order on the guide home page. "trouble" is listed last here but the
// home page also shows it near the top.
import type { HelpTopicDef } from '../types';
import { start } from './start';
import { order } from './order';
import { tables } from './tables';
import { pay } from './pay';
import { change } from './change';
import { orders } from './orders';
import { kitchen } from './kitchen';
import { printing } from './printing';
import { offline } from './offline';
import { closing } from './closing';
import { manager } from './manager';
import { trouble } from './trouble';

export const TOPICS: HelpTopicDef[] = [
  start,
  order,
  tables,
  pay,
  change,
  orders,
  kitchen,
  printing,
  offline,
  closing,
  manager,
  trouble,
];
