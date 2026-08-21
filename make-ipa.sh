#!/usr/bin/env bash
# make-ipa.sh — Build a signed Codex.ipa on macOS in one shot.
#
# Requirements (install once):
#   1. macOS 13+ with Xcode 15+ from the App Store.
#   2. Xcode Command Line Tools:  xcode-select --install
#   3. Homebrew:                  https://brew.sh
#   4. Node 20+:                  brew install node
#   5. CocoaPods:                 sudo gem install cocoapods
#
# What this script does:
#   1. Verifies Xcode + Node + CocoaPods are installed.
#   2. Adds the iOS platform to this Capacitor project (`cap add ios`).
#   3. Runs `cap sync` so the www/ bundle is copied into ios/App/App/public.
#   4. Patches Info.plist to declare ATS allowances for huggingface.co +
#      cdn.jsdelivr.net so model weights can download at runtime.
#   5. Opens ios/App/App.xcworkspace in Xcode. From there:
#        - Select "App" target → Signing & Capabilities → Team: your Apple ID
#        - Product → Destination: Any iOS Device (or your plugged-in iPhone)
#        - Product → Archive
#        - When the Organizer opens → Distribute App → Development → your Apple ID
#        - Save the .ipa, sideload with Sideloadly / AltStore, or AirDrop+Install
#
# Usage:
#   bash make-ipa.sh
#
set -euo pipefail

say()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m!!  %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31mxx  %s\033[0m\n" "$*"; exit 1; }

cd "$(dirname "$0")"

# 1. Tooling check
say "Checking toolchain"
[ "$(uname -s)" = "Darwin" ] || die "Run this on macOS."
command -v node >/dev/null    || die "Node.js missing.  brew install node"
command -v npm  >/dev/null    || die "npm missing."
command -v xcodebuild >/dev/null || die "Xcode missing. Install from App Store."
command -v pod      >/dev/null    || die "CocoaPods missing.  sudo gem install cocoapods"
xcodebuild -version | head -1

# 2. JS deps
say "Installing JS dependencies"
npm install

# 3. Add iOS platform if missing
if [ ! -d "ios" ]; then
  say "Adding iOS platform (this fetches the Xcode template)"
  npx cap add ios
else
  warn "ios/ already exists; skipping cap add ios"
fi

# 4. Sync web assets into the iOS bundle
say "Syncing web assets → ios/App/App/public"
npx cap sync ios

# 5. Patch Info.plist for ATS (model downloads)
INFO_PLIST="ios/App/App/Info.plist"
if [ -f "$INFO_PLIST" ]; then
  say "Patching $INFO_PLIST for ATS"
  /usr/bin/plutil -replace 'NSAppTransportSecurity.NSAllowsArbitraryLoads' -bool YES "$INFO_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool YES" "$INFO_PLIST" 2>/dev/null || \
    warn "Could not auto-patch ATS; do it manually in Xcode if downloads fail."
else
  warn "Info.plist not found at $INFO_PLIST — open Xcode once, then re-run."
fi

# 6. Open Xcode
say "Opening Xcode workspace"
open -a Xcode ios/App/App.xcworkspace

cat <<'NEXT'

──────────────────────────────────────────────────────────────────
  Xcode is open. To produce the .ipa:

  1. Click the "App" target → "Signing & Capabilities"
     → choose Team = your Apple ID (free dev account works)
     → set a unique Bundle Identifier, e.g. com.<you>.codex

  2. Connect your iPhone via USB, trust the computer.

  3. Select your iPhone from the device target list
     (or "Any iOS Device" for an archive build).

  4. Product → Archive.

  5. When the Organizer appears:
     Distribute App → Development → your Apple ID
     → Export the .ipa.

  6. Install on your iPhone:
     a) Sideloadly (Mac/Windows, sideloadly.io) — easiest
     b) AltStore (altstore.io) — keeps it re-signed for 7 days
     c) Xcode → Window → Devices → drag the .ipa onto your phone

  Note: free Apple IDs re-sign apps for 7 days. Reinstall weekly
  with Sideloadly/AltStore, or pay $99/yr for a developer account
  to keep apps signed for a year.
──────────────────────────────────────────────────────────────────
NEXT
