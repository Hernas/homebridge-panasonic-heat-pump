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

  private lastDetails: {
    temperatureNow: number;
      heatingCoolingState: number;
      targetHeatingCoolingState: number;
      outdoorTemperatureNow: number;
      tankTemperatureNow: number;
      tankTemperatureSet: number;
      tankHeatingCoolingState: number;
      tankTargetHeatingCoolingState: number;
      isActive: boolean;
      ecoModeIsActive: boolean;
      comfortModeIsActive: boolean;
      tankTemperatureMax: number;
      tankTemperatureMin: number;
  };

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
      || this.accessory.addService(this.platform.Service.Thermostat, 'Floors', 'floors');

    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Floors');
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    }).onGet(() => this.lastDetails.temperatureNow);

    // Water
    this.tankService = this.accessory.getService('Water')
      || this.accessory.addService(this.platform.Service.Thermostat, 'Water', 'water');
    this.tankService.setCharacteristic(this.platform.Characteristic.Name, 'Water');
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).onSet(async (temp: unknown) => {
      panasonicApi.setTankTargetHeat(this.accessory.context.device.uniqueId, temp as number);
      this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).
        updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
    }).onGet(async () => {
      return this.lastDetails.tankTemperatureSet;
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    }).onGet(async () => {
      return this.lastDetails.tankTemperatureNow;
    });



    // Outdoor temperature
    this.outdoorTemperatureService = this.accessory.getService('Outdoor') ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor', 'outdoor');
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
      return this.lastDetails.outdoorTemperatureNow;
    });
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).onGet(async () => {
      return true;
    });


    // Eco Mode
    this.ecoModeService = this.accessory.getService('Eco Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Eco Mode', 'eco-mode');
    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
      if(value) {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Eco);
        this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      } else {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      }
    }).onGet(async () => {
      return this.lastDetails.ecoModeIsActive;
    });


    // Comfort Mode
    this.comfortModeService = this.accessory.getService('Comfort Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Comfort Mode', 'comfort-mode');
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
      if(value) {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Comfort);
        this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      } else {
        panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      }
    }).onGet(async () => {
      return this.lastDetails.comfortModeIsActive;
    });
  }

  async getReadings() {
    const details = await this.panasonicApi.loadDeviceDetails(this.accessory.context.device.uniqueId);

    const operationalZone = details.zoneStatus.find(z => z.temparatureNow !== null);
    const temperatureNow = operationalZone?.temparatureNow;

    const isActive = details.operationStatus === 1;
    const direction = details.direction;

    // What is currently on
    const isHeatingOn = direction === 1;
    const isTankOn = direction === 2;

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const operationMode = details.operationMode;
    const heatingCoolingState = (() => {
      if(!isHeatingOn) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      }
      if(operationMode === 1) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      }
      if(operationMode === 2) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      }
      if(operationMode === 3) {
        // AUTO
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      }
      if(operationMode === 4) {
        // AUTO
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      }
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    })();
    const targetHeatingCoolingState = (() => {
      if(details.operationStatus === 0) {
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      }
      switch (operationMode) {
        case 1:
          return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        case 2:
          return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
        case 3:
        case 4:
          return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
      }
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    })();
    const ecoModeIsActive = details.specialStatus.find(s => s.specialMode === 1).operationStatus === 1;
    const comfortModeIsActive = details.specialStatus.find(s => s.specialMode === 2).operationStatus === 1;
    const outdoorTemperatureNow = details.outdoorNow;
    const tankTemperatureNow = details.tankStatus[0].temparatureNow;
    const tankTemperatureSet = details.tankStatus[0].heatSet;
    const tankIsActive = details.tankStatus[0].operationStatus === 1;
    const tankHeatingCoolingState = (() => {
      if (!isTankOn) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      }
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    })();
    const tankTargetHeatingCoolingState = (() => {
      if (!tankIsActive) {
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      }
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    })();


    const d = {
      temperatureNow,
      heatingCoolingState,
      targetHeatingCoolingState,
      outdoorTemperatureNow,
      tankTemperatureNow,
      tankTemperatureSet,
      tankHeatingCoolingState,
      tankTargetHeatingCoolingState,
      isActive,
      ecoModeIsActive,
      comfortModeIsActive,
      tankTemperatureMax: details.tankStatus[0].heatMax,
      tankTemperatureMin: details.tankStatus[0].heatMin,
    };
    this.lastDetails = d;
    return d;
  }

  async updateReadings() {
    const {
      outdoorTemperatureNow, temperatureNow, tankTemperatureNow, tankTemperatureSet, tankHeatingCoolingState, isActive, ecoModeIsActive,
      comfortModeIsActive, tankTemperatureMax, tankTemperatureMin, tankTargetHeatingCoolingState, heatingCoolingState,
      targetHeatingCoolingState,
    } = await this.getReadings();


    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(isActive);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(heatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);

    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(outdoorTemperatureNow);
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).updateValue(true);

    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
      minValue: tankTemperatureMin,
      maxValue: tankTemperatureMax,
      minStep: 1,
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(tankTemperatureNow);
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(tankTemperatureSet);
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(tankHeatingCoolingState);
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(tankTargetHeatingCoolingState);

    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(ecoModeIsActive);
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(comfortModeIsActive);
    setTimeout(() => {
      this.updateReadings();
    }, 1000);
  }


}
