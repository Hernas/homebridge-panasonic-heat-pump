import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { PanasonicApi } from './api/panasonicApi';
import { AccessoryType, accessoryTypeClases, DeviceContext, DeviceDetails } from './types';
import { Accessory } from './accessories/accessory';
import { parsePanasonicDetails } from './utils/parsePanasonicDetails';

export class PanasonicHeatPumpHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public cachedAccessories: PlatformAccessory[] = [];
  public readonly accessories: Accessory<DeviceContext>[] = [];
  public readonly panasonicApi?: PanasonicApi;

  private readonly timeoutIds: Record<string, ReturnType<typeof setTimeout>> = {};
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.platform);

    if (this.config.email && this.config.password) {
      this.panasonicApi = new PanasonicApi(this.config.email, this.config.password, this.log);
    } else {
      this.log.error('Missing email & password, please configure the plugin correctly.');
    }

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.configureDevices();
    });

  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory<DeviceContext>) {
    this.log.info('accessory accessory from cache:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  async configureDevices() {
    if(!this.panasonicApi) {
      return;
    }
    this.log.debug('Fetching devices');
    const devices = await this.fetchDevices();
    if (!devices) {
      this.log.warn('Could not load any devices from Comfort Cloud API, trying again in 60 seconds');
      setTimeout(() => {
        this.configureDevices();
      }, 60000);
      return;
    }
    const foundAccessoriesUUIDs: string[] = [];
    for (const device of devices) {
      for(const type of Object.keys(accessoryTypeClases)) {
        const accessoryClass = accessoryTypeClases[type];
        const uuid = this.api.hap.uuid.generate(`${device.uniqueId}-${type}`);
        const existingAccessory = this.cachedAccessories.find(accessory => accessory.UUID === uuid);
        foundAccessoriesUUIDs.push(uuid);
        if(!this.config.enableOutdoorTempSensor && type as unknown as AccessoryType === AccessoryType.Thermometer) {
          if(existingAccessory) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          }
          continue;
        }
        const existingOldAccessory = this.accessories
          .find(accessory => accessory.accessory.UUID === this.api.hap.uuid.generate(device.uniqueId));
        if(existingOldAccessory) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingOldAccessory.accessory]);
        }

        const accessory = (() => {
          if (existingAccessory) {
            this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
            if (existingAccessory.context.device.hasWaterTank === undefined) {
              existingAccessory.context.device = device;
              this.api.updatePlatformAccessories([existingAccessory]);
            }
            return existingAccessory;
          }

          this.log.info('Adding new accessory:', device.displayName);
          const accessory = new this.api.platformAccessory(device.displayName, uuid);
          accessory.context.device = device;
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          return accessory;
        })();
        this.accessories.push(new accessoryClass(this, accessory as PlatformAccessory<DeviceContext>, this.panasonicApi));
        this.updateReadings(device.uniqueId);
      }
    }

    for(const cachedAccessory of this.cachedAccessories) {
      if(foundAccessoriesUUIDs.includes(cachedAccessory.UUID)) {
        continue;
      }
      this.log.info('Removing non-existing accessory:', cachedAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
    }
  }

  async fetchDevices() {
    if (!this.panasonicApi) {
      return undefined;
    }
    this.log.debug('Fetching devices');
    try {
      const { selectedDeviceId, selectedDeviceName, deviceConf } = await this.panasonicApi.loadDevice();
      this.log.debug(`Device conf: ${JSON.stringify(deviceConf, undefined, 4)}`);
      return [
        {
          uniqueId: selectedDeviceId,
          displayName: selectedDeviceName,
          isCoolModeEnabled: deviceConf.configration[0].zoneInfo[0].coolMode === 'enable',
          hasWaterTank: deviceConf.configration[0].tankInfo[0].tank === 'Yes',
          zoneSensor: deviceConf.configration[0].zoneInfo[0].zoneSensor,
        },
      ];
    } catch (e) {
      this.log.error(`Could not load the device: ${e}`);
    }
    return undefined;
  }

  private refreshTimeout(deviceId: string) {
    const currentTimeout = this.timeoutIds[deviceId];
    if(currentTimeout) {
      clearTimeout(currentTimeout);
    }
    const timeout = (this.config.refreshTime ?? 5) * 1000;
    this.timeoutIds[deviceId] = setTimeout(() => {
      this.updateReadings(deviceId);
    }, timeout);
  }

  async updateReadings(deviceId: string): Promise<DeviceDetails | undefined> {
    const uuids = Object.keys(accessoryTypeClases).map(type => this.api.hap.uuid.generate(`${deviceId}-${type}`));
    const loadReadings = async () => {
      if(!this.panasonicApi) {
        return;
      }
      const details = await this.panasonicApi.loadDeviceDetails(deviceId);
      return parsePanasonicDetails(details, this.Characteristic);
    };
    try {
      const details = await loadReadings();
      this.log.debug(`Readings: ${JSON.stringify(details, undefined, 4)}`);
      if(details) {
        this.accessories.filter(({accessory}) => uuids.includes(accessory.UUID)).forEach((accessory) => {
          this.log.debug(`Updating: ${accessory.accessory.displayName} [${accessory.accessory.UUID}]`);
          accessory.onUpdateDetails(details);
        });
      }
      return details;
    } catch(e) {
      this.log.error(
        `Could not fetch details of device[${deviceId}] ${e}`,
      );
      return undefined;
    } finally {
      this.refreshTimeout(deviceId);
    }
  }

}
