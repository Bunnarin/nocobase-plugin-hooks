# NocoBase Hooks Plugin

A hooks system for NocoBase similar to PocketBase's `pb_hooks`, allowing you to write full plugin-like code that extends NocoBase functionality directly from the `storage/hooks/` directory.

## Features

- **Plugin-like Extensions**: Write full NocoBase plugins in the hooks directory
- **Automatic Loading**: Automatically loads and executes hook plugins
- **Hot Reloading**: Hook plugins are automatically reloaded in development mode
- **Version Control**: Hook files can be version controlled like any other code
- **Full Plugin API**: Access to all NocoBase plugin features (database, app, middleware, etc.)

## Installation

1. Install the plugin:
```bash
yarn pm add @bunnarin/plugin-hooks
```

2. Enable the plugin in NocoBase admin panel or via CLI:
```bash
yarn pm enable @bunnarin/plugin-hooks
```

3. Enable version control by creating a .gitignore file in the storage/hooks/ directory:

And add the following line to .gitignore:
```bash
storage/*
!storage/hooks/
```

## Documentation
https://docs.nocobase.com/plugin-development

## Usage

### Hook Directory Structure

After installation, a `storage/hooks/` directory will be created automatically. Place your hook plugins in this directory:

```
storage/
└── hooks/
    ├── package.json          # Hook dependencies and configuration
    ├── tsconfig.json        # TypeScript configuration
    ├── user-audit.ts
    ├── collection-validator.ts
    ├── request-logger.ts
    └── my-custom-plugin.ts
```

### Package.json Support

The `storage/hooks/package.json` file allows you to:

- **Manage Dependencies**: Add npm packages specifically for your hooks
- **Define Scripts**: Create development and build scripts
- **Configure TypeScript**: Set up TypeScript compilation options
- **Add Metadata**: Include information about your hooks collection

#### Using Dependencies

Once you add dependencies to `storage/hooks/package.json`, the hooks system will **automatically install them** using Yarn when the plugin loads. You can also manually install them:

```bash
cd storage/hooks
yarn install
```

**Automatic Installation**: The hooks plugin automatically detects when dependencies need to be installed and runs `yarn install` during startup. This works in both development and production environments.

Then use them in your hook plugins:

```typescript
// storage/hooks/email-notifications.ts
import { Plugin } from '@nocobase/server';
import nodemailer from 'nodemailer';
import moment from 'moment';

export default class EmailNotificationsPlugin extends Plugin {
  private transporter: any;

  async load() {
    // Initialize nodemailer with your dependencies
    this.transporter = nodemailer.createTransporter({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    this.db.on('users.afterCreate', async (model, options) => {
      await this.sendWelcomeEmail(model);
    });
  }

  private async sendWelcomeEmail(user: any) {
    await this.transporter.sendMail({
      from: 'noreply@example.com',
      to: user.email,
      subject: 'Welcome to NocoBase!',
      html: `<h1>Welcome ${user.email}!</h1><p>Joined at: ${moment().format('LLLL')}</p>`
    });

    this.log.info('Welcome email sent to:', user.email);
  }
}
```

### Hook Plugin Format

Each hook file should export a default class that extends the NocoBase `Plugin` class:

```typescript
// storage/hooks/user-audit.ts
import { Plugin } from '@nocobase/server';

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

    // Add custom API endpoints
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
}
```

### Available Plugin Features

Hook plugins have access to the full NocoBase plugin API:

- **Database Events**: `this.db.on()` for model events
- **Application Events**: `this.app.on()` for app lifecycle events
- **Middleware**: `this.app.middleware.push()` for request middleware
- **Resources**: `this.app.resource()` for custom API endpoints
- **Collections**: `this.db.collection()` for database operations
- **ACL**: `this.app.acl` for access control
- **Logging**: `this.log` for logging

### Plugin Lifecycle Methods

Hook plugins support all standard NocoBase plugin lifecycle methods:

