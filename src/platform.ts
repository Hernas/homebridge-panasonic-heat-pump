import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { PanasonicHeatPumpPlatformAccessory } from './platformAccessory';
import { PanasonicApi } from './panasonicApi';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class PanasonicHeatPumpHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  private readonly email: string;
  private readonly password: string;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this.email = this.config.email;
    this.password = this.config.password;
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    if(!this.email || !this.password) {
      return;
    }
    const panasonicApi = new PanasonicApi(this.email, this.password);

    let devices: {
      uniqueId: string;
      displayName: string;
      isCoolModeEnabled: boolean;
      hasWaterTank: boolean;
    }[] = [];
    try {
      const {selectedDeviceId, selectedDeviceName, deviceConf} = await panasonicApi.loadDevice();
      devices = [
        {
          uniqueId: selectedDeviceId,
          displayName: selectedDeviceName,
          isCoolModeEnabled: deviceConf.configration[0].zoneInfo[0].coolMode === 'enable',
          hasWaterTank: deviceConf.configration[0].tankInfo[0].tank === 'Yes',
        },
      ];
    } catch(e) {
      this.log.error(`Could not load the device: ${e}`);
    }
    for (const device of devices) {

      const uuid = this.api.hap.uuid.generate(device.uniqueId);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        if(existingAccessory.context.device.hasWaterTank === undefined) {
          existingAccessory.context.device = device;
          this.api.updatePlatformAccessories([existingAccessory]);
        }
        new PanasonicHeatPumpPlatformAccessory(this, existingAccessory, panasonicApi);
      } else {
        this.log.info('Adding new accessory:', device.displayName);
        const accessory = new this.api.platformAccessory(device.displayName, uuid);
        accessory.context.device = device;
        new PanasonicHeatPumpPlatformAccessory(this, accessory, panasonicApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
