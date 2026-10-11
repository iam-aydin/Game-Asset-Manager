import { app } from 'electron';
import { join } from 'node:path';

// Must be the FIRST import in main/index.ts so the logger, prefs and registry
// all see %APPDATA%\GAM instead of whatever the package name used to resolve to.
app.setPath('userData', join(app.getPath('appData'), 'GAM'));