import { Characteristic } from 'homebridge';

export function parsePanasonicDetails(details: any, characteristic: typeof Characteristic) {

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
      return characteristic.CurrentHeatingCoolingState.OFF;
    }
    if(operationMode === 1) {
      return characteristic.CurrentHeatingCoolingState.HEAT;
    }
    if(operationMode === 2) {
      return characteristic.CurrentHeatingCoolingState.COOL;
    }
    if(operationMode === 3) {
      // AUTO
      return characteristic.CurrentHeatingCoolingState.HEAT;
    }
    if(operationMode === 4) {
      // AUTO
      return characteristic.CurrentHeatingCoolingState.COOL;
    }
    return characteristic.CurrentHeatingCoolingState.OFF;
  })();
  const targetHeatingCoolingState = (() => {
    if(details.operationStatus === 0 || operationalZone.operationStatus === 0) {
      return characteristic.TargetHeatingCoolingState.OFF;
    }
    switch (operationMode) {
      case 1:
        return characteristic.TargetHeatingCoolingState.HEAT;
      case 2:
        return characteristic.TargetHeatingCoolingState.COOL;
      case 3:
      case 4:
        return characteristic.TargetHeatingCoolingState.AUTO;
    }
    return characteristic.TargetHeatingCoolingState.OFF;
  })();
  const ecoModeIsActive = details.specialStatus.find(s => s.specialMode === 1).operationStatus === 1;
  const comfortModeIsActive = details.specialStatus.find(s => s.specialMode === 2).operationStatus === 1;
  const outdoorTemperatureNow = details.outdoorNow;
  const tankTemperatureNow = details.tankStatus[0].temparatureNow;
  const tankTemperatureSet = details.tankStatus[0].heatSet;
  const tankIsActive = details.tankStatus[0].operationStatus === 1;
  const tankHeatingCoolingState = (() => {
    if (!isTankOn || !isActive || !tankIsActive) {
      return characteristic.CurrentHeatingCoolingState.OFF;
    }
    return characteristic.CurrentHeatingCoolingState.HEAT;
  })();
  const tankTargetHeatingCoolingState = (() => {
    if (!tankIsActive || !isActive) {
      return characteristic.TargetHeatingCoolingState.OFF;
    }
    return characteristic.TargetHeatingCoolingState.HEAT;
  })();


  const tempType: 'heat' | 'cool' = (() => {
    if(operationMode === 1 || operationMode === 3) {

      return 'heat';
    }
    if(operationMode === 2 || operationMode === 4) {
      return 'cool';
    }
    return 'heat';
  })();

  let targetTempSet = operationalZone[`${tempType}Set`];
  if(ecoModeIsActive) {
    if(tempType === 'heat') {
      targetTempSet = operationalZone['ecoHeat'];
    }
    if(tempType === 'cool') {
      targetTempSet = operationalZone['ecoCool'];
    }
  }
  if(comfortModeIsActive) {
    if(tempType === 'heat') {
      targetTempSet = operationalZone['comfortHeat'];
    }
    if(tempType === 'cool') {
      targetTempSet = operationalZone['comfortCool'];
    }
  }
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
    targetTempSet: targetTempSet,
    targetTempMin: operationalZone[`${tempType}Min`],
    targetTempMax: operationalZone[`${tempType}Max`],
    tempType,
  };
}