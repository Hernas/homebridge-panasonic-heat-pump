import { Service, PlatformAccessory } from 'homebridge';
import { PanasonicApi } from '../api/panasonicApi';

import { PanasonicHeatPumpHomebridgePlatform } from '../platform';
import { DeviceContext, DeviceDetails } from '../types';
import { Accessory } from './accessory';

export class ThermometerAccessory extends Accessory<DeviceContext> {
  private service?: Service;

  constructor(
    platform: PanasonicHeatPumpHomebridgePlatform,
    accessory: PlatformAccessory<DeviceContext>,
    panasonicApi: PanasonicApi,
  ) {
    super(platform, accessory, panasonicApi);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
      .setCharacteristic(this.platform.Characteristic.Model, 'Aquarea')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID);

    if(this.platform.config.enableOutdoorTempSensor) {
      this.service = this.accessory.getService('Outdoor') ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor', 'outdoor');

      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(() => this.lastDeviceDetails?.outdoorTemperatureNow ?? 0);
    } else {
      const existingTempSensor = this.accessory.getService('Outdoor');
      if(existingTempSensor) {
        this.accessory.removeService(existingTempSensor);
      }
    }
  }


  async onUpdateDetails(readings: DeviceDetails) {
    super.onUpdateDetails(readings);
    const {
      outdoorTemperatureNow,
    } = readings;
    this.platform.log.debug(`Updating outdoor temp: ${outdoorTemperatureNow}`);
    this.service?.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(outdoorTemperatureNow);
    this.service?.getCharacteristic(this.platform.Characteristic.StatusActive).updateValue(true);

  }

}
