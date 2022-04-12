import { Service, PlatformAccessory, CharacteristicValue, Characteristic } from 'homebridge';
import { PanasonicApi } from './panasonicApi';

import { PanasonicHeatPumpHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class PanasonicHeatPumpPlatformAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private exampleStates = {
    On: false,
    Brightness: 100,
  };

  constructor(
    private readonly platform: PanasonicHeatPumpHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly panasonicApi: PanasonicApi,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: -100,
      maxValue: 100,
      minStep: 0.01,
    }).onGet(this.getTemperature.bind(this));

    // /**
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).onGet(this.getHeatingCoolingState.bind(this));

    // /**
    //  * Creating multiple services of the same type.
    //  *
    //  * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    //  * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    //  * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
    //  *
    //  * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
    //  * can use the same sub type id.)
    //  */

    // // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    // /**
    //  * Updating characteristics values asynchronously.
    //  *
    //  * Example showing how to update the state of a Characteristic asynchronously instead
    //  * of using the `on('get')` handlers.
    //  * Here we change update the motion sensor trigger states on and off every 10 seconds
    //  * the `updateCharacteristic` method.
    //  *
    //  */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;

    //   // push the new value to HomeKit
    //   motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
    //   motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

    //   this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 10000);
  }

  async getTemperature(): Promise<CharacteristicValue> {
    const details = await this.panasonicApi.loadDeviceDetails(this.accessory.context.device.uniqueId);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const operationalZone = details.zoneStatus.find(z => z.operationStatus === 1);
    console.log('operationalZone', operationalZone);
    const temp = operationalZone?.temparatureNow;
    console.log('temp', temp);
    if(temp === undefined) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return temp;
  }

  async getHeatingCoolingState(): Promise<CharacteristicValue> {
    const details = await this.panasonicApi.loadDeviceDetails(this.accessory.context.device.uniqueId);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const operationStatus = details.operationStatus;
    switch(operationStatus) {
      case 1:
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      case 2:
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      case 4:
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      default:
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }


}
