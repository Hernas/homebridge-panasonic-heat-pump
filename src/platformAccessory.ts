import { Service, PlatformAccessory } from 'homebridge';
import { PanasonicApi, PanasonicSpecialStatus, PanasonicTargetOperationMode, wait } from './panasonicApi';

import { PanasonicHeatPumpHomebridgePlatform } from './platform';

type Details = {
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
};
const noDetails: Details = {
  temperatureNow: 0,
  heatingCoolingState: 0,
  targetHeatingCoolingState: 0,
  outdoorTemperatureNow: 0,
  tankTemperatureNow: 0,
  tankTemperatureSet: 0,
  tankHeatingCoolingState: 0,
  tankTargetHeatingCoolingState: 0,
  isActive: false,
  ecoModeIsActive: false,
  comfortModeIsActive: false,
  tankTemperatureMax: 0,
  tankTemperatureMin: 0,
  targetTempSet: 0,
  targetTempMin: 0,
  targetTempMax: 0,
  tempType: 'heat',
};
export class PanasonicHeatPumpPlatformAccessory {
  private service: Service;
  private outdoorTemperatureService?: Service;
  private tankService: Service | undefined;
  private ecoModeService: Service | undefined;
  private comfortModeService: Service | undefined;
  private readonly isCoolModeEnabled: boolean;
  private readonly hasWaterTank: boolean;

