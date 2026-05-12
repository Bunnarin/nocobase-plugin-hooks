import { Plugin } from '@nocobase/server';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';

export interface HookPlugin {
  name: string;
  instance: any;
  filePath: string;
}

export class PluginHooksServer extends Plugin {
  private hookPlugins: Map<string, HookPlugin> = new Map();
  private hooksDir: string;
  private watchInterval: NodeJS.Timeout | null = null;
  private hooksPackageJson: any = null;

  async afterAdd() {
    // Set up hooks directory in storage/hooks
    this.hooksDir = join(process.cwd(), 'storage', 'hooks');
    this.ensureHooksDirectory();
  }

  async beforeLoad() {
    // Load hook plugins before the main plugin loads
    await this.loadHookPlugins();
  }

  async load() {
    // Set up file watching for development
    if (process.env.NODE_ENV === 'development') {
      this.setupHookWatching();
    }
  }

  async install() {
    this.ensureHooksDirectory();
    this.createExampleHooks();
  }

  async afterEnable() {
    // Reload hook plugins when plugin is enabled
    await this.loadHookPlugins();
  }

  async afterDisable() {
    // Clean up hook plugins when disabled
    await this.unloadHookPlugins();
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }

  async remove() {
    // Clean up
    await this.unloadHookPlugins();
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
  }

  private ensureHooksDirectory() {
    const fs = require('fs');
    if (!existsSync(this.hooksDir)) {
      fs.mkdirSync(this.hooksDir, { recursive: true });
    }
  }

