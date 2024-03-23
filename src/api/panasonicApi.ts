import axios from 'axios';
import { Logger } from 'homebridge';
import { decode } from 'html-entities';
import qs, { unescape } from 'querystring';

const clientId = 'vf2i6hW5hA2BB2BQGfTHXM4YFyW4I06K';
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
        'popup-screen-id': '1001',
        'Registration-Id': '',
      },
      'data': null,
      validateStatus: () => true,
    });

    const auth0State = response.headers['set-cookie']?.map(cookie => cookie?.match(/com.auth0.state=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    const response1 = await axios({
      'method': 'GET',
      'url': `https://authglb.digital.panasonic.com/authorize?${qs.stringify({
        'audience': `https://digital.panasonic.com/${clientId}/api/v1/`,
        'client_id': clientId,
        'redirect_uri': 'https://aquarea-smart.panasonic.com/authorizationCallback',
        'response_type': 'code',
        'scope': 'openid offline_access',
        'state': auth0State,
      })}`,
      'headers': {
        'Referer': 'https://aquarea-smart.panasonic.com/',
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    let auth0Compat = response1.headers['set-cookie']?.map(cookie => cookie?.match(/auth0_compat=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    let auth0 = response1.headers['set-cookie']?.map(cookie => cookie?.match(/auth0=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    const did = response1.headers['set-cookie']?.map(cookie => cookie?.match(/did=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    const didCompat = response1.headers['set-cookie']?.map(cookie => cookie?.match(/did_compat=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;

    const location = response1.headers['location'];
    const state = new URL(`https://authglb.digital.panasonic.com${location}`).searchParams.get('state');
    const response2 = await axios({
      'method': 'GET',
      'url': `https://authglb.digital.panasonic.com${location}`,
      'headers': {
        'Referer': 'https://aquarea-smart.panasonic.com/',
        'Cookie': `auth0=${auth0}; auth0_compat=${auth0Compat}; did=${did}; did_compat=${didCompat};`,
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if(response2.status !== 200) {
      throw new Error(`Wrong response on location redirect: ${response2.status}`);
    }
    const csrf = response2.headers['set-cookie']?.map(cookie => cookie?.match(/_csrf=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;

    const response3 = await axios({
      'method': 'POST',
      'url': 'https://authglb.digital.panasonic.com/usernamepassword/login',
      'headers': {
        'Auth0-Client': 'eyJuYW1lIjoiYXV0aDAuanMtdWxwIiwidmVyc2lvbiI6IjkuMjMuMiJ9',
        'Content-Type': 'application/json; charset=UTF-8',
        'Referer': `https://authglb.digital.panasonic.com/login?${qs.stringify({
          'audience': `https://digital.panasonic.com/${clientId}/api/v1/`,
          'client': clientId,
          'protocol': 'oauth2',
          'redirect_uri': 'https://aquarea-smart.panasonic.com/authorizationCallback',
          'response_type': 'code',
          'scope': 'openid offline_access',
          'state': state,
        })}`,
        'Cookie': `_csrf=${csrf}; auth0=${auth0}; auth0_compat=${auth0Compat}; did=${did}; did_compat=${didCompat};`,
      },
      data: {
        'client_id':clientId,
        'redirect_uri':'https://aquarea-smart.panasonic.com/authorizationCallback?lang=en',
        'tenant':'pdpauthglb-a1',
        'response_type':'code',
        'scope':'openid offline_access',
        'audience':`https://digital.panasonic.com/${clientId}/api/v1/`,
        '_csrf':csrf,
        'state':state,
        '_intstate':'deprecated',
        'username':this.username,
        'password':this.password,
        'lang':'en',
        'connection':'PanasonicID-Authentication',
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const actionUrl = response3.data.match(/action="(.+?)"/i)?.[1];
    const inputs = response3.data.match(/<input([^\0]+?)>/ig) ?? [];
    const formData:Record<string, string> = {};
    inputs.forEach(input => {
      const name = input.match(/name="(.+?)"/i)?.[1];
      const value = input.match(/value="(.+?)"/i)?.[1];
      if(name && value) {
        formData[name] = decode(value);
      }
    });

    const response4 = await axios({
      'method': 'POST',
      'url': actionUrl,
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': `https://authglb.digital.panasonic.com/login?${qs.stringify({
          'audience': `https://digital.panasonic.com/${clientId}/api/v1/`,
          'client': clientId,
          'protocol': 'oauth2',
          'redirect_uri': 'https://aquarea-smart.panasonic.com/authorizationCallback',
          'response_type': 'code',
          'scope': 'openid offline_access',
          'state': state,
        })}`,
        'Cookie': `_csrf=${csrf}; auth0=${auth0}; auth0_compat=${auth0Compat}; did=${did}; did_compat=${didCompat};`,
      },
      data: qs.stringify(formData),
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const location1 = response4.headers['location'];

    const response5 = await axios({
      'method': 'GET',
      'url': `https://authglb.digital.panasonic.com${location1}`,
      'headers': {
        'Cookie': `_csrf=${csrf}; auth0=${auth0}; auth0_compat=${auth0Compat}; did=${did}; did_compat=${didCompat};`,
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    auth0Compat = response5.headers['set-cookie']?.map(cookie => cookie?.match(/auth0_compat=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;
    auth0 = response5.headers['set-cookie']?.map(cookie => cookie?.match(/auth0=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;

    const location2 = response5.headers['location'];

    const response6 = await axios({
      'method': 'GET',
      'url': location2,
      'headers': {
        'Cookie': `_csrf=${csrf}; auth0=${auth0}; auth0_compat=${auth0Compat}; did=${did}; did_compat=${didCompat};`,
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    this.accessToken = response6.headers['set-cookie']?.map(cookie => cookie?.match(/accessToken=(.+?);/i)?.[1]).filter(c => !!c)[0] ?? undefined;

    if (!this.accessToken) {
      this.log?.error(`Could not authenticate to Aquarea Smart Panasonic. Headers: ${JSON.stringify(response.headers)}`);
      if (retries > 5) {
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
      validateStatus: () => true,
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
          + '(KHTML, like Gecko) Version/16.3 Safari/605.1.15',
      },
      validateStatus: () => true,
    });
    if (response.data.errorCode > 0 || !response.data.status || !response.data.status[0]) {
      if (retried) {
        if (response.data.message && response.data.message.length > 0) {
          const joinedMessages = response.data.message.map(({ errorMessage }) => errorMessage).join('\n');
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
      validateStatus: () => true,
    });
    if (response.data.errorCode > 0) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setSpecialStatus(deviceId, status, true);
    }
    if (response.data.errorCode !== 0) {
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
          'status': [
            {
              'deviceGuid': deviceId,
              'tankStatus': [{ 'heatSet': temperature }],
            },
          ],
        }),
      validateStatus: () => true,
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setTankTargetHeat(deviceId, temperature, true);
    }
    if (response.data.errorCode !== 0) {
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
          'status': [
            {
              'deviceGuid': deviceId,
              'operationStatus': operationStatus ? 1 : 0,
              'operationMode': operationMode,
              'zoneStatus': [{ zoneId: 1, 'operationStatus': operationMode === PanasonicTargetOperationMode.Off ? 0 : 1 }],
            },
          ],
        }),
      validateStatus: () => true,
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setOperationMode(deviceId, operationStatus, operationMode, true);
    }
    if (response.data.errorCode !== 0) {
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
          'status': [
            {
              'deviceGuid': deviceId,
              'zoneStatus': [{ zoneId: 1, [`${type}Set`]: temp }],
            },
          ],
        }),
      validateStatus: () => true,
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setZoneTemp(deviceId, temp, type, true);
    }
    if (response.data.errorCode !== 0) {
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
          'status': [
            {
              'deviceGuid': deviceId,
              'operationStatus': isOn ? 1 : 0,
            },
          ],
        }),
      validateStatus: () => true,
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setOperationStatus(deviceId, isOn, true);
    }
    if (response.data.errorCode !== 0) {
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
          'status': [
            {
              'deviceGuid': deviceId,
              'operationStatus': operationStatus ? 1 : 0,
              'tankStatus': [{ 'operationStatus': isOn ? 1 : 0 }],
            },
          ],
        }),
      validateStatus: () => true,
    });
    if (response.status === 403) {
      if (retried) {
        throw new Error('Cannot authenticate');
      }
      await this.ensureAuthenticated(true);
      return this.setTankStatus(deviceId, operationStatus, isOn, true);
    }
    if (response.data.errorCode !== 0) {
      throw new Error(`Could not update tank status: ${JSON.stringify(response.data)}`);
    }
  }
}