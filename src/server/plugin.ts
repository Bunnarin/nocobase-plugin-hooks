import { Plugin } from '@nocobase/server';
import { join } from 'path';
import { existsSync, readdirSync, statSync, watch } from 'fs';

export interface HookPlugin {
  name: string;
  instance: any;
  filePath: string;
}

export class PluginHooksServer extends Plugin {
  private hookPlugins: Map<string, HookPlugin> = new Map();
  private hooksDir: string;
  private hooksPackageJson: any = null;
  private fileModTimes: Map<string, number> = new Map();

  async afterAdd() {
    // Set up hooks directory in storage/hooks
    this.hooksDir = join(process.cwd(), 'storage', 'hooks');
    this.ensureHooksDirectory();
  }

  async beforeLoad() {
    // Nothing needed here - hooks are loaded in load()
  }

  async load() {
    // Load hook plugins during the load phase when PluginManager is fully ready
    await this.loadHookPlugins();

    // Set up file watching for hot-reload (works in all environments including Docker)
    this.setupHookWatching();
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
  }

  async remove() {
    // Clean up
    await this.unloadHookPlugins();
  }

  private ensureHooksDirectory() {
    const fs = require('fs');
    if (!existsSync(this.hooksDir))
      fs.mkdirSync(this.hooksDir, { recursive: true });
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
    if (!this.hooksPackageJson)
      return;

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
      if (process.env.NODE_ENV !== 'production')
        this.log.debug('Yarn install output:', result);
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
      peerDependencies: {
        "nocobase/server": "2.x.x",
        "nocobase/client": "2.x.x"
      }
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
    if (!existsSync(gitignorePath))
      fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');

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
    if (!existsSync(tsConfigPath))
      fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2), 'utf8');
  }

  private async loadHookPlugins() {
    // Unload existing hook plugins
    await this.unloadHookPlugins();

    if (!existsSync(this.hooksDir))
      return;

    // Load package.json from hooks directory
    this.loadHooksPackageJson();

    // Install dependencies if needed
    await this.installHookDependencies();

    const files = readdirSync(this.hooksDir);
    
    for (const file of files) {
      // Only load .ts and .js files, skip directories and non-plugin files
      if (!file.endsWith('.ts') && !file.endsWith('.js'))
        continue;

      const filePath = join(this.hooksDir, file);

      // Skip directories
      try {
        if (statSync(filePath).isDirectory())
          continue;
      } catch {
        continue;
      }

      const hookPluginName = `hooks-${file.replace(/\.(ts|js)$/, '')}`;

      try {
        const HookPluginClass = await this.importHookPlugin(filePath);
          
        if (HookPluginClass && typeof HookPluginClass === 'function') {
          // Check if plugin is already registered (happens on reload)
          const existing = this.app.pm.get(hookPluginName);
          
          if (existing) {
            // Plugin already registered — just re-run load() for hot-reload
            // Clear old state so load() can re-register resources
            existing.state = existing.state || {};
            existing.state.loaded = false;
            await existing.beforeLoad();
            await existing.load();
            existing.state.loaded = true;
            existing.enabled = true;

            this.hookPlugins.set(hookPluginName, {
              name: hookPluginName,
              instance: existing,
              filePath
            });

            this.log.info(`Reloaded hook plugin: ${hookPluginName} from ${file}`);
          } else {
            // First time: register through PluginManager for proper ACL, proxy, etc.
            await this.app.pm.add(HookPluginClass, {
              name: hookPluginName,
              enabled: true,
            });

            const instance = this.app.pm.get(hookPluginName);

            if (instance) {
              this.hookPlugins.set(hookPluginName, {
                name: hookPluginName,
                instance,
                filePath
              });

              // Run lifecycle: beforeLoad -> load
              await instance.beforeLoad();
              await instance.load();
              instance.state = instance.state || {};
              instance.state.loaded = true;
              instance.enabled = true;

              this.log.info(`Loaded hook plugin: ${hookPluginName} from ${file}`);
            }
          }
        }
      } catch (error) {
        this.log.error(`Failed to load hook plugin from ${file}:`, error);
      }
    }
  }

  private async unloadHookPlugins() {
    for (const [name, hookPlugin] of this.hookPlugins) {
      try {
        const instance = hookPlugin.instance;
        if (instance && typeof instance.afterDisable === 'function')
          await instance.afterDisable();
        // Note: We don't remove from PluginManager to avoid issues during reload.
        // The plugin will be overwritten on next load.
      } catch (error) {
        this.log.error(`Error unloading hook plugin ${name}:`, error);
      }
    }
    this.hookPlugins.clear();
  }

  private async importHookPlugin(filePath: string): Promise<any> {
    // ALWAYS clear require cache — in Docker (production) the cached module
    // would never update even after app restart
    try {
      const resolved = (require as any).resolve(filePath);
      if ((require as any).cache[resolved])
        delete (require as any).cache[resolved];
    } catch {
      // not in cache yet
    }
    
    // Load the module and handle __esModule default export pattern
    const m = (require as any)(filePath);
    if (typeof m !== 'object')
      return m;
    return m.__esModule ? m.default : m;
  }

  private setupHookWatching() {
    if (!existsSync(this.hooksDir)) return;

    // Snapshot current file mtimes
    this.snapshotModTimes();

    // Try fs.watch (works on native, NOT on Docker bind mounts)
      this.watcher = watch(this.hooksDir, { recursive: false }, (eventType, filename) => {
        if (!filename) return;
        if (!filename.endsWith('.ts') && !filename.endsWith('.js'))
          return;
        this.app.runAsCLI(['restart'], {from: 'user'});
      });
  }

  private snapshotModTimes() {
    this.fileModTimes.clear();
      const files = readdirSync(this.hooksDir);
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
        const filePath = join(this.hooksDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            this.fileModTimes.set(filePath, stat.mtimeMs);
          }
        } catch { /* skip */ }
      }
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
        const oldInstance = hookPlugin.instance;
        if (oldInstance && typeof oldInstance.afterDisable === 'function') {
          await oldInstance.afterDisable();
        }

        // Reload via PluginManager
        const HookPluginClass = await this.importHookPlugin(hookPlugin.filePath);
        if (HookPluginClass) {
          await this.app.pm.add(HookPluginClass, {
            name: hookPlugin.name,
            enabled: true,
          });

          const newInstance = this.app.pm.get(hookPlugin.name);
          if (newInstance) {
            await newInstance.beforeLoad();
            await newInstance.load();
            newInstance.state = newInstance.state || {};
            newInstance.state.loaded = true;
            newInstance.enabled = true;

            this.hookPlugins.set(name, {
              ...hookPlugin,
              instance: newInstance
            });
          }

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