  private loadHooksPackageJson() {
    const packageJsonPath = join(this.hooksDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJsonContent = (require as any)(packageJsonPath);
        this.hooksPackageJson = packageJsonContent;
        this.log.info('Loaded hooks package.json:', packageJsonContent.name);
      } catch (error) {
        this.log.error('Error loading hooks package.json:', error);
        this.hooksPackageJson = null;
      }
    } else {
      this.hooksPackageJson = null;
    }
  }

  private async installHookDependencies() {
    if (!this.hooksPackageJson) {
      return;
    }

    const nodeModulesPath = join(this.hooksDir, 'node_modules');
    const yarnLockPath = join(this.hooksDir, 'yarn.lock');

    // Check if dependencies are already installed
    const hasNodeModules = existsSync(nodeModulesPath);
    const hasYarnLock = existsSync(yarnLockPath);

    if (hasNodeModules && hasYarnLock) {
      this.log.info('Hook dependencies already installed');
      return;
    }

    // Install dependencies using yarn
    try {
      this.log.info('Installing hook dependencies...');
      
      const { execSync } = require('child_process');
      const result = execSync('yarn install', {
        cwd: this.hooksDir,
        stdio: 'pipe',
        encoding: 'utf8'
      });

      this.log.info('Hook dependencies installed successfully');
      if (process.env.NODE_ENV !== 'production') {
        this.log.debug('Yarn install output:', result);
      }
    } catch (error) {
      this.log.error('Failed to install hook dependencies:', error);
      // Don't throw error, just log it so hooks can still load
    }
  }

  private createExampleHooks() {
    const fs = require('fs');
    
    // Create package.json for hooks directory
    const packageJson = {
      name: "nocobase-hooks",
      version: "1.0.0",
      description: "Custom hooks for NocoBase",
      type: "module",
      scripts: {
        "dev": "tsc --watch",
        "build": "tsc",
        "lint": "eslint . --ext .ts,.js"
      },
      dependencies: {
        // Add your hook-specific dependencies here
        "nodemailer": "^6.9.0",
        "moment": "^2.29.0"
      },
      devDependencies: {
        "@types/node": "^18.0.0",
        "typescript": "^5.0.0",
        "eslint": "^8.0.0"
      },
      keywords: ["nocobase", "hooks", "customization"]
    };

    const packageJsonPath = join(this.hooksDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
    }

    // Create .gitignore for hooks directory
    const gitignoreContent = `# Dependencies
node_modules/
.yarn/

# Build output
dist/
*.tsbuildinfo

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
`;

    const gitignorePath = join(this.hooksDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
    }

    // Create tsconfig.json for TypeScript support
    const tsConfig = {
      compilerOptions: {
        target: "ES2020",
        module: "CommonJS",
        lib: ["ES2020"],
        outDir: "./dist",
        rootDir: "./",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        moduleResolution: "node",
        allowSyntheticDefaultImports: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: ["node"]
      },
      include: [
        "**/*.ts"
      ],
      exclude: [
        "node_modules",
        "dist"
      ]
    };

    const tsConfigPath = join(this.hooksDir, 'tsconfig.json');
    if (!existsSync(tsConfigPath)) {
      fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2), 'utf8');
    }
    
    // Create example hook plugins that extend NocoBase like regular plugins
    const examples = {
      'user-audit.ts': `import { Plugin } from '@nocobase/server';

export default class UserAuditPlugin extends Plugin {
  async load() {
    // Add audit logging for user operations
    this.db.on('users.afterCreate', async (model, options) => {
      this.log.info('User created:', {
        id: model.id,
        email: model.email,
        createdAt: model.createdAt
      });
    });

    this.db.on('users.afterUpdate', async (model, options) => {
      this.log.info('User updated:', {
        id: model.id,
        changedFields: Object.keys(model.changed || {})
      });
    });

    // Add custom action
    this.app.resource({
      name: 'userAudit',
      actions: {
        async getAuditLog(ctx, next) {
          const { filter } = ctx.action.params;
          // Custom audit logic here
          ctx.body = { message: 'User audit log functionality' };
        }
      }
    });
  }
}`,
      
      'collection-validator.ts': `import { Plugin } from '@nocobase/server';

export default class CollectionValidatorPlugin extends Plugin {
  async load() {
    // Add validation for all collections
    this.db.on('collections.beforeCreate', async (model, options) => {
      const restrictedNames = ['admin', 'system', 'root', 'config'];
      if (restrictedNames.includes(model.name)) {
        throw new Error(\`Collection name "\${model.name}" is reserved\`);
      }

      // Validate collection structure
      if (model.name && !/^[a-z][a-z0-9_]*$/i.test(model.name)) {
        throw new Error('Collection name must start with a letter and contain only letters, numbers, and underscores');
      }

      this.log.info('Collection validation passed:', model.name);
    });

    // Add custom middleware for collection operations
    this.app.middleware.push(async (ctx, next) => {
      if (ctx.path.startsWith('/api/collections') && ctx.method === 'POST') {
        this.log.info('Collection creation attempt:', {
          path: ctx.path,
          body: ctx.request.body
        });
      }
      await next();
    });
  }
}`,
      
      'request-logger.ts': `import { Plugin } from '@nocobase/server';

export default class RequestLoggerPlugin extends Plugin {
  private startTime = new Map();

  async load() {
    // Add request timing middleware
    this.app.middleware.push(async (ctx, next) => {
      const start = Date.now();
      this.startTime.set(ctx.req, start);

      // Log request start
      this.log.info('Request started:', {
        method: ctx.method,
        path: ctx.path,
        ip: ctx.ip,
        userAgent: ctx.get('User-Agent')
      });

      await next();

      // Calculate and log request duration
      const duration = Date.now() - (this.startTime.get(ctx.req) || start);
      this.startTime.delete(ctx.req);

      this.log.info('Request completed:', {
        method: ctx.method,
        path: ctx.path,
        status: ctx.status,
        duration: \`\${duration}ms\`
      });
    });
  }
}`
    };

    for (const [filename, content] of Object.entries(examples)) {
      const filePath = join(this.hooksDir, filename);
      if (!existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
  }

  private async loadHookPlugins() {
    // Unload existing hook plugins
    await this.unloadHookPlugins();

    if (!existsSync(this.hooksDir)) {
      return;
    }

    // Load package.json from hooks directory
    this.loadHooksPackageJson();

    // Install dependencies if needed
    await this.installHookDependencies();

    const files = readdirSync(this.hooksDir);
    
    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.js')) {
        try {
          const filePath = join(this.hooksDir, file);
          const HookPluginClass = await this.importHookPlugin(filePath);
          
          if (HookPluginClass && typeof HookPluginClass === 'function') {
            // Create plugin instance
            const hookPluginName = file.replace(/\.(ts|js)$/, '');
            const hookPluginInstance = new HookPluginClass(this.app, {
              name: hookPluginName,
              packageName: `hooks.${hookPluginName}`
            });

            // Store the hook plugin
            this.hookPlugins.set(hookPluginName, {
              name: hookPluginName,
              instance: hookPluginInstance,
              filePath
            });

            // Execute plugin lifecycle methods
            await this.executeHookPluginLifecycle(hookPluginInstance);

            this.log.info(`Loaded hook plugin: ${hookPluginName} from ${file}`);
          }
        } catch (error) {
          this.log.error(`Failed to load hook plugin from ${file}:`, error);
        }
      }
    }
  }

  private async executeHookPluginLifecycle(hookPlugin: any) {
    try {
      // Execute plugin lifecycle methods in order
      if (typeof hookPlugin.afterAdd === 'function') {
        await hookPlugin.afterAdd();
      }
      
      if (typeof hookPlugin.beforeLoad === 'function') {
        await hookPlugin.beforeLoad();
      }
      
      if (typeof hookPlugin.load === 'function') {
        await hookPlugin.load();
      }

      if (typeof hookPlugin.install === 'function') {
        // Don't auto-install hook plugins
        // await hookPlugin.install();
      }
    } catch (error) {
      this.log.error(`Error executing hook plugin lifecycle:`, error);
    }
  }

  private async unloadHookPlugins() {
    for (const [name, hookPlugin] of this.hookPlugins) {
      try {
        if (typeof hookPlugin.instance.afterDisable === 'function') {
          await hookPlugin.instance.afterDisable();
        }
      } catch (error) {
        this.log.error(`Error unloading hook plugin ${name}:`, error);
      }
    }
    this.hookPlugins.clear();
  }

  private async importHookPlugin(filePath: string): Promise<any> {
    // Clear require cache for development
    if (process.env.NODE_ENV === 'development') {
      delete (require as any).cache[(require as any).resolve(filePath)];
    }
    
    const module = (require as any)(filePath);
    return module.default || module;
  }

  private setupHookWatching() {
    // Simple file watching for development
    this.watchInterval = setInterval(async () => {
      try {
        await this.loadHookPlugins();
      } catch (error) {
        this.log.error('Error reloading hook plugins:', error);
      }
    }, 2000); // Check every 2 seconds
  }

  // Public API to get loaded hook plugins
  public getHookPlugins(): HookPlugin[] {
    return Array.from(this.hookPlugins.values());
  }

  // Public API to get a specific hook plugin
  public getHookPlugin(name: string): HookPlugin | undefined {
    return this.hookPlugins.get(name);
  }

  // Public API to reload a specific hook plugin
  public async reloadHookPlugin(name: string) {
    const hookPlugin = this.hookPlugins.get(name);
    if (hookPlugin) {
      try {
        // Unload
        if (typeof hookPlugin.instance.afterDisable === 'function') {
          await hookPlugin.instance.afterDisable();
        }

        // Reload
        const HookPluginClass = await this.importHookPlugin(hookPlugin.filePath);
        if (HookPluginClass) {
          const newInstance = new HookPluginClass(this.app, {
            name: hookPlugin.name,
            packageName: `hooks.${hookPlugin.name}`
          });

          this.hookPlugins.set(name, {
            ...hookPlugin,
            instance: newInstance
          });

          await this.executeHookPluginLifecycle(newInstance);
          this.log.info(`Reloaded hook plugin: ${name}`);
        }
      } catch (error) {
        this.log.error(`Error reloading hook plugin ${name}:`, error);
      }
    }
  }

  // Public API to get hooks package.json information
  public getHooksPackageJson(): any {
    return this.hooksPackageJson;
  }

  // Public API to get hooks package dependencies
  public getHooksDependencies(): Record<string, string> {
    return this.hooksPackageJson?.dependencies || {};
  }

  // Public API to get hooks package scripts
  public getHooksScripts(): Record<string, string> {
    return this.hooksPackageJson?.scripts || {};
  }

  // Public API to check if hooks package.json exists
  public hasHooksPackageJson(): boolean {
    return this.hooksPackageJson !== null;
  }
}

export default PluginHooksServer;
