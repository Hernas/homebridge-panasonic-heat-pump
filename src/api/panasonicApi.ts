import axios from 'axios';
import { Logger } from 'homebridge';

export enum PanasonicSpecialStatus {
    None = 0,
    Eco = 1,
    Comfort = 2
}

export enum PanasonicTargetOperationMode {
  Off = 0,
  Heating = 2,
  Cooling = 3,
  Auto = 8
}
export async function wait(time: number) {
  return new Promise(resolve => setTimeout(resolve, time));
}

export class PanasonicApi {
  private username;
  private password;
  private accessToken?: string;
  private log?: Logger;

  constructor(username: string, password: string, log?: Logger) {
    this.username = username;
    this.password = password;
    this.log = log;
  }

  private async ensureAuthenticated(force = false, retries = 0) {
    if (this.accessToken && !force) {
      return;
    }
    const response = await axios({
      'method': 'POST',
      'url': 'https://aquarea-smart.panasonic.com/remote/v1/api/auth/login',
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': 'https://aquarea-smart.panasonic.com/',
        'Registration-Id': '',
      },
      'data': `var.loginId=${encodeURIComponent(this.username)}&var.password=${encodeURIComponent(this.password)}&var.inputOmit=true`,
    });
    this.accessToken = response.headers['set-cookie']?.
      map(cookie => cookie?.match(/accessToken=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    if(!this.accessToken) {
      this.log?.error(`Could not authenticate to Aquarea Smart Panasonic. Headers: ${JSON.stringify(response.headers)}`);
      if(retries > 5) {
        throw new Error('Could not authenticate');
      }
      await wait(1000);
      return this.ensureAuthenticated(force, retries + 1);
    }
    this.log?.info('Authenticated to Aquarea Smart Panasonic');
  }

  async loadDevice(retried = false) {
    await this.ensureAuthenticated();

    const response = await axios({
      'method': 'POST',
      'url': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `accessToken=${this.accessToken};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
      },
      'data': 'Registration-ID',
    });
    if (response.data.includes('staticErrorMessage_XXXX_0998')) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await wait(1000);
      await this.ensureAuthenticated(true);
      return this.loadDevice(true);
    }
    const selectedDeviceId = response.data.match(/var selectedDeviceId = '(.+?)';/i)[1];
    const selectedDeviceName = response.data.match(/var selectedDeviceName = '(.+?)';/i)[1];
    const deviceConf = response.data.match(/var deviceConf = eval\('\((.+?)\)'\);/i)[1].replaceAll('\\"', '"');
    return { selectedDeviceId, selectedDeviceName, deviceConf: JSON.parse(deviceConf) };
  }

  async loadDeviceDetails(deviceId: string, retried = false) {
    await this.ensureAuthenticated();

    const response = await axios({
      'method': 'GET',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}?var.deviceDirect=1`,
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `accessToken=${this.accessToken};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
        +'(KHTML, like Gecko) Version/16.3 Safari/605.1.15',
      },
    });
    if (response.data.errorCode > 0 || !response.data.status || !response.data.status[0]) {
      if (retried) {
        if(response.data.message && response.data.message.length > 0) {
          const joinedMessages = response.data.message.map(({errorMessage}) => errorMessage).join('\n');
          throw new Error(joinedMessages);
        }
        throw new Error(`Cannot load device details: ${JSON.stringify(response.data)}`);
      }
      await wait(1000);
      await this.ensureAuthenticated(true);
      return this.loadDeviceDetails(deviceId, true);
    }
    return response.data.status[0];
  }

  async setSpecialStatus(deviceId: string, status: PanasonicSpecialStatus, retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status': [
            {
              'deviceGuid': deviceId,
              'specialStatus': status,

            }],
        }),
    });
    if (response.data.errorCode > 0) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setSpecialStatus(deviceId, status, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update special status: ${JSON.stringify(response.data)}`);
    }
  }

  async setTankTargetHeat(deviceId: string, temperature: number, retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status':[
            {
              'deviceGuid':deviceId,
              'tankStatus':[{'heatSet':temperature}],
            },
          ],
        }),
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setTankTargetHeat(deviceId, temperature, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update tank target heat: ${JSON.stringify(response.data)}`);
    }
  }

  async setOperationMode(deviceId: string, operationStatus: boolean, operationMode: PanasonicTargetOperationMode, retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status':[
            {
              'deviceGuid':deviceId,
              'operationStatus':operationStatus ? 1 : 0,
              'operationMode':operationMode,
              'zoneStatus': [{zoneId: 1, 'operationStatus':operationMode === PanasonicTargetOperationMode.Off ? 0 : 1}],
            },
          ],
        }),
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setOperationMode(deviceId, operationStatus, operationMode, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update operation mode: ${JSON.stringify(response.data)}`);
    }
  }

  async setZoneTemp(deviceId: string, temp: number, type: 'cool' | 'heat' | 'eco' | 'comfort', retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status':[
            {
              'deviceGuid':deviceId,
              'zoneStatus': [{zoneId: 1, [`${type}Set`]: temp}],
            },
          ],
        }),
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setZoneTemp(deviceId, temp, type, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update zone temp: ${JSON.stringify(response.data)}`);
    }
  }

  async setOperationStatus(deviceId: string, isOn: boolean, retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status':[
            {
              'deviceGuid':deviceId,
              'operationStatus':isOn ? 1 : 0,
            },
          ],
        }),
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setOperationStatus(deviceId, isOn, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update operation status: ${JSON.stringify(response.data)}`);
    }
  }

  async setTankStatus(deviceId: string, operationStatus: boolean, isOn: boolean, retried = false) {
    await this.ensureAuthenticated();
    const response = await axios({
      'method': 'POST',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/json',
        'Cookie': `accessToken=${this.accessToken}; selectedDeviceId=${deviceId};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
        'Referer': 'https://aquarea-smart.panasonic.com/remote/a2wStatusDisplay',
      },
      'data': JSON.stringify(
        {
          'status':[
            {
              'deviceGuid':deviceId,
              'operationStatus':operationStatus ? 1 : 0,
              'tankStatus':[{'operationStatus':isOn ? 1 : 0}],
            },
          ],
        }),
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setTankStatus(deviceId, operationStatus, isOn, true);
    }
    if(response.data.errorCode !== 0) {
      throw new Error(`Could not update tank status: ${JSON.stringify(response.data)}`);
    }
  }
}