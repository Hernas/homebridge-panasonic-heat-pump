import { PlatformAccessory, UnknownContext } from 'homebridge';
import { PanasonicApi } from '../api/panasonicApi';
import { PanasonicHeatPumpHomebridgePlatform } from '../platform';
import { DeviceDetails } from '../types';

export class Accessory<T extends UnknownContext> {
  protected lastDeviceDetails: DeviceDetails | undefined;
  constructor(
    public readonly platform: PanasonicHeatPumpHomebridgePlatform,
    public readonly accessory: PlatformAccessory<T>,
    public readonly panasonicApi: PanasonicApi,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.panasonicApi = panasonicApi;
  }

  onUpdateDetails(details: DeviceDetails) {
    this.lastDeviceDetails = details;
  }

}