```typescript
import { Plugin } from '@nocobase/server';

export default class MyHookPlugin extends Plugin {
  async afterAdd() {
    // Called after plugin is added
  }

  async beforeLoad() {
    // Called before plugin loads
  }

  async load() {
    // Main plugin logic
  }

  async install() {
    // Plugin installation logic
  }

  async afterEnable() {
    // Called after plugin is enabled
  }

  async afterDisable() {
    // Called after plugin is disabled
  }
}
```
### Error Handling

If a hook plugin throws an error during loading, it will be logged but won't stop other hook plugins from loading. The application will continue running normally.

### TypeScript Support

Hook plugins can be written in TypeScript with full type safety:

```typescript
// storage/hooks/typed-plugin.ts
import { Plugin } from '@nocobase/server';
import { Model } from '@nocobase/database';

export default class TypedPlugin extends Plugin {
  async load() {
    this.db.on('users.afterCreate', async (model: Model) => {
      // Full TypeScript support
      this.log.info('User created:', model.id);
    });
  }
}
```

## Examples

### User Audit Plugin

```typescript
// storage/hooks/user-audit.ts
import { Plugin } from '@nocobase/server';

export default class UserAuditPlugin extends Plugin {
  async load() {
    // Log all user operations
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

    // Add custom audit API
    this.app.resource({
      name: 'userAudit',
      actions: {
        async getAuditLog(ctx, next) {
          const { filter } = ctx.action.params;
          // Implement audit log retrieval
          ctx.body = { message: 'User audit functionality' };
        }
      }
    });
  }
}
```

### Collection Validator Plugin

```typescript
// storage/hooks/collection-validator.ts
import { Plugin } from '@nocobase/server';

export default class CollectionValidatorPlugin extends Plugin {
  async load() {
    // Validate collection creation
    this.db.on('collections.beforeCreate', async (model, options) => {
      const restrictedNames = ['admin', 'system', 'root', 'config'];
      if (restrictedNames.includes(model.name)) {
        throw new Error(`Collection name "${model.name}" is reserved`);
      }

      // Validate collection structure
      if (model.name && !/^[a-z][a-z0-9_]*$/i.test(model.name)) {
        throw new Error('Collection name must start with a letter and contain only letters, numbers, and underscores');
      }

      this.log.info('Collection validation passed:', model.name);
    });

    // Add middleware for collection operations
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
}
```

### Request Logger Plugin

```typescript
// storage/hooks/request-logger.ts
import { Plugin } from '@nocobase/server';

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
        duration: `${duration}ms`
      });
    });
  }
}
```

## Plugin Management API

The hooks plugin provides APIs for managing loaded hook plugins and package.json:

```typescript
// Get all loaded hook plugins
const hooksPlugin = app.pm.get('@bunnarin/plugin-hooks');
const hookPlugins = hooksPlugin.getHookPlugins();

// Get a specific hook plugin
const userAudit = hooksPlugin.getHookPlugin('user-audit');

// Reload a specific hook plugin
await hooksPlugin.reloadHookPlugin('user-audit');

// Get hooks package.json information
const packageJson = hooksPlugin.getHooksPackageJson();

// Get hooks dependencies
const dependencies = hooksPlugin.getHooksDependencies();

// Get hooks scripts
const scripts = hooksPlugin.getHooksScripts();

// Check if package.json exists
const hasPackageJson = hooksPlugin.hasHooksPackageJson();
```

### Development Workflow

With `package.json` support, you can now develop hooks like a proper Yarn package:

```bash
# Navigate to hooks directory
cd storage/hooks

# Install dependencies (automatic, but can be manual)
yarn install

# Run development script (if defined)
yarn dev

# Build hooks (if defined)
yarn build

# Lint hooks (if defined)
yarn lint
```

**Production Deployment**: When you deploy to production, the hooks system automatically:
1. Checks if `storage/hooks/package.json` exists
2. Verifies if dependencies are installed (`node_modules/` and `yarn.lock`)
3. Runs `yarn install` automatically if needed
4. Loads all hook plugins

**No manual installation required** - just push your code and the hooks system handles the rest!

## Contributing

Feel free to submit issues and enhancement requests!

## License

Apache-2.0
