#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Resilient Symlinked VPS Deployment..."

API_DIR="/root/Plokitch-api"
RELEASES_DIR="${API_DIR}/releases"
SHARED_DIR="${API_DIR}/shared"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
NEW_RELEASE="${RELEASES_DIR}/${TIMESTAMP}"

mkdir -p "${RELEASES_DIR}"
mkdir -p "${SHARED_DIR}"

echo "📂 Verifying shared directory layout at: ${SHARED_DIR}"

# 1. Capture the previous active release path for safety checks and rollback
PREVIOUS_RELEASE=""
if [ -L "${API_DIR}/current" ]; then
  PREVIOUS_RELEASE=$(readlink -f "${API_DIR}/current")
  echo "👉 Current active release: ${PREVIOUS_RELEASE}"
fi

# 2. Codebase update is handled beforehand by GHA runner SSH pull task

# 3. Create fresh release folder and copy files
echo "📂 Creating new release version: ${TIMESTAMP}"
mkdir -p "${NEW_RELEASE}"
rsync -a --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='releases' --exclude='shared' --exclude='current' "${API_DIR}/" "${NEW_RELEASE}/"

# 4. Install production dependencies and compile inside the release folder
echo "🔨 Compiling dependencies in isolated release directory..."
cd "${NEW_RELEASE}"
npm install --legacy-peer-deps
npm run build

# 5. Atomically update current symlink
echo "🔗 Swapping symlink to new release..."
ln -sfn "${NEW_RELEASE}" "${API_DIR}/current"

# 6. Reload PM2 (Fork Mode) using ecosystem configuration file
echo "🔄 Reloading PM2 process via ecosystem configuration..."
cd "${API_DIR}"

# Ensure PM2 is registered to the symlinked path via ecosystem file
if pm2 describe plokitch-api >/dev/null 2>&1; then
  # If already registered, reload env and follow symlink
  pm2 reload ecosystem.config.json --update-env
else
  # Start fresh in Fork Mode using ecosystem config
  pm2 start ecosystem.config.json
fi

# 7. HTTP Health Gate Verification Check
echo "🔍 Initiating HTTP Health Gate Inspection..."
HEALTH_SUCCESS=false

# Try 5 times over 10 seconds to allow startup binding
for i in {1..5}; do
  echo "   - Health check attempt $i..."
  if curl -s -f http://127.0.0.1:4000/health >/dev/null; then
    HEALTH_SUCCESS=true
    break
  fi
  sleep 2
done

if [ "$HEALTH_SUCCESS" = "true" ]; then
  echo "🎉 Rolling Deployment successful! HTTP Health Check Passed."
  
  # Clean up old releases, keep only the latest 3 to prevent disk bloat
  echo "🧹 Cleaning up old releases..."
  cd "${RELEASES_DIR}"
  ls -1t | tail -n +4 | xargs -r rm -rf
  
  pm2 save
else
  echo "❌ HTTP Health Check failed! Application startup check was unsuccessful."
  if [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
    echo "⚠️ Triggering automated rollback to previous stable release: ${PREVIOUS_RELEASE}"
    
    # Swap symlink back
    ln -sfn "${PREVIOUS_RELEASE}" "${API_DIR}/current"
    
    # Reload PM2 to run previous release via ecosystem config
    pm2 reload ecosystem.config.json --update-env
    
    echo "✅ Rollback completed! System restored to previous stable build."
  else
    echo "🚨 No previous release found to roll back to!"
  fi
  exit 1
fi
