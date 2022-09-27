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
    });

    const deviceDetails = await panasonicApi.loadDeviceDetails(device.selectedDeviceId);
    // console.log(JSON.stringify(deviceDetails, undefined, 4));
    expect(deviceDetails.deviceGuid).toEqual(device.selectedDeviceId);
  });
});