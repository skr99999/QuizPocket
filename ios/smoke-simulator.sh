#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 || $# -gt 2 ]]; then
  echo "Usage: bash ios/smoke-simulator.sh SIMULATOR_UDID [SCREENSHOT.png]" >&2
  echo "Find a simulator with: xcrun simctl list devices available" >&2
  exit 2
fi

ios_dir="$(cd "$(dirname "$0")" && pwd)"
simulator="$1"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
screenshot="${2:-$PWD/ios-smoke.png}"
bundle_id=net.quizpocket.app

xcodebuild -project "$ios_dir/QuizPocket.xcodeproj" -scheme QuizPocket \
  -destination "id=$simulator" -configuration Debug -derivedDataPath "$work_dir/build" \
  build
xcrun simctl bootstatus "$simulator" -b
xcrun simctl install "$simulator" "$work_dir/build/Build/Products/Debug-iphonesimulator/QuizPocket.app"
xcrun simctl terminate "$simulator" "$bundle_id" 2>/dev/null || true
xcrun simctl launch "$simulator" "$bundle_id"

cat > "$work_dir/check.swift" <<'SWIFT'
import Foundation
import Vision

let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["zh-Hans", "en-US"]
let screenshot = URL(fileURLWithPath: CommandLine.arguments[1])
try VNImageRequestHandler(url: screenshot).perform([request])
let recognized = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
    .joined()
    .filter { !$0.isWhitespace }
guard recognized.contains("掌上题库"), recognized.contains("导入题库") else {
    exit(1)
}
SWIFT
xcrun swiftc "$work_dir/check.swift" -o "$work_dir/check"
for _ in {1..10}; do
  xcrun simctl io "$simulator" screenshot "$screenshot"
  if "$work_dir/check" "$screenshot"; then
    echo "QuizPocket home verified: $screenshot"
    exit 0
  fi
  sleep 1
done
echo "QuizPocket home could not be verified. See $screenshot." >&2
exit 1
