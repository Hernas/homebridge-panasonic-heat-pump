import { ThermometerAccessory } from './accessories/thermometerAccessory';
import { ThermostatAccessory } from './accessories/thermostatAccessory';

export enum AccessoryType {
    Thermostat,
    Thermometer
}
export interface Device {
    uniqueId: string;
    displayName: string;
    isCoolModeEnabled: boolean;
    hasWaterTank: boolean;
}

export interface DeviceContext {
    device: Device;
    type: AccessoryType;
}
export const accessoryTypeClases = {
  [AccessoryType.Thermometer]: ThermometerAccessory,
  [AccessoryType.Thermostat]: ThermostatAccessory,
};
export type DeviceDetails = {
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