import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromCpsc } from '../src/sources/cpsc.ts';
import { fromFda } from '../src/sources/fda.ts';
import { fromNhtsa, sayPart } from '../src/sources/nhtsa.ts';

test('CPSC: a real record is reduced to the fields we use', () => {
  const r = fromCpsc({
    RecallID: 10992, RecallNumber: '26789', RecallDate: '2026-09-24T00:00:00', Title: '5Color Recalls Children’s Bicycle Helmet and Pads Sets Due to Risk of Serious Injury or Death from Head Injury',
    Description: '“Model No.: YD-001,” “Lot/Ref: YD-260320” are printed on a label on the inside of the helmet.', URL: 'https://cpsc.gov/Recalls/2026/5Color',
    ConsumerContact: '5Color toll free at 833-382-6461', Products: [{ Name: '5Color Children’s Bike Helmet and Pads Sets', Model: '', Type: 'Helmets & Helmet Accessories' }],
    Retailers: [{ Name: 'Amazon.com' }], Hazards: [{ Name: 'The helmets can fail to protect the user in the event of a crash, posing a serious risk of injury or death.' }],
    Remedies: [{ Name: 'Consumers should stop using the helmets immediately and contact 5Color for a full refund.' }], RemedyOptions: [{ Option: 'Refund' }],
  })!;
  assert.equal(r.id, 'cpsc:26789');
  assert.equal(r.date, '2026-09-24');
  assert.equal(r.kind, 'product');
  assert.ok(r.models.includes('YD001'));
  assert.deepEqual(r.remedyOptions, ['Refund']);
  assert.equal(r.urgent, true);
});

test('CPSC: a remedy that only repeats the hazard is dropped', () => {
  const r = fromCpsc({ RecallID: 2, RecallNumber: '21128', RecallDate: '2021-05-05T00:00:00', Title: 'Peloton Recalls Tread+ Treadmills', Hazards: [{ Name: 'Children can be pulled underneath the treadmill.' }], Remedies: [{ Name: 'Children can be pulled underneath the treadmill.' }], RemedyOptions: [{ Option: 'Refund' }] })!;
  assert.equal(r.remedy, '');
  assert.deepEqual(r.remedyOptions, ['Refund']);
});

test('CPSC: a record without a number or date is dropped', () => {
  assert.equal(fromCpsc({ RecallID: 1, RecallNumber: '', RecallDate: null }), null);
});

test('FDA: dates are converted and Class I is urgent', () => {
  const r = fromFda({ recall_number: 'H-1331-2026', classification: 'Class I', recalling_firm: 'EURO FOODS GROUP', product_description: 'Crown Farms Dried Suri Cut, 200 gm', reason_for_recall: 'Not properly eviscerated.', recall_initiation_date: '20260801' }, 'food')!;
  assert.equal(r.date, '2026-08-01');
  assert.equal(r.urgent, true);
  assert.equal(r.kind, 'food');
});

test('FDA: medicine guidance never says to stop taking it', () => {
  const r = fromFda({ recall_number: 'D-1', classification: 'Class II', recalling_firm: 'Pharma', product_description: 'Tablets', recall_initiation_date: '20260101' }, 'medicine')!;
  assert.match(r.remedy, /Do not stop a prescribed medicine/);
  assert.equal(r.urgent, false);
});

test('NHTSA: day-first dates are converted and park-outside is urgent', () => {
  const r = fromNhtsa({ NHTSACampaignNumber: '21V215000', ReportReceivedDate: '25/03/2021', Component: 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP', Summary: 'The fuel pump may fail.', Consequence: 'Engine stall.', Remedy: 'Dealers will replace the pump.', ModelYear: '2020', Make: 'HONDA', Model: 'CIVIC', parkOutSide: true })!;
  assert.equal(r.date, '2021-03-25');
  assert.equal(r.title, '2020 Honda Civic recall: Fuel System, Gasoline');
  assert.equal(r.urgent, true);
});

test('NHTSA: the hazard leaves out the list of models and keeps the defect and its consequence', () => {
  const r = fromNhtsa({ NHTSACampaignNumber: '21V215000', ReportReceivedDate: '25/03/2021', Component: 'FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP', Summary: 'Honda (American Honda Motor Co.) is recalling certain 2019-2020 Acura MDX, RDX, TLX, Honda Accord and Civic vehicles.  The low-pressure fuel pump inside the fuel tank may fail.', Consequence: 'Fuel pump failure can cause an engine stall while driving.', ModelYear: '2020', Make: 'HONDA', Model: 'CIVIC' })!;
  assert.equal(r.hazard, 'The low-pressure fuel pump inside the fuel tank may fail. Fuel pump failure can cause an engine stall while driving.');
  assert.equal(r.part, 'fuel system');
});

test('NHTSA: parts are said in plain words', () => {
  assert.equal(sayPart('AIR BAGS'), 'air bags');
  assert.equal(sayPart('SERVICE BRAKES, HYDRAULIC'), 'service brakes');
  assert.equal(sayPart('ELECTRICAL SYSTEM:SOFTWARE'), 'electrical system');
  assert.equal(sayPart(''), 'vehicle');
});
