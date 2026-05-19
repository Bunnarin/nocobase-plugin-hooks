import { Plugin } from '@nocobase/server';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

export interface HookPlugin {
  name: string;
  instance: any;
  filePath: string;
}

export class PluginHooksServer extends Plugin {
  private hookPlugins: Map<string, HookPlugin> = new Map();
  private hooksDir: string;
  private fileModTimes: Map<string, number> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async afterAdd() {
    // Set up hooks directory in storage/hooks
    this.hooksDir = join(process.cwd(), 'storage', 'hooks');
    this.ensureHooksDirectory();
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
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    await this.unloadHookPlugins();
  }

  async remove() {
    // Clean up
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    await this.unloadHookPlugins();
  }

  private ensureHooksDirectory() {
    const fs = require('fs');
    if (!existsSync(this.hooksDir))
      fs.mkdirSync(this.hooksDir, { recursive: true });
  }

  private async installHookDependencies() {
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
        "@nocobase/server": "2.x.x",
        "@nocobase/client": "2.x.x"
      },
      devDependencies: {
        "@types/node": "^25.8.0"
      }
    };

    const packageJsonPath = join(this.hooksDir, 'package.json');
    if (!existsSync(packageJsonPath))
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');

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

  // Recursively collect all .ts/.js files from a directory
  private collectHookFiles(dir: string, prefix: string = ''): { file: string; filePath: string }[] {
    const results: { file: string; filePath: string }[] = [];
    if (!existsSync(dir)) return results;

    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip node_modules, dist, .git, etc.
          if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'client')
            continue;
          const subPrefix = prefix ? `${prefix}/${entry}` : entry;
          results.push(...this.collectHookFiles(fullPath, subPrefix));
        } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.js'))) {
          const relName = prefix ? `${prefix}/${entry}` : entry;
          results.push({ file: relName, filePath: fullPath });
        }
      } catch { /* skip */ }
    }
    return results;
  }

  private async loadHookPlugins() {
    // Unload existing hook plugins
    await this.unloadHookPlugins();

    if (!existsSync(this.hooksDir))
      return;

    // Install dependencies if needed
    await this.installHookDependencies();

    const hookFiles = this.collectHookFiles(this.hooksDir);

    for (const { file, filePath } of hookFiles) {
      // Generate plugin name from relative path: "audit/user-audit.ts" -> "hooks-audit-user-audit"
      const hookPluginName = `hooks-${file.replace(/\.(ts|js)$/, '').replace(/[\/]/g, '-')}`;

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
    this.log.info(`[hooks-watch] setupHookWatching called, hooksDir=${this.hooksDir}, exists=${existsSync(this.hooksDir)}`);
    if (!existsSync(this.hooksDir)) return;

    // Snapshot current file mtimes (recursive)
    this.snapshotModTimes();
    this.log.info(`[hooks-watch] snapshotModTimes done, tracking ${this.fileModTimes.size} files`);

    // Poll for file changes instead of fs.watch (works reliably in Docker / bind-mounts / git pull)
    const pollIntervalMs = parseInt(process.env.HOOKS_POLL_INTERVAL || '3000', 10);
    this.pollTimer = setInterval(() => this.pollForChanges(), pollIntervalMs);
    this.log.info(`[hooks-watch] polling every ${pollIntervalMs}ms`);
  }

  private pollForChanges() {
    if (!existsSync(this.hooksDir)) return;

    const currentFiles = this.collectHookFiles(this.hooksDir);
    const currentMap = new Map<string, number>();

    for (const { filePath } of currentFiles) {
      try {
        currentMap.set(filePath, statSync(filePath).mtimeMs);
      } catch { /* deleted between list and stat */ }
    }

    // Detect added, modified, or removed files
    let changed = false;
    for (const [fp, mtime] of currentMap) {
      const prev = this.fileModTimes.get(fp);
      if (prev === undefined || prev !== mtime) {
        this.log.info(`[hooks-watch] changed: ${fp}`);
        changed = true;
        break;
      }
    }
    if (!changed)
      for (const fp of this.fileModTimes.keys())
        if (!currentMap.has(fp)) {
          this.log.info(`[hooks-watch] removed: ${fp}`);
          changed = true;
          break;
        }

    if (changed) {
      this.log.info('[hooks-watch] hook files changed — exiting process for container restart');
      // Give the log a moment to flush, then exit.
      // Docker restart policy (restart: always / unless-stopped) will respawn the container.
      setTimeout(() => process.exit(0), 500);
    }
  }

  private snapshotModTimes() {
    this.fileModTimes.clear();
    const hookFiles = this.collectHookFiles(this.hooksDir);
    for (const { filePath } of hookFiles) {
      try {
        this.fileModTimes.set(filePath, statSync(filePath).mtimeMs);
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
}

export default PluginHooksServer;
