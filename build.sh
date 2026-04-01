#!/bin/bash

# Build the Electron app.
# Chromium is no longer downloaded separately — the app reuses Electron's
# built-in engine, which significantly reduces the bundle size (~700 MB → ~180 MB).

npm run build
