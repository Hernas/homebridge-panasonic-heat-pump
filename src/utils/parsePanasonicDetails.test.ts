import { Characteristic } from 'hap-nodejs';
import { example1 } from './examplePanasonicData/example1';
import { parsePanasonicDetails } from './parsePanasonicDetails';
import { example2 } from './examplePanasonicData/example2';
import { example3 } from './examplePanasonicData/example3';

describe('parsePanasonicDetails', () => {
  it('should return details [default]', async () => {
    const details = parsePanasonicDetails(example1, Characteristic);
    expect(details).toEqual({
      'comfortModeIsActive': false,
      'ecoModeIsActive': false,
      'heatingCoolingState': 0,
      'isActive': true,
      'outdoorTemperatureNow': 22,
      'tankHeatingCoolingState': 1,
      'tankTargetHeatingCoolingState': 1,
      'tankTemperatureMax': 65,
      'tankTemperatureMin': 40,
      'tankTemperatureNow': 50,
      'tankTemperatureSet': 52,
      'targetHeatingCoolingState': 1,
      'targetTempMax': 5,
      'targetTempMin': -5,
      'targetTempSet': -5,
      'tempType': 'heat',
      'temperatureNow': 20,
    });
  });
  it('should return details [comfort]', async () => {
    const details = parsePanasonicDetails(example2, Characteristic);
    expect(details).toEqual({
      'comfortModeIsActive': true,
      'ecoModeIsActive': false,
      'heatingCoolingState': 0,
      'isActive': true,
      'outdoorTemperatureNow': 22,
      'tankHeatingCoolingState': 1,
      'tankTargetHeatingCoolingState': 1,
      'tankTemperatureMax': 65,
      'tankTemperatureMin': 40,
      'tankTemperatureNow': 50,
      'tankTemperatureSet': 52,
      'targetHeatingCoolingState': 1,
      'targetTempMax': 5,
      'targetTempMin': -5,
      'targetTempSet': 5,
      'tempType': 'heat',
      'temperatureNow': 20,
    });
  });
  it('should return details [eco]', async () => {
    const details = parsePanasonicDetails(example3, Characteristic);
    expect(details).toEqual({
      'comfortModeIsActive': false,
      'ecoModeIsActive': true,
      'heatingCoolingState': 0,
      'isActive': true,
      'outdoorTemperatureNow': 22,
      'tankHeatingCoolingState': 1,
      'tankTargetHeatingCoolingState': 1,
      'tankTemperatureMax': 65,
      'tankTemperatureMin': 40,
      'tankTemperatureNow': 50,
      'tankTemperatureSet': 52,
      'targetHeatingCoolingState': 1,
      'targetTempMax': 5,
      'targetTempMin': -5,
      'targetTempSet': -5,
      'tempType': 'heat',
      'temperatureNow': 20,
    });
  });
});