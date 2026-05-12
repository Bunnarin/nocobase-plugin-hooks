import { Plugin } from '@nocobase/client';

export class PluginHooksClient extends Plugin {
  async load() {
    // Client-side hooks functionality can be added here
    // For now, this plugin primarily provides server-side hooks
    // Future enhancements could include:
    // - Hook management UI
    // - Hook execution monitoring
    // - Hook templates
  }
}

export default PluginHooksClient;
