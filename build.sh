#/bin/bash

mkdir -p browser

cd browser


# Determine the platform
case "$(uname -s)" in
    Linux*)     platform="linux" ;;
    Darwin*)    platform="mac" ;; # Adjust to 'mac-x64' if you need Intel macOS binary
    CYGWIN*|MINGW*) platform="win64" ;;
    *)          echo "Unsupported platform: $(uname -s)" && exit 1 ;;
esac

# Specify Chromium version (optional, default is 'latest')
CHROMIUM_VERSION="133.0.6921.0"

# Run the npx command to download Chromium
echo "Downloading Chromium for platform: $platform"
npx @puppeteer/browsers install chrome@$CHROMIUM_VERSION --platform=$platform

if [ $? -eq 0 ]; then
    echo "Chromium downloaded successfully for $platform."
else
    echo "Failed to download Chromium for $platform."
    exit 1
fi


# npm install --production
