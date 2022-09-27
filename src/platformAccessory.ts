/* eslint-disable no-console */
import { Service, PlatformAccessory } from 'homebridge';
import { PanasonicApi, PanasonicSpecialStatus, PanasonicTargetOperationMode } from './panasonicApi';

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

  private lastDetails: Promise<{
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
      targetTempSet: number;
      targetTempMin: number;
      targetTempMax: number;
      tempType: 'heat' | 'cool' | 'eco' | 'comfort';
  }> | undefined;

  private timeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly platform: PanasonicHeatPumpHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly panasonicApi: PanasonicApi,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panasonic')
      .setCharacteristic(this.platform.Characteristic.Model, 'Aquarea')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.UUID);

    // FLOOR
    this.service = this.accessory.getService('Floor Heating')
      || this.accessory.addService(this.platform.Service.Thermostat, 'Floor Heating', 'floorheating');

    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Floor Heating');
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    }).onGet(async () => (await this.getReadings()).temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(async (state: unknown) => {
        const operationMode = (() => {
          switch(state) {
            case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
              return PanasonicTargetOperationMode.Cooling;
            case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
              return PanasonicTargetOperationMode.Heating;
            case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
              return PanasonicTargetOperationMode.Auto;
            default:
            case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
              return PanasonicTargetOperationMode.Off;
          }
        })();
        this.panasonicApi.setOperationMode(this.accessory.context.device.uniqueId, operationMode);
        await this.getReadings(true);
      }).onGet(async () => (await this.getReadings()).targetHeatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(async (temp: unknown) => {
        const readings = await this.getReadings();
        const adjustedTemp = (parseInt(temp as string)) - readings.temperatureNow;
        // eslint-disable-next-line no-console
        console.log(`Setting Floor Heating temp[${readings.tempType}] to: ${adjustedTemp}`);
        this.panasonicApi.setZoneTemp(this.accessory.context.device.uniqueId,
          adjustedTemp, readings.tempType);
        await this.getReadings(true);
      }).onGet(async () => {
        console.log('Floor Heating get temp');
        const readings = await this.getReadings();
        return readings.targetTempSet + readings.temperatureNow;
      });

    // Water
    this.tankService = this.accessory.getService('Water')
      || this.accessory.addService(this.platform.Service.Thermostat, 'Water', 'water');
    this.tankService.setCharacteristic(this.platform.Characteristic.Name, 'Water');
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).onSet(async (temp: unknown) => {
      panasonicApi.setTankTargetHeat(this.accessory.context.device.uniqueId, temp as number);
      await this.getReadings(true);
    }).onGet(async () => {
      return (await this.getReadings()).tankTemperatureSet;
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).onSet(async (state: unknown) => {
      if(state === this.platform.Characteristic.TargetHeatingCoolingState.OFF ||
        state === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        // turn off water heating
        this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
          .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
        this.panasonicApi.setTankStatus(this.accessory.context.device.uniqueId, false);
        await this.getReadings(true);
        return;
      }
      // turn on water heating
      this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
      this.panasonicApi.setTankStatus(this.accessory.context.device.uniqueId, true);
      await this.getReadings(true);
    }).onGet(async () => {
      return (await this.getReadings()).tankTargetHeatingCoolingState;
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    }).onGet(async () => {
      return (await this.getReadings()).tankTemperatureNow;
    });



    // Outdoor temperature
    this.outdoorTemperatureService = this.accessory.getService('Outdoor') ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor', 'outdoor');
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
      return (await this.getReadings()).outdoorTemperatureNow;
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
      await this.getReadings(true);
    }).onGet(async () => {
      return (await this.getReadings()).ecoModeIsActive;
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
      await this.getReadings(true);
    }).onGet(async () => {
      return (await this.getReadings()).comfortModeIsActive;
    });
  }

  async getReadings(force = false) {
    if(force) {
      this.lastDetails = undefined;
    }
    const loadReadings = async () => {
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


      const tempType: 'heat' | 'cool' | 'eco' | 'comfort' = (() => {
        if(ecoModeIsActive) {
          return 'eco';
        }
        if(comfortModeIsActive) {
          return 'comfort';
        }
        if(operationMode === 1 || operationMode === 3) {

          return 'heat';
        }
        if(operationMode === 2 || operationMode === 4) {
          return 'cool';
        }
        return 'heat';
      })();
      return {
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
        targetTempSet: operationalZone[`${tempType}Set`],
        targetTempMin: operationalZone[`${tempType}Min`],
        targetTempMax: operationalZone[`${tempType}Max`],
        tempType,
      };
    };
    try {
      // Lets make sure we wont get update from the setTimeout scheduled before we fetch new data
      if(this.timeoutId) {
        clearTimeout(this.timeoutId);
      }
      if(this.lastDetails) {
        return this.lastDetails;
      }
      const readingsPromise = loadReadings();
      this.lastDetails = readingsPromise;
      return await readingsPromise;
    } finally {
      this.refreshTimeout();
    }
  }

  async updateReadings() {
    const {
      outdoorTemperatureNow, temperatureNow, tankTemperatureNow, tankTemperatureSet, tankHeatingCoolingState, isActive, ecoModeIsActive,
      comfortModeIsActive, tankTemperatureMax, tankTemperatureMin, tankTargetHeatingCoolingState, heatingCoolingState,
      targetHeatingCoolingState, targetTempSet, targetTempMax, targetTempMin,
    } = await this.getReadings(true);

    console.log('updateReadings');

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(isActive);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(heatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
      minValue: targetTempMin + temperatureNow,
      maxValue: targetTempMax + temperatureNow,
      minStep: 1,
    }).updateValue(targetTempSet + temperatureNow);
    // As heat pumps take -5 up to +5 target temp and HomeKit does not support it, we have to adjust by tempNow

    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(outdoorTemperatureNow);
    this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).updateValue(true);

    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
      minValue: tankTemperatureMin,
      maxValue: tankTemperatureMax,
      minStep: 1,
    }).updateValue(tankTemperatureSet);
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(tankTemperatureNow);
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(tankHeatingCoolingState);
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(tankTargetHeatingCoolingState);

    this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(ecoModeIsActive);
    this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).updateValue(comfortModeIsActive);
  }

  private refreshTimeout() {
    if(this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      this.updateReadings();
    }, 5000);
  }


}
