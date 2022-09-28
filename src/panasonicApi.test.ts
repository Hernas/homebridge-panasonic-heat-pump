import { PanasonicApi } from './panasonicApi';

describe('PanasonicApi', () => {
  let panasonicApi: PanasonicApi;
  beforeEach(() => {
    panasonicApi = new PanasonicApi(process.env.PANASONIC_LOGIN ?? '', process.env.PANASONIC_PASSWORD ?? '');
  });
  it('should return devices', async () => {
    const device = await panasonicApi.loadDevice();
    expect(device).toEqual( {
      'selectedDeviceId': expect.anything(),
      'selectedDeviceName': 'HeatPump',
      'deviceConf': {
        'deviceGuid': expect.anything(),
        'configration': [
          {
            'zoneInfo': [
              {
                'zoneSensor': 'Water temperature',
                'coolMode': 'enable',
                'heatSensor': 'Compensation curve',
                'coolSensor': 'Compensation curve',
                'outdoorType': 'STD',
                'zoneId': 1,
                'zoneType': 'Room',
                'zoneName': 'Home',
              },
            ],
            'a2wName': 'HeatPump',
            'operationMode': 'Heat',
            'deviceGuid': expect.anything(),
            'lastErrorNumber': '',
            'bivalent': 'No',
            'specialStatus': 0,
            'tankInfo': [
              {
                'tankType': 'Internal',
                'tank': 'Yes',
              },
            ],
            'firmVersion': '040102',
          },
        ],
      },
    });

    const deviceDetails = await panasonicApi.loadDeviceDetails(device.selectedDeviceId);
    expect(deviceDetails.deviceGuid).toEqual(device.selectedDeviceId);
  }, 30000);
});