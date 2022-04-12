import axios from 'axios';

export class PanasonicApi {
  private username;
  private password;
  private accessToken?: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  private async ensureAuthenticated() {
    if(this.accessToken) {
      return;
    }
    const response = await axios({
      'method': 'POST',
      'url': 'https://aquarea-smart.panasonic.com/remote/v1/api/auth/login',
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': 'https://aquarea-smart.panasonic.com/',
        'Registration-Id': '',
        'Cookie': 'selectedGwid=B171178685; selectedDeviceId=008007B171178685001434545313831373030634345373130434345373138313931304300000000; operationDeviceTop=1; JSESSIONID=42F135DDF1E977A12268C37B31BE8700; accessToken=fecdf8fc-0b29-4d1d-9a57-a964f39d4b94',
      },
      'data': `var.loginId=${encodeURIComponent(this.username)}&var.password=${encodeURIComponent(this.password)}&var.inputOmit=true`,
    });
    console.log(response.data);
    console.log(response.headers);
    console.log(response.headers['set-cookie']?.map(cookie => cookie?.match(/accessToken=(.+?);/i)?.[1]));
    this.accessToken = response.headers['set-cookie']?.map(cookie => cookie?.match(/accessToken=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    console.log(this.accessToken);
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
    if(response.data.includes('staticErrorMessage_XXXX_0998')) {
      if(retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated();
      return this.loadDevice(true);
    }
    const selectedDeviceId = response.data.match(/var selectedDeviceId = '(.+?)';/i)[1];
    const selectedDeviceName = response.data.match(/var selectedDeviceName = '(.+?)';/i)[1];
    console.log('selectedDeviceId', selectedDeviceId);
    console.log('selectedDeviceName', selectedDeviceName);
    return {selectedDeviceId, selectedDeviceName};
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
    if(response.data.errorCode > 0) {
      if(retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated();
      return this.loadDeviceDetails(deviceId, true);
    }
    console.log(response.data.status[0]);
    return response.data.status[0];
  }
}