  private lastDetailsPromise: Promise<Details> | undefined;
  private lastDetails: Details | undefined;
  private timeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly platform: PanasonicHeatPumpHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly panasonicApi: PanasonicApi,
  ) {
    this.isCoolModeEnabled = this.accessory.context.device.isCoolModeEnabled;
    this.hasWaterTank = this.accessory.context.device.hasWaterTank;
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
        let operationMode = (() => {
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

        // In case of having water tank, we have to control only specific ZONE and operationMode
        if(!this.isCoolModeEnabled && (operationMode === PanasonicTargetOperationMode.Cooling)) {
          operationMode = PanasonicTargetOperationMode.Off;
          this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
        }
        if(!this.isCoolModeEnabled && (operationMode === PanasonicTargetOperationMode.Auto)) {
          operationMode = PanasonicTargetOperationMode.Heating;
          this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
        }
        await this.updateHeatPump({heaterMode: operationMode});
        await this.getReadings(true);
      }).onGet(async () => (await this.getReadings()).targetHeatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(async (temp: unknown) => {
        const readings = await this.getReadings();
        const adjustedTemp = (parseInt(temp as string)) - readings.temperatureNow;

        try {
          this.panasonicApi.setZoneTemp(this.accessory.context.device.uniqueId,
            adjustedTemp, readings.tempType);
        } catch(e) {
          this.platform.log.error(
            `Could not set zone temp[${this.accessory.context.device.uniqueId}][${adjustedTemp}][${readings.tempType}]: ${e}`,
          );
        }
        await this.getReadings(true);
      }).onGet(async () => {
        const readings = await this.getReadings();
        return this.updateTargetTemperaturePropsAndReturnCurrentTemp(readings);
      });


    this.setupTankService();

    // Outdoor temperature
    if(this.platform.config.enableOutdoorTempSensor) {
      this.outdoorTemperatureService = this.accessory.getService('Outdoor') ||
      this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor', 'outdoor');
      this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(async () => {
        return (await this.getReadings()).outdoorTemperatureNow;
      });
      this.outdoorTemperatureService.getCharacteristic(this.platform.Characteristic.StatusActive).onGet(async () => {
        return true;
      });
    } else {
      const existingTempSensor = this.accessory.getService('Outdoor');
      if(existingTempSensor) {
        this.accessory.removeService(existingTempSensor);
      }
    }


    // Eco Mode
    if(this.platform.config.enableEcoModeSwitch) {
      this.ecoModeService = this.accessory.getService('Eco Mode') ||
        this.accessory.addService(this.platform.Service.Switch, 'Eco Mode', 'eco-mode');
      this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
        if(value) {
          try {
            panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Eco);
          } catch(e) {
            this.platform.log.error(
              `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.Eco}]: ${e}`,
            );
          }
          this.comfortModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        } else {
          try {
            panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
          } catch(e) {
            this.platform.log.error(
              `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.None}]: ${e}`,
            );
          }
        }
        await this.getReadings(true, true);
      }).onGet(async () => {
        return (await this.getReadings()).ecoModeIsActive;
      });
    } else {
      const existingEcoMode = this.accessory.getService('Eco Mode');
      if(existingEcoMode) {
        this.accessory.removeService(existingEcoMode);
      }
    }


    // Comfort Mode
    if(this.platform.config.enableComfortModeSwitch) {
      this.comfortModeService = this.accessory.getService('Comfort Mode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Comfort Mode', 'comfort-mode');
      this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).onSet(async (value) => {
        if(value) {
          try {
            panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Comfort);
          } catch(e) {
            this.platform.log.error(
              `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.Comfort}]: ${e}`,
            );
          }
          this.ecoModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        } else {
          try {
            panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
          } catch(e) {
            this.platform.log.error(
              `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.None}]: ${e}`,
            );
          }
        }
        await this.getReadings(true, true);
      }).onGet(async () => {
        return (await this.getReadings()).comfortModeIsActive;
      });
    } else {
      const existingComfortMode = this.accessory.getService('Comfort Mode');
      if(existingComfortMode) {
        this.accessory.removeService(existingComfortMode);
      }
    }

    this.getReadings();
  }

  async updateHeatPump({heaterMode, isWaterTankOn}: {heaterMode?: PanasonicTargetOperationMode; isWaterTankOn?: boolean}) {
    const {tankTargetHeatingCoolingState, isActive, targetHeatingCoolingState} = await this.getReadings();
    const isWaterTankOnCurrently = tankTargetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const isFloorHeatingOnCurrently = targetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;

    this.platform.log.debug(`updateHeatPump(${JSON.stringify({heaterMode, isWaterTankOn})}) 
    [${JSON.stringify({isActive, isFloorHeatingOnCurrently, isWaterTankOnCurrently})}]`);

    let heatPumpShouldBeActive = true;
    if(!this.hasWaterTank) {
      if(heaterMode === undefined) {
        this.platform.log.error(`Something unexpected happened for updateHeatPump without waterTank: 
        ${JSON.stringify({heaterMode, isWaterTankOn})}`);
        return;
      }
      heatPumpShouldBeActive = heaterMode !== PanasonicTargetOperationMode.Off;
    } else {
      if(heaterMode === undefined && isWaterTankOn === undefined) {
        this.platform.log.error(`Something unexpected happened for updateHeatPump with waterTank: 
        ${JSON.stringify({heaterMode, isWaterTankOn})}`);
        return;
      }
      if(heaterMode !== undefined) {
        heatPumpShouldBeActive = isWaterTankOnCurrently || heaterMode !== PanasonicTargetOperationMode.Off;
      }
      if(isWaterTankOn !== undefined) {
        heatPumpShouldBeActive = isFloorHeatingOnCurrently || isWaterTankOn;
      }
    }

    this.platform.log.debug(`heatPumpShouldBeActive: ${heatPumpShouldBeActive}`);
    this.platform.log.debug(`isActive: ${isActive}`);
    try {
      if(heaterMode !== undefined) {
        this.platform.log.debug(`setOperationMode(${heatPumpShouldBeActive}, ${heaterMode})`);
        this.panasonicApi.setOperationMode(this.accessory.context.device.uniqueId, heatPumpShouldBeActive, heaterMode);
      }
      if(isWaterTankOn !== undefined) {
        this.platform.log.debug(`setTankStatus(${heatPumpShouldBeActive}, ${isWaterTankOn})`);
        this.panasonicApi.setTankStatus(this.accessory.context.device.uniqueId, heatPumpShouldBeActive, isWaterTankOn);
      }
    } catch(e) {
      this.platform.log.error(`Could not set operation mode[${this.accessory.context.device.uniqueId}][${heaterMode}]: ${e}`);
    }
  }

  async getReadings(force = false, afterSet = false): Promise<Details> {
    if(force) {
      this.lastDetailsPromise = undefined;
    }
    const loadReadings = async () => {
      if(afterSet) {
        await wait(1000);
      }
      const details = await this.panasonicApi.loadDeviceDetails(this.accessory.context.device.uniqueId);

      const operationalZone = details.zoneStatus.find(z => z.temparatureNow !== null);
      const temperatureNow = operationalZone?.temparatureNow;

      const isActive = details.operationStatus === 1;
      const direction = details.direction;
      const isWholeHeaterOff = details.operationStatus === 0 || operationalZone.operationStatus === 0;

      // What is currently being heated (so if both water tank and heater are on, what is currently being provided with heat)
      const isHeatingOn = direction === 1;
      const isTankOn = direction === 2;

      // if you need to return an error to show the device as "Not Responding" in the Home app:
      // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      const operationMode = details.operationMode;
      const heatingCoolingState = (() => {
        if(!isHeatingOn || isWholeHeaterOff) {
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
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
      })();
      const targetHeatingCoolingState = (() => {
        if(details.operationStatus === 0 || operationalZone.operationStatus === 0) {
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
        if (!isTankOn || !isActive || !tankIsActive) {
          return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
        }
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      })();
      const tankTargetHeatingCoolingState = (() => {
        if (!tankIsActive || !isActive) {
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
      if(this.lastDetailsPromise) {
        return await this.lastDetailsPromise;
      }
      const readingsPromise = loadReadings().then(details => {
        this.platform.log.debug(`Readings: ${JSON.stringify(details)}`);
        this.lastDetails = details;
        return details;
      });
      this.lastDetailsPromise = readingsPromise;
      return await readingsPromise;
    } catch(e) {
      this.platform.log.error(
        `Could not fetch details of device[${this.accessory.context.device.uniqueId}] ${e}`,
      );
      return this.lastDetails ?? noDetails;
    } finally {
      this.refreshTimeout();
    }
  }

  async updateReadings(readings: Details) {
    const {
      outdoorTemperatureNow, temperatureNow, tankTemperatureNow, tankTemperatureSet, tankHeatingCoolingState, isActive, ecoModeIsActive,
      comfortModeIsActive, tankTemperatureMax, tankTemperatureMin, tankTargetHeatingCoolingState, heatingCoolingState,
      targetHeatingCoolingState,
    } = readings;
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(isActive);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(heatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);

    const currentTemp = this.updateTargetTemperaturePropsAndReturnCurrentTemp(readings);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(currentTemp);
    // As heat pumps take -5 up to +5 target temp and HomeKit does not support it, we have to adjust by tempNow

    this.outdoorTemperatureService?.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(outdoorTemperatureNow);
    this.outdoorTemperatureService?.getCharacteristic(this.platform.Characteristic.StatusActive).updateValue(true);

    if(this.tankService) {
      this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
        minValue: tankTemperatureMin,
        maxValue: tankTemperatureMax,
        minStep: 1,
      }).updateValue(tankTemperatureSet);
      this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(tankTemperatureNow);
      this.tankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(tankHeatingCoolingState);
      this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(tankTargetHeatingCoolingState);
    }

    this.ecoModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(ecoModeIsActive);
    this.comfortModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(comfortModeIsActive);
  }

  private updateTargetTemperaturePropsAndReturnCurrentTemp({targetTempMin, targetTempMax, targetTempSet, temperatureNow}: Details) {
    const tempMin = Math.floor(targetTempMin) + Math.floor(temperatureNow);
    const tempMax = Math.ceil(targetTempMax) + Math.ceil(temperatureNow);
    const tempCurrent = Math.round(targetTempSet + temperatureNow);
    this.platform.log.debug(`Updating TargetTemperature of Floor Heater: ${JSON.stringify({
      minValue: tempMin,
      maxValue: tempMax,
      minStep: 1,
    })}`);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
      minValue: tempMin,
      maxValue: tempMax,
      minStep: 1,
    });
    return Math.max(tempMin, Math.min(tempMax, tempCurrent));
  }

  private refreshTimeout() {
    if(this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    const timeout = (this.platform.config.refreshTime ?? 15) * 1000;
    this.timeoutId = setTimeout(() => {
      this.getReadings(true);
    }, timeout);
  }


  private setupTankService() {
    if(this.tankService !== undefined) {
      return;
    }
    if(!this.hasWaterTank) {
      const existingTankService = this.accessory.getService('Water');
      if(existingTankService) {
        this.accessory.removeService(existingTankService);
        this.tankService = undefined;
      }
      return;
    }
    // Water
    this.tankService = this.accessory.getService('Water')
      || this.accessory.addService(this.platform.Service.Thermostat, 'Water', 'water');
    this.tankService.setCharacteristic(this.platform.Characteristic.Name, 'Water');
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetTemperature).onSet(async (temp: unknown) => {
      try {
        this.panasonicApi.setTankTargetHeat(this.accessory.context.device.uniqueId, temp as number);
      } catch(e) {
        this.platform.log.error(
          `Could not set tank target heat[${this.accessory.context.device.uniqueId}][${temp}]: ${e}`,
        );
      }
      await this.getReadings(true);
    }).onGet(async () => {
      return (await this.getReadings()).tankTemperatureSet;
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).onSet(async (state: unknown) => {
      if(!this.tankService) {
        return;
      }
      if(state === this.platform.Characteristic.TargetHeatingCoolingState.OFF ||
        state === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        // turn off water heating
        this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
          .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
        await this.updateHeatPump({isWaterTankOn: false});
        await this.getReadings(true, true);
        return;
      }
      // turn on water heating
      this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
      await this.updateHeatPump({isWaterTankOn: true});
      await this.getReadings(true, true);
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
  }
}
