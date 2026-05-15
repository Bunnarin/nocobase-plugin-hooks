/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

// @ts-ignore - Plugin is available at runtime but not during build
import { Plugin } from '@nocobase/client';

export class PluginHooksClient extends Plugin {
  async load() {
    // Client-side hooks functionality can be added here
    // For now, this plugin primarily provides server-side hooks
    // Future enhancements could include:
    // - Hook management UI
    // - Hook execution monitoring
    // - Hook templates
    
    // Note: Frontend functionality will be added later
    // The main hooks functionality is server-side
  }
}

export default PluginHooksClient;
