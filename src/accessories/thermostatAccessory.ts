import { Service, PlatformAccessory } from 'homebridge';
import { PanasonicApi, PanasonicSpecialStatus, PanasonicTargetOperationMode } from '../api/panasonicApi';

import { PanasonicHeatPumpHomebridgePlatform } from '../platform';
import { DeviceContext, DeviceDetails } from '../types';
import { Accessory } from './accessory';

export class ThermostatAccessory extends Accessory<DeviceContext> {
  private service: Service;
  private tankService: Service | undefined;
  private ecoModeService: Service | undefined;
  private comfortModeService: Service | undefined;
  private readonly isCoolModeEnabled: boolean;
  private readonly hasWaterTank: boolean;

  constructor(
    platform: PanasonicHeatPumpHomebridgePlatform,
    accessory: PlatformAccessory<DeviceContext>,
    panasonicApi: PanasonicApi,
  ) {
    super(platform, accessory, panasonicApi);
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
    });
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.onTargetHeatingCollingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.onTargetTemperatureSet.bind(this));


    this.setupTankService();

    // Remove old existing temp sensor
    const existingTempSensor = this.accessory.getService('Outdoor');
    if(existingTempSensor) {
      this.accessory.removeService(existingTempSensor);
    }

    // Eco Mode
    if (this.platform.config.enableEcoModeSwitch) {
      this.ecoModeService = this.accessory.getService('Eco Mode') ||
        this.accessory.addService(this.platform.Service.Switch, 'Eco Mode', 'eco-mode');
      this.ecoModeService.getCharacteristic(this.platform.Characteristic.On).onSet(this.onEcoModeSet.bind(this));
    } else {
      const existingEcoMode = this.accessory.getService('Eco Mode');
      if (existingEcoMode) {
        this.accessory.removeService(existingEcoMode);
      }
    }


    // Comfort Mode
    if (this.platform.config.enableComfortModeSwitch) {
      this.comfortModeService = this.accessory.getService('Comfort Mode') ||
        this.accessory.addService(this.platform.Service.Switch, 'Comfort Mode', 'comfort-mode');
      this.comfortModeService.getCharacteristic(this.platform.Characteristic.On).onSet(this.onComfortModeSet.bind(this));
    } else {
      const existingComfortMode = this.accessory.getService('Comfort Mode');
      if (existingComfortMode) {
        this.accessory.removeService(existingComfortMode);
      }
    }

  }

  async onComfortModeSet(value) {
    if (value) {
      try {
        this.panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Comfort);
      } catch (e) {
        this.platform.log.error(
          `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.Comfort}]: ${e}`,
        );
      }
      this.ecoModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    } else {
      try {
        this.panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      } catch (e) {
        this.platform.log.error(
          `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.None}]: ${e}`,
        );
      }
    }
  }

  async onEcoModeSet(value) {
    if (value) {
      try {
        this.panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.Eco);
      } catch (e) {
        this.platform.log.error(
          `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.Eco}]: ${e}`,
        );
      }
      this.comfortModeService?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    } else {
      try {
        this.panasonicApi.setSpecialStatus(this.accessory.context.device.uniqueId, PanasonicSpecialStatus.None);
      } catch (e) {
        this.platform.log.error(
          `Could not set special status[${this.accessory.context.device.uniqueId}][${PanasonicSpecialStatus.None}]: ${e}`,
        );
      }
    }
  }

  async onTargetTemperatureSet(temp: unknown) {
    const readings = this.lastDeviceDetails;
    if(!readings) {
      return;
    }
    const {targetTempMin, tempType} = readings;
    const temperatureDelta = this.getTemperatureDelta({targetTempMin});
    const parsedTemp = parseInt(temp as string);
    const adjustedTemp = parsedTemp + temperatureDelta;

    try {
      this.panasonicApi.setZoneTemp(this.accessory.context.device.uniqueId, adjustedTemp, tempType);
    } catch (e) {
      this.platform.log.error(
        `Could not set zone temp[${this.accessory.context.device.uniqueId}][${adjustedTemp}][${tempType}]: ${e}`,
      );
    }
  }

  async onTargetHeatingCollingStateSet(state: unknown) {
    let operationMode = (() => {
      switch (state) {
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
    if (!this.isCoolModeEnabled && (operationMode === PanasonicTargetOperationMode.Cooling)) {
      operationMode = PanasonicTargetOperationMode.Off;
      this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
    }
    if (!this.isCoolModeEnabled && (operationMode === PanasonicTargetOperationMode.Auto)) {
      operationMode = PanasonicTargetOperationMode.Heating;
      this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
    }
    await this.updateHeatPump({ heaterMode: operationMode });
  }

  async updateHeatPump({ heaterMode, isWaterTankOn }: { heaterMode?: PanasonicTargetOperationMode; isWaterTankOn?: boolean }) {
    if(!this.lastDeviceDetails) {
      return;
    }
    const { tankTargetHeatingCoolingState, isActive, targetHeatingCoolingState } = this.lastDeviceDetails;
    const isWaterTankOnCurrently = tankTargetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const isFloorHeatingOnCurrently = targetHeatingCoolingState !== this.platform.Characteristic.TargetHeatingCoolingState.OFF;

    this.platform.log.debug(`updateHeatPump(${JSON.stringify({ heaterMode, isWaterTankOn })}) 
    [${JSON.stringify({ isActive, isFloorHeatingOnCurrently, isWaterTankOnCurrently })}]`);

    let heatPumpShouldBeActive = true;
    if (!this.hasWaterTank) {
      if (heaterMode === undefined) {
        this.platform.log.error(`Something unexpected happened for updateHeatPump without waterTank: 
        ${JSON.stringify({ heaterMode, isWaterTankOn })}`);
        return;
      }
      heatPumpShouldBeActive = heaterMode !== PanasonicTargetOperationMode.Off;
    } else {
      if (heaterMode === undefined && isWaterTankOn === undefined) {
        this.platform.log.error(`Something unexpected happened for updateHeatPump with waterTank: 
        ${JSON.stringify({ heaterMode, isWaterTankOn })}`);
        return;
      }
      if (heaterMode !== undefined) {
        heatPumpShouldBeActive = isWaterTankOnCurrently || heaterMode !== PanasonicTargetOperationMode.Off;
      }
      if (isWaterTankOn !== undefined) {
        heatPumpShouldBeActive = isFloorHeatingOnCurrently || isWaterTankOn;
      }
    }

    this.platform.log.debug(`heatPumpShouldBeActive: ${heatPumpShouldBeActive}`);
    this.platform.log.debug(`isActive: ${isActive}`);
    try {
      if (heaterMode !== undefined) {
        this.platform.log.debug(`setOperationMode(${heatPumpShouldBeActive}, ${heaterMode})`);
        this.panasonicApi.setOperationMode(this.accessory.context.device.uniqueId, heatPumpShouldBeActive, heaterMode);
      }
      if (isWaterTankOn !== undefined) {
        this.platform.log.debug(`setTankStatus(${heatPumpShouldBeActive}, ${isWaterTankOn})`);
        this.panasonicApi.setTankStatus(this.accessory.context.device.uniqueId, heatPumpShouldBeActive, isWaterTankOn);
      }
    } catch (e) {
      this.platform.log.error(`Could not set operation mode[${this.accessory.context.device.uniqueId}][${heaterMode}]: ${e}`);
    }
  }

  async onUpdateDetails(readings: DeviceDetails) {
    super.onUpdateDetails(readings);
    const {
      temperatureNow, tankTemperatureNow, tankTemperatureSet, tankHeatingCoolingState, isActive, ecoModeIsActive,
      comfortModeIsActive, tankTemperatureMax, tankTemperatureMin, tankTargetHeatingCoolingState, heatingCoolingState,
      targetHeatingCoolingState,
    } = readings;
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temperatureNow);
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(isActive);
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).updateValue(heatingCoolingState);
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);

    const currentTemp = this.updateTargetTemperaturePropsAndReturnCurrentTemp(readings);
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).updateValue(currentTemp);

    if (this.tankService) {
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

  private getTemperatureDelta({ targetTempMin }: Pick<DeviceDetails, 'targetTempMin'>) {
    // As heat pumps take -5 up to +5 target temp and HomeKit does not support it, we have to adjust by the min temp
    return targetTempMin < 0 ? -targetTempMin : 0;
  }

  private updateTargetTemperaturePropsAndReturnCurrentTemp({ targetTempMin, targetTempMax, targetTempSet, temperatureNow }: DeviceDetails) {
    if(targetTempMin === undefined || targetTempMax === undefined || targetTempSet === undefined) {
      this.platform.log.error(
        `updateTargetTemperaturePropsAndReturnCurrentTemp got wrong readings:  
        ${JSON.stringify({ targetTempMin, targetTempMax, targetTempSet, temperatureNow })}
        `);
      return 100; // fake big value to indicate the issue in homekit
    }

    const temperatureDelta = this.getTemperatureDelta({targetTempMin});
    const tempMin = targetTempMin + temperatureDelta;
    const tempMax = targetTempMax + temperatureDelta;
    const tempCurrent = targetTempSet + temperatureDelta;
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
    return tempCurrent;
  }


  private setupTankService() {
    if (this.tankService !== undefined) {
      return;
    }
    if (!this.hasWaterTank) {
      const existingTankService = this.accessory.getService('Water');
      if (existingTankService) {
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
      } catch (e) {
        this.platform.log.error(
          `Could not set tank target heat[${this.accessory.context.device.uniqueId}][${temp}]: ${e}`,
        );
      }
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).onSet(async (state: unknown) => {
      if (!this.tankService) {
        return;
      }
      if (state === this.platform.Characteristic.TargetHeatingCoolingState.OFF ||
        state === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        // turn off water heating
        this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
          .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.OFF);
        await this.updateHeatPump({ isWaterTankOn: false });
        return;
      }
      // turn on water heating
      this.tankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.platform.Characteristic.TargetHeatingCoolingState.HEAT);
      await this.updateHeatPump({ isWaterTankOn: true });
    });
    this.tankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: 0,
      maxValue: 100,
      minStep: 1,
    });
  }
}
