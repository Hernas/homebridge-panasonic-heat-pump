import axios from 'axios';

export enum PanasonicSpecialStatus {
    None = 0,
    Eco = 1,
    Comfort = 2
}
export class PanasonicApi {
  private username;
  private password;
  private accessToken?: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  private async ensureAuthenticated() {
    if (this.accessToken) {
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
      await this.ensureAuthenticated();
      return this.loadDevice(true);
    }
    const selectedDeviceId = response.data.match(/var selectedDeviceId = '(.+?)';/i)[1];
    const selectedDeviceName = response.data.match(/var selectedDeviceName = '(.+?)';/i)[1];
    return { selectedDeviceId, selectedDeviceName };
  }

  async loadDeviceDetails(deviceId: string, retried = false) {
    await this.ensureAuthenticated();

    const response = await axios({
      'method': 'GET',
      'url': `https://aquarea-smart.panasonic.com/remote/v1/api/devices/${deviceId}`,
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `accessToken=${this.accessToken};`,
        'Origin': 'https://aquarea-smart.panasonic.com',
      },
    });
    if (response.data.errorCode > 0) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated();
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
      await this.ensureAuthenticated();
      return this.setSpecialStatus(deviceId, status, true);
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
      await this.ensureAuthenticated();
      return this.setTankTargetHeat(deviceId, temperature, true);
    }
  }
}