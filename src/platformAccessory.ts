import { Service, PlatformAccessory } from 'homebridge';
import { PanasonicApi, PanasonicSpecialStatus } from './panasonicApi';

import { PanasonicHeatPumpHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class PanasonicHeatPumpPlatformAccessory {
  private service: Service;
  private outdoorTemperatureService: Service;
  private tankService: Service;
  private ecoModeService: Service;
  private comfortModeService: Service;

  constructor(
    private readonly platform: PanasonicHeatPumpHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly panasonicApi: PanasonicApi,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
      .setCharacteristic(this.platform.Characteristic.Model, 'Aquarea')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'n/a');

    // FLOOR
    this.service = this.accessory.getService('Floors')
      || this.accessory.addService(this.platform.Service.HeaterCooler, 'Floors', 'floors');

    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Floors');
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
      const { temperatureNow } = await this.getReadings();
      return temperatureNow;
    }).setProps({
      minValue: 17,
      maxValue: 38,
      minStep: 1,
    });
    this.service.getCharacteristic(this.platform.Characteristic.Active).onGet(async () => {
      const { isActive } = await this.getReadings();
      return isActive;
    });
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).onGet(async () => {
      const { heatingCoolingState } = await this.getReadings();
      return heatingCoolingState;
    });
    // this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature).onGet(async () => {
    //   const { heatingCoolingState } = await this.getReadings();
    //   return heatingCoolingState;
    // });

    // Water
    this.tankService = this.accessory.getService('Water')
      || this.accessory.addService(this.platform.Service.Thermostat, 'Water', 'water');
    this.tankService.setCharacteristic(this.platform.Characteristic.Name, 'Water');
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
      const { tankTemperatureNow } = await this.getReadings();
      return tankTemperatureNow;
    }).setProps({
      minValue: 35,
      maxValue: 55,
      minStep: 1,
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).onGet(async () => {
      const { tankTemperatureSet } = await this.getReadings();
      return tankTemperatureSet;
    }).onSet(async (temp: unknown) => {
      panasonicApi.setTankTargetHeat(this.accessory.context.device.uniqueId, temp as number);
      this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).
        updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
    }).setProps({
      minValue: 35,
      maxValue: 55,
      minStep: 1,
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).onGet(async () => {
      const { tankHeatingCoolingState } = await this.getReadings();
      return tankHeatingCoolingState;
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).onGet(async () => {
      return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    });


    // Outdoor temperature
    this.outdoorTemperatureService = this.accessory.getService('Outdoor') ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor', 'outdoor');
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
      const { outdoorTemperatureNow } = await this.getReadings();
      return outdoorTemperatureNow;
    });
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).onGet(async () => {
      return true;
    });


    // Eco Mode
    this.ecoModeService = this.accessory.getService('Eco Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Eco Mode', 'eco-mode');
    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).onGet(async () => {
      const { ecoModeIsActive } = await this.getReadings();
      return ecoModeIsActive;
    });
    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
      if(value) {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Eco);
        this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      } else {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      }
    });


    // Comfort Mode
    this.comfortModeService = this.accessory.getService('Comfort Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Comfort Mode', 'comfort-mode');
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).onGet(async () => {
      const { comfortModeIsActive } = await this.getReadings();
      return comfortModeIsActive;
    });
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
      if(value) {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Comfort);
        this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      } else {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      }
    });
  }

  async getReadings() {
    const details = await this.panasonicApi.loadDeviceDetails(this.accessory.context.device.uniqueId);

    const operationalZone = details.zoneStatus.find(z => z.operationStatus === 1);
    const temperatureNow = operationalZone?.temparatureNow;

    const isActive = details.operationStatus === 1;


    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const operationMode = details.operationMode;
    const heatingCoolingState = (() => {
      switch (operationMode) {
        case 1:
          return this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        case 2:
          return this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        case 4:
          return this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        case 0:
        default:
          return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
      }
    })();
    const ecoModeIsActive = details.specialStatus.find(s => s.specialMode === 1).operationStatus === 1;
    const comfortModeIsActive = details.specialStatus.find(s => s.specialMode === 2).operationStatus === 1;
    const outdoorTemperatureNow = details.outdoorNow;
    const tankTemperatureNow = details.tankStatus[0].temparatureNow;
    const tankTemperatureSet = details.tankStatus[0].heatSet;
    const tankHeatingCoolingState = (() => {
      if (tankTemperatureNow >= tankTemperatureSet) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      }
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    })();


    return {
      temperatureNow,
      heatingCoolingState,
      outdoorTemperatureNow,
      tankTemperatureNow,
      tankTemperatureSet,
      tankHeatingCoolingState,
      isActive,
      ecoModeIsActive,
      comfortModeIsActive,
    };
  }

  async updateReadings() {
    const {
      outdoorTemperatureNow, temperatureNow, tankTemperatureNow, tankTemperatureSet, tankHeatingCoolingState, isActive, ecoModeIsActive,
      comfortModeIsActive,
    } = await this.getReadings();
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(isActive);
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(outdoorTemperatureNow);
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).updateValue(true);
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(tankTemperatureNow);
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(tankTemperatureSet);
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(tankHeatingCoolingState);
    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(ecoModeIsActive);
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(comfortModeIsActive);
    setTimeout(() => {
      this.updateReadings();
    }, 1000);
  }


}
