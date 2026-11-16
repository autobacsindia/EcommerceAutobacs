import { parsePinDirectory, splitCsvLine } from '../../../utils/pinLocationCsv.js';

const HEADER = 'circlename,regionname,divisionname,officename,pincode,officetype,delivery,district,statename,latitude,longitude';

it('splits quoted CSV fields', () => {
  expect(splitCsvLine('a,"b, c","d ""q"""')).toEqual(['a', 'b, c', 'd "q"']);
});

it('one row per PIN: median of valid coordinates, district/state of a delivery office', () => {
  const csv = [
    HEADER,
    'X,X,X,Jalpaiguri H.O,735101,H.O,Delivery,JALPAIGURI,WEST BENGAL,26.52,88.72',
    'X,X,X,Branch A,735101,B.O,Non-Delivery,OTHER,WEST BENGAL,26.54,88.74',
    'X,X,X,Branch B,735101,B.O,Delivery,JALPAIGURI,WEST BENGAL,NA,NA',
    'X,X,X,Bad far,735101,B.O,Delivery,JALPAIGURI,WEST BENGAL,99,99',
    'X,X,X,Swapped,500001,H.O,Delivery,HYDERABAD,TELANGANA,78.48,17.38',
    'X,X,X,No coords,999999,H.O,Delivery,X,Y,NA,NA',
    'X,X,X,Bad pin,12,H.O,Delivery,X,Y,20,80',
  ].join('\n');
  const { rows, stats } = parsePinDirectory(csv);
  expect(stats).toMatchObject({ badPinLines: 1, pins: 3, located: 2, noCoords: 1 });
  const jal = rows.find((r) => r.pin === '735101');
  expect(jal).toEqual({ pin: '735101', lat: 26.53, lng: 88.73, district: 'Jalpaiguri', state: 'West Bengal' });
  expect(rows.find((r) => r.pin === '500001')).toMatchObject({ lat: 17.38, lng: 78.48, district: 'Hyderabad', state: 'Telangana' });
});

it('refuses a file without the needed columns', () => {
  expect(() => parsePinDirectory('a,b\n1,2')).toThrow(/pincode, latitude and longitude/);
});
