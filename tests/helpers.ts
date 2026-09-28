import type { Recall } from '../src/types.ts';
import { RecallIndex } from '../src/match.ts';
import { RecallCheck, type VehicleLookup } from '../src/service.ts';
import { MemoryStore } from '../src/store.ts';

export function recall(over: Partial<Recall> & Pick<Recall, 'id'>): Recall {
  return {
    source: 'CPSC', kind: 'product', date: '2023-02-23', title: 'Acme Recalls Air Fryers Due to Fire Hazard', brandText: 'Acme Recalls Air Fryers Acme Inc.',
    productText: 'Acme air fryer Air Fryers', models: ['AF100', 'AF200'], hazard: 'A wire connection can overheat. This is a fire hazard.',
    remedy: 'Stop using the air fryer and contact Acme for a free replacement. Do not return it to the store.', remedyOptions: ['Replace'],
    contact: 'Acme at 800-555-0100', url: 'https://www.cpsc.gov/Recalls/2023/acme', urgent: true, ...over,
  };
}

export const RECALLS: Recall[] = [
  recall({ id: 'cpsc:1' }),
  recall({ id: 'cpsc:2', title: 'Acme Recalls Strollers Due to Fall Hazard', brandText: 'Acme Recalls Strollers', productText: 'Acme stroller Strollers', models: [], hazard: 'The front wheel can detach. A child can fall.', urgent: false, date: '2024-05-01', remedyOptions: ['Repair'] }),
  recall({ id: 'cpsc:3', title: 'Zenith Recalls Space Heaters Due to Fire Hazard', brandText: 'Zenith Recalls Space Heaters', productText: 'Zenith space heater. Sold with an Acme power cord.', models: ['ZH9'], date: '2022-01-10' }),
  recall({ id: 'fda:F-1', source: 'FDA', kind: 'food', title: 'Good Farms recalls Good Farms Organic Spinach 10 oz', brandText: 'Good Farms Inc Good Farms Organic Spinach 10 oz', productText: 'Good Farms Organic Spinach 10 oz bag', models: [], hazard: 'Possible Listeria contamination.', remedy: 'Do not eat it.', remedyOptions: [], date: '2026-08-01' }),
];

export const CIVIC_RECALL = recall({ id: 'nhtsa:21V215000', source: 'NHTSA', kind: 'vehicle', title: '2020 Honda Civic recall: Fuel System, Gasoline', brandText: 'HONDA', productText: 'CIVIC FUEL SYSTEM', models: [], hazard: 'The fuel pump may fail. The engine can stall while driving.', remedy: 'Dealers will replace the fuel pump, free of charge.', remedyOptions: ['Repair'], urgent: false, date: '2021-03-25' });

export function app(opts: { vehicle?: VehicleLookup; now?: () => Date; recalls?: Recall[] } = {}) {
  const index = new RecallIndex(opts.recalls ?? RECALLS);
  const store = new MemoryStore();
  const service = new RecallCheck(index, store, opts.vehicle ?? (async () => [CIVIC_RECALL]), opts.now);
  return { index, store, service };
}
